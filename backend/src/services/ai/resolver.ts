import { prisma } from '../../db/prisma.js';
import { normalizeSeatCode } from './providers/local.js';
import type {
  AiAmbiguityOption,
  AiAnswerSeat,
  AiIntent,
  AiPreview,
  ResolvedPlan,
} from './types.js';

/**
 * Resolution layer.
 *
 * Everything the model produced is treated as untrusted free text. Each
 * reference is looked up in the database; anything that does not resolve to
 * exactly one real row becomes a clarification or a rejection. Only after every
 * reference resolves and every seating rule passes is an `ExecutableCommand`
 * built — and even then it still needs the administrator to confirm.
 */

type EmployeeRow = Awaited<ReturnType<typeof findEmployeeCandidates>>[number];

const employeeSelect = {
  id: true,
  name: true,
  employeeCode: true,
  email: true,
  department: true,
  jobTitle: true,
  status: true,
  assignments: {
    where: { active: true },
    take: 1,
    select: {
      seat: {
        select: {
          id: true,
          seatCode: true,
          zone: true,
          floor: { select: { id: true, name: true, floorNumber: true, building: { select: { name: true } } } },
        },
      },
    },
  },
} as const;

const seatSelect = {
  id: true,
  seatCode: true,
  zone: true,
  status: true,
  floor: {
    select: {
      id: true,
      name: true,
      floorNumber: true,
      building: { select: { id: true, name: true, code: true } },
    },
  },
  assignments: {
    where: { active: true },
    take: 1,
    select: { employee: { select: { id: true, name: true, department: true } } },
  },
} as const;

type SeatRow = NonNullable<Awaited<ReturnType<typeof findSeatByCode>>>;

// ------------------------------------------------------------------- employees

async function findEmployeeCandidates(query: string) {
  const term = query.trim();
  if (!term) return [];

  // Ordered from most to least specific; the first tier that matches wins.
  const exact = await prisma.employee.findMany({
    where: {
      OR: [
        { employeeCode: { equals: term, mode: 'insensitive' } },
        { email: { equals: term, mode: 'insensitive' } },
        { name: { equals: term, mode: 'insensitive' } },
      ],
    },
    select: employeeSelect,
    take: 10,
  });
  if (exact.length) return exact;

  const tokens = term.split(/\s+/).filter(Boolean);
  const tokenMatches = await prisma.employee.findMany({
    where: { AND: tokens.map((token) => ({ name: { contains: token, mode: 'insensitive' as const } })) },
    select: employeeSelect,
    take: 10,
  });
  if (tokenMatches.length) return tokenMatches;

  return prisma.employee.findMany({
    where: { name: { contains: term, mode: 'insensitive' } },
    select: employeeSelect,
    take: 10,
  });
}

function employeeOption(employee: EmployeeRow): AiAmbiguityOption {
  const seat = employee.assignments[0]?.seat;
  return {
    id: employee.id,
    label: employee.name + ' (' + employee.employeeCode + ')',
    description:
      employee.department +
      ' · ' +
      employee.jobTitle +
      ' · ' +
      (seat ? 'seat ' + seat.seatCode + ' on ' + seat.floor.name : 'no seat assigned'),
  };
}

interface EmployeeResolution {
  employee?: EmployeeRow;
  plan?: ResolvedPlan;
}

/**
 * @param hintSeatCode When the admin said "move Priya from A-12", the current
 * seat is used to pick between people who share a name.
 */
