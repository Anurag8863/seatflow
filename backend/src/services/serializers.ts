import { Prisma } from '@prisma/client';

/**
 * Shared Prisma `include` fragments. Declaring them once (with
 * `Prisma.validator`) means the serializers below are typed against exactly the
 * shape the queries fetch — a missing relation becomes a compile error rather
 * than an `undefined` at runtime.
 */

export const activeAssignmentInclude = Prisma.validator<Prisma.Seat$assignmentsArgs>()({
  where: { active: true },
  include: {
    employee: {
      select: {
        id: true,
        employeeCode: true,
        name: true,
        email: true,
        department: true,
        jobTitle: true,
        status: true,
      },
    },
  },
  take: 1,
});

export const seatInclude = Prisma.validator<Prisma.SeatInclude>()({
  floor: { include: { building: true } },
  assignments: activeAssignmentInclude,
});

export type SeatWithRelations = Prisma.SeatGetPayload<{ include: typeof seatInclude }>;

export const employeeInclude = Prisma.validator<Prisma.EmployeeInclude>()({
  assignments: {
    where: { active: true },
    include: { seat: { include: { floor: { include: { building: true } } } } },
    take: 1,
  },
});

export type EmployeeWithRelations = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

export const auditLogInclude = Prisma.validator<Prisma.AuditLogInclude>()({
  user: { select: { id: true, name: true, email: true } },
  employee: { select: { id: true, name: true, employeeCode: true, department: true } },
  previousSeat: { select: { id: true, seatCode: true } },
  newSeat: { select: { id: true, seatCode: true } },
});

export type AuditLogWithRelations = Prisma.AuditLogGetPayload<{ include: typeof auditLogInclude }>;

// ------------------------------------------------------------------ DTO types

export interface FloorSummaryDto {
  id: string;
  name: string;
  floorNumber: number;
  buildingId: string;
  buildingName: string;
  buildingCode: string;
}

export interface SeatOccupantDto {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  department: string;
  jobTitle: string;
}

export interface SeatDto {
  id: string;
  seatCode: string;
  zone: string;
  status: string;
  notes: string | null;
  xPosition: number;
  yPosition: number;
  updatedAt: string;
  floor: FloorSummaryDto;
  occupant: SeatOccupantDto | null;
  assignedAt: string | null;
}

export interface EmployeeSeatDto {
  id: string;
  seatCode: string;
  zone: string;
  status: string;
  assignedAt: string;
  floor: FloorSummaryDto;
}

export interface EmployeeDto {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  department: string;
  jobTitle: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  seat: EmployeeSeatDto | null;
}

export interface AuditLogDto {
  id: string;
  action: string;
  source: string;
  status: string;
  summary: string;
  metadata: unknown;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
  employee: { id: string; name: string; employeeCode: string; department: string } | null;
  previousSeat: { id: string; seatCode: string } | null;
  newSeat: { id: string; seatCode: string } | null;
}

// ----------------------------------------------------------------- serializers

function toFloorSummary(floor: {
  id: string;
  name: string;
  floorNumber: number;
  building: { id: string; name: string; code: string };
}): FloorSummaryDto {
  return {
    id: floor.id,
    name: floor.name,
    floorNumber: floor.floorNumber,
    buildingId: floor.building.id,
    buildingName: floor.building.name,
    buildingCode: floor.building.code,
  };
}

export function serializeSeat(seat: SeatWithRelations): SeatDto {
  const assignment = seat.assignments[0];
  return {
    id: seat.id,
    seatCode: seat.seatCode,
    zone: seat.zone,
    status: seat.status,
    notes: seat.notes,
    xPosition: seat.xPosition,
    yPosition: seat.yPosition,
    updatedAt: seat.updatedAt.toISOString(),
    floor: toFloorSummary(seat.floor),
    occupant: assignment
      ? {
          id: assignment.employee.id,
          employeeCode: assignment.employee.employeeCode,
          name: assignment.employee.name,
          email: assignment.employee.email,
          department: assignment.employee.department,
          jobTitle: assignment.employee.jobTitle,
        }
      : null,
    assignedAt: assignment ? assignment.assignedAt.toISOString() : null,
  };
}

export function serializeEmployee(employee: EmployeeWithRelations): EmployeeDto {
  const assignment = employee.assignments[0];
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    name: employee.name,
    email: employee.email,
    department: employee.department,
    jobTitle: employee.jobTitle,
    status: employee.status,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
    seat: assignment
      ? {
          id: assignment.seat.id,
          seatCode: assignment.seat.seatCode,
          zone: assignment.seat.zone,
          status: assignment.seat.status,
          assignedAt: assignment.assignedAt.toISOString(),
          floor: toFloorSummary(assignment.seat.floor),
        }
      : null,
  };
}

export function serializeAuditLog(log: AuditLogWithRelations): AuditLogDto {
  return {
    id: log.id,
    action: log.action,
    source: log.source,
    status: log.status,
    summary: log.summary,
    metadata: log.metadata ?? null,
    createdAt: log.createdAt.toISOString(),
    user: log.user ? { id: log.user.id, name: log.user.name, email: log.user.email } : null,
    employee: log.employee
      ? {
          id: log.employee.id,
          name: log.employee.name,
          employeeCode: log.employee.employeeCode,
          department: log.employee.department,
        }
      : null,
    previousSeat: log.previousSeat
      ? { id: log.previousSeat.id, seatCode: log.previousSeat.seatCode }
      : null,
    newSeat: log.newSeat ? { id: log.newSeat.id, seatCode: log.newSeat.seatCode } : null,
  };
}
