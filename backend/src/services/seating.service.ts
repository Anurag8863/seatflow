import { Prisma, type AuditSource, type SeatStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { AppError, ConflictError, NotFoundError } from '../lib/errors.js';
import {
  employeeInclude,
  seatInclude,
  serializeEmployee,
  serializeSeat,
  type EmployeeDto,
  type SeatDto,
} from './serializers.js';

type Tx = Prisma.TransactionClient;

export interface ActionContext {
  /** The signed-in user performing the action, or null for system actions. */
  actorId: string | null;
  source: AuditSource;
  /** Set when the mutation originated from a confirmed AI action. */
  aiActionId?: string | null;
}

export interface SeatingResult {
  seat: SeatDto | null;
  previousSeat: SeatDto | null;
  employee: EmployeeDto | null;
  summary: string;
}

// --------------------------------------------------------------- lookup helpers

const seatWithOccupant = {
  include: {
    floor: { include: { building: true } },
    assignments: {
      where: { active: true },
      include: { employee: true },
      take: 1,
    },
  },
} satisfies { include: Prisma.SeatInclude };

async function loadSeat(tx: Tx, seatId: string) {
  const seat = await tx.seat.findUnique({ where: { id: seatId }, ...seatWithOccupant });
  if (!seat) {
    throw new NotFoundError('That seat no longer exists.', { seatId });
  }
  return seat;
}

async function loadEmployee(tx: Tx, employeeId: string) {
  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    include: {
      assignments: {
        where: { active: true },
        include: { seat: { include: { floor: { include: { building: true } } } } },
        take: 1,
      },
    },
  });
  if (!employee) {
    throw new NotFoundError('That employee no longer exists.', { employeeId });
  }
  return employee;
}

async function readSeatDto(tx: Tx, seatId: string): Promise<SeatDto> {
  const seat = await tx.seat.findUniqueOrThrow({ where: { id: seatId }, include: seatInclude });
  return serializeSeat(seat);
}

async function readEmployeeDto(tx: Tx, employeeId: string): Promise<EmployeeDto> {
  const employee = await tx.employee.findUniqueOrThrow({
    where: { id: employeeId },
    include: employeeInclude,
  });
  return serializeEmployee(employee);
}

// ------------------------------------------------------------- rule assertions

type LoadedSeat = Awaited<ReturnType<typeof loadSeat>>;
type LoadedEmployee = Awaited<ReturnType<typeof loadEmployee>>;

/** A seat can receive an employee only when enabled and currently free. */
function assertSeatAssignable(seat: LoadedSeat): void {
  if (seat.status === 'DISABLED') {
    throw new ConflictError(
      'Seat ' + seat.seatCode + ' is disabled and cannot be assigned. Enable it first.',
      'SEAT_DISABLED',
      { seatCode: seat.seatCode },
    );
  }
  const occupant = seat.assignments[0]?.employee;
  if (occupant) {
    throw new ConflictError(
      'Seat ' + seat.seatCode + ' is currently occupied by ' + occupant.name + '.',
      'SEAT_ALREADY_OCCUPIED',
      { seatCode: seat.seatCode, occupantId: occupant.id, occupantName: occupant.name },
    );
  }
}

function assertEmployeeAssignable(employee: LoadedEmployee): void {
  if (employee.status === 'INACTIVE') {
    throw new ConflictError(
      employee.name + ' is marked inactive and cannot be given a seat.',
      'EMPLOYEE_INACTIVE',
      { employeeId: employee.id },
    );
  }
}

// -------------------------------------------------------------- audit recording

interface AuditInput {
  action: Prisma.AuditLogCreateInput['action'];
  source: AuditSource;
  actorId: string | null;
  employeeId?: string | null;
  previousSeatId?: string | null;
  newSeatId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue;
}

async function recordAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      action: input.action,
      source: input.source,
      status: 'SUCCESS',
      userId: input.actorId,
      employeeId: input.employeeId ?? null,
      previousSeatId: input.previousSeatId ?? null,
      newSeatId: input.newSeatId ?? null,
      summary: input.summary,
      metadata: input.metadata,
    },
  });
}

// ------------------------------------------------------------- core primitives

/** Releases the live assignment on a seat. Returns the released employee, if any. */
async function releaseAssignmentForSeat(tx: Tx, seatId: string) {
  const assignment = await tx.seatAssignment.findFirst({
    where: { seatId, active: true },
    include: { employee: true },
  });
  if (!assignment) return null;

  await tx.seatAssignment.update({
    where: { id: assignment.id },
    data: { releasedAt: new Date(), active: null },
  });
  return assignment;
}

async function createAssignment(tx: Tx, employeeId: string, seatId: string, actorId: string | null) {
  return tx.seatAssignment.create({
    data: { employeeId, seatId, active: true, assignedBy: actorId },
  });
}

/**
 * Keeps the denormalised `Seat.status` in step with the assignment table.
 * DISABLED is sticky: releasing a seat never silently re-enables it.
 */