async function resolveEmployee(
  intent: AiIntent,
  action: ResolvedPlan['action'],
  explicitId: string | null,
  hintSeatCode?: string | null,
): Promise<EmployeeResolution> {
  if (explicitId) {
    const employee = await prisma.employee.findUnique({ where: { id: explicitId }, select: employeeSelect });
    if (employee) return { employee };
  }

  const query = intent.employeeQuery?.trim();
  if (!query) {
    return {
      plan: {
        kind: 'clarification',
        action,
        message: 'Which employee did you mean? Give me a name or an employee ID.',
        confidence: intent.confidence ?? 0.4,
        reason: intent.reason ?? null,
      },
    };
  }

  let candidates = await findEmployeeCandidates(query);

  if (candidates.length > 1 && hintSeatCode) {
    const normalized = normalizeSeatCode(hintSeatCode);
    const narrowed = candidates.filter((row) => row.assignments[0]?.seat.seatCode === normalized);
    if (narrowed.length === 1) candidates = narrowed;
  }

  if (candidates.length === 0) {
    return {
      plan: {
        kind: 'rejected',
        action,
        message: 'I could not find an employee named "' + query + '".',
        confidence: intent.confidence ?? 0.5,
        reason: intent.reason ?? null,
      },
    };
  }

  if (candidates.length > 1) {
    return {
      plan: {
        kind: 'clarification',
        action,
        message:
          'I found ' + candidates.length + ' people matching "' + query + '". Which one did you mean?',
        options: candidates.map(employeeOption),
        optionKind: 'employee',
        confidence: intent.confidence ?? 0.5,
        reason: intent.reason ?? null,
      },
    };
  }

  return { employee: candidates[0] };
}

// ----------------------------------------------------------------------- seats

async function findSeatByCode(code: string) {
  const normalized = normalizeSeatCode(code) ?? code.trim().toUpperCase();
  return prisma.seat.findFirst({
    where: { seatCode: { equals: normalized, mode: 'insensitive' } },
    select: seatSelect,
  });
}

async function findSeatCandidates(code: string) {
  const compact = code.replace(/[\s-–—]/g, '').toUpperCase();
  return prisma.seat.findMany({
    where: { seatCode: { contains: compact.slice(0, 1), mode: 'insensitive' } },
    select: seatSelect,
    take: 6,
  });
}

interface SeatResolution {
  seat?: SeatRow;
  plan?: ResolvedPlan;
}

async function resolveSeat(
  code: string,
  action: ResolvedPlan['action'],
  intent: AiIntent,
): Promise<SeatResolution> {
  const seat = await findSeatByCode(code);
  if (seat) return { seat };

  const near = await findSeatCandidates(code);
  return {
    plan: {
      kind: 'rejected',
      action,
      message:
        'There is no seat with the code "' +
        code.toUpperCase() +
        '".' +
        (near.length ? ' Did you mean ' + near.slice(0, 3).map((row) => row.seatCode).join(', ') + '?' : ''),
      confidence: intent.confidence ?? 0.5,
      reason: intent.reason ?? null,
    },
  };
}

// ---------------------------------------------------------------------- floors

interface FloorResolution {
  floor?: { id: string; name: string; floorNumber: number; building: { id: string; name: string } };
  plan?: ResolvedPlan;
}

async function resolveFloor(
  floorQuery: string,
  buildingQuery: string | null | undefined,
  action: ResolvedPlan['action'],
  intent: AiIntent,
  /** The building the admin is currently viewing, used to break ties. */
  scopeBuildingId?: string | null,
): Promise<FloorResolution> {
  const numberMatch = floorQuery.match(/(\d{1,2})/);
  const floorNumber = numberMatch?.[1] ? Number(numberMatch[1]) : null;

  const floors = await prisma.floor.findMany({
    where: {
      AND: [
        floorNumber === null
          ? { name: { contains: floorQuery.trim(), mode: 'insensitive' } }
          : { OR: [{ floorNumber }, { name: { contains: floorQuery.trim(), mode: 'insensitive' } }] },
        buildingQuery
          ? {
              building: {
                OR: [
                  { name: { contains: buildingQuery, mode: 'insensitive' } },
                  { code: { equals: buildingQuery, mode: 'insensitive' } },
                ],
              },
            }
          : {},
      ],
    },
    select: {
      id: true,
      name: true,
      floorNumber: true,
      building: { select: { id: true, name: true } },
    },
    orderBy: [{ building: { name: 'asc' } }, { floorNumber: 'asc' }],
  });

  if (floors.length === 0) {
    return {
      plan: {
        kind: 'rejected',
        action,
        message: 'I could not find a floor matching "' + floorQuery + '".',
        confidence: intent.confidence ?? 0.5,
        reason: intent.reason ?? null,
      },
    };
  }

  if (floors.length > 1) {
    // Every building has a "Floor 2", so an unqualified floor name is resolved
    // against the office the administrator is currently looking at before
    // falling back to asking them.
    if (scopeBuildingId) {
      const scoped = floors.filter((floor) => floor.building.id === scopeBuildingId);
      if (scoped.length === 1) return { floor: scoped[0] };
    }

    return {
      plan: {
        kind: 'clarification',
        action,
        message: 'There is a "' + floorQuery + '" in more than one building. Which one did you mean?',
        options: floors.map((floor) => ({
          id: floor.id,
          label: floor.building.name + ' - ' + floor.name,
          description: 'Floor ' + floor.floorNumber + ' of ' + floor.building.name,
        })),
        optionKind: 'floor',
        confidence: intent.confidence ?? 0.5,
        reason: intent.reason ?? null,
      },
    };
  }

  return { floor: floors[0] };
}

async function findAvailableSeats(where: { floorId?: string; zone?: string; buildingId?: string }, take = 25) {
  return prisma.seat.findMany({
    where: {
      status: 'AVAILABLE',
      ...(where.floorId ? { floorId: where.floorId } : {}),
      ...(where.zone ? { zone: where.zone } : {}),
      ...(where.buildingId ? { floor: { buildingId: where.buildingId } } : {}),
    },
    select: seatSelect,
    orderBy: { seatCode: 'asc' },
    take,
  });
}

function toAnswerSeat(seat: SeatRow): AiAnswerSeat {
  return {
    id: seat.id,
    seatCode: seat.seatCode,
    zone: seat.zone,
    floorName: seat.floor.name,
    buildingName: seat.floor.building.name,
    status: seat.status,
  };
}

// -------------------------------------------------------------- shared guards

function seatBlockedPlan(
  seat: SeatRow,
  action: ResolvedPlan['action'],
  intent: AiIntent,
): ResolvedPlan | null {
  if (seat.status === 'DISABLED') {
    return {
      kind: 'rejected',
      action,
      message: 'Seat ' + seat.seatCode + ' is disabled and cannot be assigned. Enable it first.',
      confidence: intent.confidence ?? 0.8,
      reason: intent.reason ?? null,
    };
  }
  const occupant = seat.assignments[0]?.employee;
  if (occupant) {
    return {
      kind: 'rejected',
      action,
      message: 'Seat ' + seat.seatCode + ' is currently occupied by ' + occupant.name + '.',
      confidence: intent.confidence ?? 0.8,
      reason: intent.reason ?? null,
    };
  }
  return null;
}

function movePreview(
  employee: EmployeeRow,
  toSeat: SeatRow,
  reason: string | null,
  warnings: string[],
): AiPreview {
  const current = employee.assignments[0]?.seat;
  return {
    title: current ? 'Move ' + employee.name : 'Assign ' + employee.name,
    description: current
      ? employee.name + ' will be moved from ' + current.seatCode + ' to ' + toSeat.seatCode + '.'
      : employee.name + ' will be assigned to ' + toSeat.seatCode + '.',
    fields: [
      { label: 'Employee', value: employee.name + ' (' + employee.employeeCode + ')' },
      { label: 'Department', value: employee.department },
      { label: 'Current seat', value: current ? current.seatCode : 'Not assigned', muted: true },
      { label: 'New seat', value: toSeat.seatCode },
      { label: 'Location', value: toSeat.floor.building.name + ' · ' + toSeat.floor.name + ' · Zone ' + toSeat.zone },
      { label: 'Reason', value: reason ?? 'Requested by administrator' },
    ],
    warnings,
  };
}

// ------------------------------------------------------------------ the resolver