async function syncSeatStatus(tx: Tx, seatId: string, occupied: boolean): Promise<void> {
  const seat = await tx.seat.findUniqueOrThrow({ where: { id: seatId }, select: { status: true } });
  if (seat.status === 'DISABLED') return;
  await tx.seat.update({
    where: { id: seatId },
    data: { status: occupied ? 'OCCUPIED' : 'AVAILABLE' },
  });
}

// ------------------------------------------------------------------ operations

export async function assignSeat(
  input: { employeeId: string; seatId: string },
  ctx: ActionContext,
): Promise<SeatingResult> {
  return prisma.$transaction(async (tx) => {
    const [seat, employee] = await Promise.all([
      loadSeat(tx, input.seatId),
      loadEmployee(tx, input.employeeId),
    ]);

    assertEmployeeAssignable(employee);

    const currentAssignment = employee.assignments[0];
    if (currentAssignment) {
      if (currentAssignment.seatId === seat.id) {
        throw new ConflictError(
          employee.name + ' is already seated at ' + seat.seatCode + '.',
          'ALREADY_AT_SEAT',
          { seatCode: seat.seatCode },
        );
      }
      throw new ConflictError(
        employee.name +
          ' already holds seat ' +
          currentAssignment.seat.seatCode +
          '. Use "Move" to relocate them.',
        'EMPLOYEE_ALREADY_SEATED',
        {
          employeeId: employee.id,
          currentSeatId: currentAssignment.seatId,
          currentSeatCode: currentAssignment.seat.seatCode,
        },
      );
    }

    assertSeatAssignable(seat);

    await createAssignment(tx, employee.id, seat.id, ctx.actorId);
    await syncSeatStatus(tx, seat.id, true);

    const summary = employee.name + ' assigned to seat ' + seat.seatCode;
    await recordAudit(tx, {
      action: 'EMPLOYEE_ASSIGNED',
      source: ctx.source,
      actorId: ctx.actorId,
      employeeId: employee.id,
      newSeatId: seat.id,
      summary,
      metadata: {
        seatCode: seat.seatCode,
        floor: seat.floor.name,
        building: seat.floor.building.name,
        department: employee.department,
        ...(ctx.aiActionId ? { aiActionId: ctx.aiActionId } : {}),
      },
    });

    return {
      seat: await readSeatDto(tx, seat.id),
      previousSeat: null,
      employee: await readEmployeeDto(tx, employee.id),
      summary,
    };
  });
}

export async function releaseSeat(
  input: { seatId: string },
  ctx: ActionContext,
): Promise<SeatingResult> {
  return prisma.$transaction(async (tx) => {
    const seat = await loadSeat(tx, input.seatId);
    const assignment = seat.assignments[0];
    if (!assignment) {
      throw new ConflictError(
        'Seat ' + seat.seatCode + ' is not assigned to anyone, so there is nothing to release.',
        'SEAT_NOT_OCCUPIED',
        { seatCode: seat.seatCode },
      );
    }

    await releaseAssignmentForSeat(tx, seat.id);
    await syncSeatStatus(tx, seat.id, false);

    const summary = assignment.employee.name + ' released from seat ' + seat.seatCode;
    await recordAudit(tx, {
      action: 'SEAT_RELEASED',
      source: ctx.source,
      actorId: ctx.actorId,
      employeeId: assignment.employee.id,
      previousSeatId: seat.id,
      summary,
      metadata: {
        seatCode: seat.seatCode,
        floor: seat.floor.name,
        department: assignment.employee.department,
        ...(ctx.aiActionId ? { aiActionId: ctx.aiActionId } : {}),
      },
    });

    return {
      seat: await readSeatDto(tx, seat.id),
      previousSeat: null,
      employee: await readEmployeeDto(tx, assignment.employee.id),
      summary,
    };
  });
}

/** Releases whatever seat an employee currently holds. */
export async function releaseEmployeeSeat(
  input: { employeeId: string },
  ctx: ActionContext,
): Promise<SeatingResult> {
  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    include: { assignments: { where: { active: true }, take: 1 } },
  });
  if (!employee) throw new NotFoundError('That employee no longer exists.');

  const assignment = employee.assignments[0];
  if (!assignment) {
    throw new ConflictError(
      employee.name + ' does not currently hold a seat.',
      'EMPLOYEE_NOT_SEATED',
      { employeeId: employee.id },
    );
  }
  return releaseSeat({ seatId: assignment.seatId }, ctx);
}

/**
 * Atomically relocates an employee. The previous seat is released and the new
 * one assigned inside a single transaction, so an interrupted move can never
 * leave the employee holding two seats or none.
 */
export async function moveEmployee(
  input: { employeeId: string; toSeatId: string },
  ctx: ActionContext,
): Promise<SeatingResult> {
  return prisma.$transaction(async (tx) => {
    const [employee, targetSeat] = await Promise.all([
      loadEmployee(tx, input.employeeId),
      loadSeat(tx, input.toSeatId),
    ]);

    assertEmployeeAssignable(employee);

    const currentAssignment = employee.assignments[0];
    if (currentAssignment && currentAssignment.seatId === targetSeat.id) {
      throw new ConflictError(
        employee.name + ' is already seated at ' + targetSeat.seatCode + '.',
        'ALREADY_AT_SEAT',
        { seatCode: targetSeat.seatCode },
      );
    }

    assertSeatAssignable(targetSeat);

    const fromSeat = currentAssignment?.seat ?? null;

    if (currentAssignment) {
      await releaseAssignmentForSeat(tx, currentAssignment.seatId);
      await syncSeatStatus(tx, currentAssignment.seatId, false);
    }

    await createAssignment(tx, employee.id, targetSeat.id, ctx.actorId);
    await syncSeatStatus(tx, targetSeat.id, true);

    const summary = fromSeat
      ? employee.name + ' moved from ' + fromSeat.seatCode + ' to ' + targetSeat.seatCode
      : employee.name + ' assigned to seat ' + targetSeat.seatCode;

    await recordAudit(tx, {
      action: fromSeat ? 'EMPLOYEE_MOVED' : 'EMPLOYEE_ASSIGNED',
      source: ctx.source,
      actorId: ctx.actorId,
      employeeId: employee.id,
      previousSeatId: fromSeat?.id ?? null,
      newSeatId: targetSeat.id,
      summary,
      metadata: {
        fromSeatCode: fromSeat?.seatCode ?? null,
        toSeatCode: targetSeat.seatCode,
        fromFloor: fromSeat?.floor.name ?? null,
        toFloor: targetSeat.floor.name,
        department: employee.department,
        ...(ctx.aiActionId ? { aiActionId: ctx.aiActionId } : {}),
      },
    });

    return {
      seat: await readSeatDto(tx, targetSeat.id),
      previousSeat: fromSeat ? await readSeatDto(tx, fromSeat.id) : null,
      employee: await readEmployeeDto(tx, employee.id),
      summary,
    };
  });
}

const STATUS_TRANSITIONS: Record<string, { action: Prisma.AuditLogCreateInput['action']; verb: string }> = {
  DISABLED: { action: 'SEAT_DISABLED', verb: 'disabled' },
  AVAILABLE: { action: 'SEAT_ENABLED', verb: 'enabled' },
  RESERVED: { action: 'SEAT_RESERVED', verb: 'reserved' },
};

/**
 * Manual status changes. OCCUPIED is not settable directly — a seat becomes
 * occupied only by assigning someone to it.
 */
export async function setSeatStatus(
  input: { seatId: string; status: Extract<SeatStatus, 'AVAILABLE' | 'RESERVED' | 'DISABLED'>; notes?: string | null },
  ctx: ActionContext,
): Promise<SeatingResult> {
  return prisma.$transaction(async (tx) => {
    const seat = await loadSeat(tx, input.seatId);
    const occupant = seat.assignments[0]?.employee;

    if (seat.status === input.status) {
      throw new ConflictError(
        'Seat ' + seat.seatCode + ' is already ' + input.status.toLowerCase() + '.',
        'SEAT_STATUS_UNCHANGED',
        { seatCode: seat.seatCode, status: seat.status },
      );
    }

    if (occupant) {
      throw new ConflictError(
        'Seat ' +
          seat.seatCode +
          ' is occupied by ' +
          occupant.name +
          '. Release the seat before changing its status.',
        'SEAT_OCCUPIED',
        { seatCode: seat.seatCode, occupantName: occupant.name },
      );
    }

    const transition = STATUS_TRANSITIONS[input.status];
    if (!transition) {
      throw new AppError(400, 'UNSUPPORTED_STATUS', 'A seat cannot be set to that status directly.');
    }

    await tx.seat.update({
      where: { id: seat.id },
      data: {
        status: input.status,
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      },
    });

    const wasDisabled = seat.status === 'DISABLED';
    const action =
      input.status === 'AVAILABLE' && !wasDisabled ? 'SEAT_UNRESERVED' : transition.action;
    const verb = input.status === 'AVAILABLE' && !wasDisabled ? 'released from reserved' : transition.verb;
    const summary = 'Seat ' + seat.seatCode + ' ' + verb;

    await recordAudit(tx, {
      action,
      source: ctx.source,
      actorId: ctx.actorId,
      previousSeatId: seat.id,
      newSeatId: seat.id,
      summary,
      metadata: {
        seatCode: seat.seatCode,
        from: seat.status,
        to: input.status,
        floor: seat.floor.name,
        ...(ctx.aiActionId ? { aiActionId: ctx.aiActionId } : {}),
      },
    });

    return {
      seat: await readSeatDto(tx, seat.id),
      previousSeat: null,
      employee: null,
      summary,
    };
  });
}