export interface ResolveOptions {
  /** Set when the admin picked a specific person from an ambiguity prompt. */
  selectedEmployeeId?: string | null;
  selectedFloorId?: string | null;
  /** The building currently open in the UI; disambiguates bare floor names. */
  scopeBuildingId?: string | null;
}

export async function resolveIntent(intent: AiIntent, options: ResolveOptions = {}): Promise<ResolvedPlan> {
  const confidence = intent.confidence ?? 0.7;
  const reason = intent.reason ?? null;
  const action = intent.action;

  switch (action) {
    // ------------------------------------------------------------- mutations
    case 'MOVE_EMPLOYEE':
    case 'ASSIGN_EMPLOYEE': {
      const resolution = await resolveEmployee(
        intent,
        action,
        options.selectedEmployeeId ?? null,
        intent.fromSeatCode,
      );
      if (resolution.plan) return resolution.plan;
      const employee = resolution.employee as EmployeeRow;

      if (employee.status === 'INACTIVE') {
        return {
          kind: 'rejected',
          action,
          message: employee.name + ' is marked inactive and cannot be given a seat.',
          confidence,
          reason,
        };
      }

      const currentSeat = employee.assignments[0]?.seat ?? null;
      const warnings: string[] = [];

      // Destination: an explicit seat code, or the first free seat on a floor.
      let targetSeat: SeatRow | null = null;

      if (intent.toSeatCode) {
        const seatResolution = await resolveSeat(intent.toSeatCode, action, intent);
        if (seatResolution.plan) return seatResolution.plan;
        targetSeat = seatResolution.seat as SeatRow;
      } else if (intent.floorQuery || options.selectedFloorId) {
        let floorId = options.selectedFloorId ?? null;
        let floorLabel = '';
        if (!floorId) {
          const floorResolution = await resolveFloor(
            intent.floorQuery as string,
            intent.buildingQuery,
            action,
            intent,
            options.scopeBuildingId,
          );
          if (floorResolution.plan) return floorResolution.plan;
          floorId = floorResolution.floor!.id;
          floorLabel = floorResolution.floor!.name;
        }
        const [firstFree] = await findAvailableSeats(
          { floorId, ...(intent.zone ? { zone: intent.zone.toUpperCase() } : {}) },
          1,
        );
        if (!firstFree) {
          return {
            kind: 'rejected',
            action,
            message: 'There are no available seats on ' + (floorLabel || 'that floor') + ' right now.',
            confidence,
            reason,
          };
        }
        targetSeat = firstFree;
        warnings.push('No seat was named, so the first free seat on that floor was chosen.');
      } else {
        return {
          kind: 'clarification',
          action,
          message:
            'Where should ' + employee.name + ' go? Give me a seat code (like B-07) or a floor.',
          confidence,
          reason,
        };
      }

      if (currentSeat && currentSeat.id === targetSeat.id) {
        return {
          kind: 'rejected',
          action,
          message: employee.name + ' is already seated at ' + targetSeat.seatCode + '.',
          confidence,
          reason,
        };
      }

      const blocked = seatBlockedPlan(targetSeat, action, intent);
      if (blocked) return blocked;

      if (intent.fromSeatCode) {
        const stated = normalizeSeatCode(intent.fromSeatCode);
        if (stated && currentSeat && currentSeat.seatCode !== stated) {
          warnings.push(
            'You mentioned ' + stated + ', but ' + employee.name + ' is currently at ' + currentSeat.seatCode + '.',
          );
        }
        if (stated && !currentSeat) {
          warnings.push('You mentioned ' + stated + ', but ' + employee.name + ' does not hold a seat right now.');
        }
      }

      if (action === 'ASSIGN_EMPLOYEE' && currentSeat) {
        warnings.push(
          employee.name +
            ' already holds ' +
            currentSeat.seatCode +
            '. Confirming will release it and move them — nobody ends up with two seats.',
        );
      }

      return {
        kind: 'mutation',
        action,
        // MOVE_EMPLOYEE handles both cases atomically: it releases any current
        // seat and takes the new one in a single transaction.
        command: { type: 'MOVE_EMPLOYEE', employeeId: employee.id, toSeatId: targetSeat.id },
        preview: movePreview(employee, targetSeat, reason, warnings),
        confidence,
        reason,
      };
    }

    case 'RELEASE_SEAT': {
      let seat: SeatRow | null = null;

      if (intent.seatCode) {
        const seatResolution = await resolveSeat(intent.seatCode, action, intent);
        if (seatResolution.plan) return seatResolution.plan;
        seat = seatResolution.seat as SeatRow;
      } else {
        const resolution = await resolveEmployee(intent, action, options.selectedEmployeeId ?? null);
        if (resolution.plan) return resolution.plan;
        const employee = resolution.employee as EmployeeRow;
        const held = employee.assignments[0]?.seat;
        if (!held) {
          return {
            kind: 'rejected',
            action,
            message: employee.name + ' does not currently hold a seat.',
            confidence,
            reason,
          };
        }
        const seatResolution = await resolveSeat(held.seatCode, action, intent);
        if (seatResolution.plan) return seatResolution.plan;
        seat = seatResolution.seat as SeatRow;
      }

      const occupant = seat.assignments[0]?.employee;
      if (!occupant) {
        return {
          kind: 'rejected',
          action,
          message: 'Seat ' + seat.seatCode + ' is not assigned to anyone, so there is nothing to release.',
          confidence,
          reason,
        };
      }

      return {
        kind: 'mutation',
        action,
        command: { type: 'RELEASE_SEAT', seatId: seat.id },
        preview: {
          title: 'Release seat ' + seat.seatCode,
          description: occupant.name + ' will be unassigned and ' + seat.seatCode + ' becomes available.',
          fields: [
            { label: 'Seat', value: seat.seatCode },
            { label: 'Current occupant', value: occupant.name, muted: true },
            { label: 'Department', value: occupant.department },
            { label: 'Location', value: seat.floor.building.name + ' · ' + seat.floor.name },
            { label: 'Reason', value: reason ?? 'Requested by administrator' },
          ],
          warnings: [],
        },
        confidence,
        reason,
      };
    }

    case 'BULK_MOVE_DEPARTMENT': {
      if (!intent.department) {
        return {
          kind: 'clarification',
          action,
          message: 'Which department should I move?',
          confidence,
          reason,
        };
      }
      if (!intent.floorQuery && !options.selectedFloorId) {
        return {
          kind: 'clarification',
          action,
          message: 'Which floor should I move the ' + intent.department + ' team to?',
          confidence,
          reason,
        };
      }

      let floorId = options.selectedFloorId ?? null;
      let floorName = 'the selected floor';
      let buildingName = '';
      if (!floorId) {
        const floorResolution = await resolveFloor(
          intent.floorQuery as string,
          intent.buildingQuery,
          action,
          intent,
          options.scopeBuildingId,
        );
        if (floorResolution.plan) return floorResolution.plan;
        floorId = floorResolution.floor!.id;
        floorName = floorResolution.floor!.name;
        buildingName = floorResolution.floor!.building.name;
      }

      const employees = await prisma.employee.findMany({
        where: {
          department: { equals: intent.department, mode: 'insensitive' },
          status: { not: 'INACTIVE' },
          ...(intent.onlyUnassigned ? { assignments: { none: { active: true } } } : {}),
        },
        select: employeeSelect,
        orderBy: { name: 'asc' },
      });

      // Anyone already sitting on the destination floor needs no move.
      const movable = employees.filter((employee) => employee.assignments[0]?.seat.floor.id !== floorId);

      if (movable.length === 0) {
        return {
          kind: 'rejected',
          action,
          message:
            employees.length === 0
              ? 'I could not find any ' + intent.department + ' employees that match.'
              : 'Every matching ' + intent.department + ' employee is already on ' + floorName + '.',
          confidence,
          reason,
        };
      }

      const freeSeats = await findAvailableSeats({ floorId }, movable.length);
      if (freeSeats.length === 0) {
        return {
          kind: 'rejected',
          action,
          message: 'There are no available seats on ' + floorName + ' right now.',
          confidence,
          reason,
        };
      }

      const pairCount = Math.min(movable.length, freeSeats.length);
      const moves = Array.from({ length: pairCount }, (_, index) => ({
        employeeId: movable[index]!.id,
        toSeatId: freeSeats[index]!.id,
      }));

      const warnings: string[] = [];
      if (freeSeats.length < movable.length) {
        warnings.push(
          'Only ' +
            freeSeats.length +
            ' of ' +
            movable.length +
            ' people can be seated — ' +
            floorName +
            ' does not have enough free seats.',
        );
      }

      return {
        kind: 'mutation',
        action,
        command: { type: 'BULK_MOVE', moves },
        preview: {
          title: 'Move ' + pairCount + ' ' + intent.department + ' ' + (pairCount === 1 ? 'employee' : 'employees'),
          description:
            pairCount +
            ' ' +
            (pairCount === 1 ? 'person' : 'people') +
            ' will be seated on ' +
            floorName +
            (buildingName ? ' (' + buildingName + ')' : '') +
            '.',
          fields: [
            { label: 'Department', value: intent.department },
            { label: 'Destination', value: floorName + (buildingName ? ' · ' + buildingName : '') },
            { label: 'People affected', value: String(pairCount) },
            { label: 'Reason', value: reason ?? 'Requested by administrator' },
          ],
          rows: moves.map((_move, index) => {
            const employee = movable[index]!;
            return {
              employeeName: employee.name,
              department: employee.department,
              fromSeatCode: employee.assignments[0]?.seat.seatCode ?? null,
              toSeatCode: freeSeats[index]!.seatCode,
            };
          }),
          warnings,
        },
        confidence,
        reason,
      };
    }

    // ----------------------------------------------------------- read-only
    case 'QUERY_AVAILABLE_SEATS': {
      let floorId: string | undefined;
      let scope = 'across every floor';

      if (intent.floorQuery || options.selectedFloorId) {
        if (options.selectedFloorId) {
          floorId = options.selectedFloorId;
          scope = 'on the selected floor';
        } else {
          const floorResolution = await resolveFloor(
            intent.floorQuery as string,
            intent.buildingQuery,
            action,
            intent,
            options.scopeBuildingId,
          );
          if (floorResolution.plan) return floorResolution.plan;
          floorId = floorResolution.floor!.id;
          scope = 'on ' + floorResolution.floor!.name;
        }
      }

      const zone = intent.zone ? intent.zone.toUpperCase() : undefined;
      const seats = await findAvailableSeats({ floorId, zone }, Math.min(intent.limit ?? 20, 50));
      const total = await prisma.seat.count({
        where: {
          status: 'AVAILABLE',
          ...(floorId ? { floorId } : {}),
          ...(zone ? { zone } : {}),
        },
      });

      return {
        kind: 'answer',
        action,
        answer: {
          text:
            total === 0
              ? 'There are no available seats ' + scope + ' right now.'
              : 'There ' +
                (total === 1 ? 'is 1 available seat ' : 'are ' + total + ' available seats ') +
                scope +
                (seats.length < total ? '. Showing the first ' + seats.length + '.' : '.'),
          seats: seats.map(toAnswerSeat),
        },
        confidence,
        reason,
      };
    }

    case 'QUERY_OCCUPANCY': {
      let floorId: string | undefined;
      let scope = 'Across all floors';

      if (intent.floorQuery || options.selectedFloorId) {
        if (options.selectedFloorId) {
          floorId = options.selectedFloorId;
          scope = 'On the selected floor';
        } else {
          const floorResolution = await resolveFloor(
            intent.floorQuery as string,
            intent.buildingQuery,
            action,
            intent,
            options.scopeBuildingId,
          );
          if (floorResolution.plan) return floorResolution.plan;
          floorId = floorResolution.floor!.id;
          scope = 'On ' + floorResolution.floor!.name;
        }
      }

      const grouped = await prisma.seat.groupBy({
        by: ['status'],
        where: floorId ? { floorId } : undefined,
        _count: { _all: true },
      });
      const counts: Record<string, number> = {};
      for (const row of grouped) counts[row.status] = row._count._all;

      const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
      const occupied = counts.OCCUPIED ?? 0;
      const disabled = counts.DISABLED ?? 0;
      const usable = total - disabled;
      const rate = usable > 0 ? Math.round((occupied / usable) * 100) : 0;

      return {
        kind: 'answer',
        action,
        answer: {
          text:
            total === 0
              ? 'There are no seats configured there yet.'
              : scope + ', ' + occupied + ' of ' + usable + ' usable seats are occupied (' + rate + '%).',
          stats: [
            { label: 'Occupied', value: String(occupied) },
            { label: 'Available', value: String(counts.AVAILABLE ?? 0) },
            { label: 'Reserved', value: String(counts.RESERVED ?? 0) },
            { label: 'Disabled', value: String(disabled) },
            { label: 'Occupancy', value: rate + '%' },
          ],
        },
        confidence,
        reason,
      };
    }

    case 'FIND_SEAT_NEAR_TEAM': {
      if (!intent.department) {
        return {
          kind: 'clarification',
          action,
          message: 'Which team should the seat be near?',
          confidence,
          reason,
        };
      }

      // Where does this department actually sit today?
      const teamSeats = await prisma.seat.findMany({
        where: {
          assignments: {
            some: { active: true, employee: { department: { equals: intent.department, mode: 'insensitive' } } },
          },
        },
        select: { zone: true, floorId: true, floor: { select: { name: true } } },
      });

      if (teamSeats.length === 0) {
        return {
          kind: 'answer',
          action,
          answer: {
            text:
              'Nobody from ' +
              intent.department +
              ' is seated yet, so there is no cluster to sit near. Any available seat works.',
            seats: (await findAvailableSeats({}, 6)).map(toAnswerSeat),
          },
          confidence,
          reason,
        };
      }

      const density = new Map<string, { count: number; floorId: string; zone: string; floorName: string }>();
      for (const seat of teamSeats) {
        const key = seat.floorId + '|' + seat.zone;
        const entry = density.get(key);
        if (entry) entry.count += 1;
        else density.set(key, { count: 1, floorId: seat.floorId, zone: seat.zone, floorName: seat.floor.name });
      }

      const ranked = [...density.values()].sort((a, b) => b.count - a.count);
      const suggestions: AiAnswerSeat[] = [];

      for (const cluster of ranked) {
        if (suggestions.length >= (intent.limit ?? 6)) break;
        const seats = await findAvailableSeats({ floorId: cluster.floorId, zone: cluster.zone }, 4);
        suggestions.push(...seats.map(toAnswerSeat));
      }

      const top = ranked[0]!;
      return {
        kind: 'answer',
        action,
        answer: {
          text: suggestions.length
            ? 'The ' +
              intent.department +
              ' team is densest in zone ' +
              top.zone +
              ' on ' +
              top.floorName +
              '. Here are the closest free seats.'
            : 'The ' +
              intent.department +
              ' team sits in zone ' +
              top.zone +
              ' on ' +
              top.floorName +
              ', but there are no free seats in their zones right now.',
          seats: suggestions.slice(0, intent.limit ?? 6),
        },
        confidence,
        reason,
      };
    }

    // ------------------------------------------------------------- non-actions
    case 'CLARIFICATION_NEEDED':
      return {
        kind: 'clarification',
        action,
        message:
          intent.clarification ??
          'I need a little more detail. Try naming the employee and the destination seat or floor.',
        confidence,
        reason,
      };

    default:
      return {
        kind: 'rejected',
        action: 'UNSUPPORTED',
        message:
          'That is not something the seating assistant can do. I can move, assign and release seats, ' +
          'and answer questions about availability and occupancy.',
        confidence,
        reason,
      };
  }
}
