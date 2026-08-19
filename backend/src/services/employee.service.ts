import { Prisma, type EmployeeStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import {
  employeeInclude,
  serializeEmployee,
  type EmployeeDto,
} from './serializers.js';

export type EmployeeSort = 'name' | 'employeeCode' | 'department' | 'jobTitle' | 'status' | 'createdAt';

export interface ListEmployeesParams {
  search?: string;
  department?: string;
  status?: EmployeeStatus;
  /** `assigned` = currently holds a seat, `unassigned` = does not. */
  seatState?: 'assigned' | 'unassigned';
  floorId?: string;
  page: number;
  pageSize: number;
  sortBy: EmployeeSort;
  sortDir: 'asc' | 'desc';
}

export function buildEmployeeWhere(params: Partial<ListEmployeesParams>): Prisma.EmployeeWhereInput {
  const where: Prisma.EmployeeWhereInput = {};
  const and: Prisma.EmployeeWhereInput[] = [];

  if (params.search) {
    const term = params.search.trim();
    if (term) {
      and.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
          { employeeCode: { contains: term, mode: 'insensitive' } },
          { department: { contains: term, mode: 'insensitive' } },
          { jobTitle: { contains: term, mode: 'insensitive' } },
          { assignments: { some: { active: true, seat: { seatCode: { contains: term, mode: 'insensitive' } } } } },
        ],
      });
    }
  }
  if (params.department) and.push({ department: params.department });
  if (params.status) and.push({ status: params.status });
  if (params.seatState === 'assigned') and.push({ assignments: { some: { active: true } } });
  if (params.seatState === 'unassigned') and.push({ assignments: { none: { active: true } } });
  if (params.floorId) {
    and.push({ assignments: { some: { active: true, seat: { floorId: params.floorId } } } });
  }

  if (and.length) where.AND = and;
  return where;
}

export async function listEmployees(
  params: ListEmployeesParams,
): Promise<{ items: EmployeeDto[]; total: number }> {
  const where = buildEmployeeWhere(params);
  const orderBy: Prisma.EmployeeOrderByWithRelationInput = { [params.sortBy]: params.sortDir };

  const [total, rows] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: employeeInclude,
    }),
  ]);

  return { items: rows.map(serializeEmployee), total };
}

export interface SeatingHistoryEntry {
  id: string;
  seatId: string;
  seatCode: string;
  zone: string;
  floorName: string;
  buildingName: string;
  assignedAt: string;
  releasedAt: string | null;
  active: boolean;
}

export async function getEmployeeDetail(
  employeeId: string,
): Promise<{ employee: EmployeeDto; history: SeatingHistoryEntry[] }> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: employeeInclude,
  });
  if (!employee) throw new NotFoundError('We could not find that employee.');

  const assignments = await prisma.seatAssignment.findMany({
    where: { employeeId },
    orderBy: { assignedAt: 'desc' },
    take: 50,
    include: { seat: { include: { floor: { include: { building: true } } } } },
  });

  return {
    employee: serializeEmployee(employee),
    history: assignments.map((assignment) => ({
      id: assignment.id,
      seatId: assignment.seatId,
      seatCode: assignment.seat.seatCode,
      zone: assignment.seat.zone,
      floorName: assignment.seat.floor.name,
      buildingName: assignment.seat.floor.building.name,
      assignedAt: assignment.assignedAt.toISOString(),
      releasedAt: assignment.releasedAt ? assignment.releasedAt.toISOString() : null,
      active: assignment.active === true,
    })),
  };
}

export interface EmployeeInput {
  employeeCode: string;
  name: string;
  email: string;
  department: string;
  jobTitle: string;
  status?: EmployeeStatus;
}

async function assertUnique(input: { employeeCode?: string; email?: string }, excludeId?: string) {
  const clauses: Prisma.EmployeeWhereInput[] = [];
  if (input.employeeCode) clauses.push({ employeeCode: input.employeeCode });
  if (input.email) clauses.push({ email: input.email.toLowerCase() });
  if (!clauses.length) return;

  const existing = await prisma.employee.findFirst({
    where: { OR: clauses, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { employeeCode: true, email: true },
  });
  if (!existing) return;

  if (input.employeeCode && existing.employeeCode === input.employeeCode) {
    throw new ConflictError(
      'Employee ID ' + input.employeeCode + ' is already in use.',
      'DUPLICATE_EMPLOYEE_CODE',
    );
  }
  throw new ConflictError('That email address is already registered.', 'DUPLICATE_EMAIL');
}

export async function createEmployee(input: EmployeeInput, actorId: string): Promise<EmployeeDto> {
  await assertUnique(input);

  const created = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: {
        employeeCode: input.employeeCode,
        name: input.name,
        email: input.email.toLowerCase(),
        department: input.department,
        jobTitle: input.jobTitle,
        status: input.status ?? 'ACTIVE',
      },
      include: employeeInclude,
    });

    await tx.auditLog.create({
      data: {
        action: 'EMPLOYEE_CREATED',
        source: 'MANUAL',
        status: 'SUCCESS',
        userId: actorId,
        employeeId: employee.id,
        summary: employee.name + ' added to the directory',
        metadata: { department: employee.department, jobTitle: employee.jobTitle },
      },
    });

    return employee;
  });

  return serializeEmployee(created);
}

export async function updateEmployee(
  employeeId: string,
  input: Partial<EmployeeInput>,
  actorId: string,
): Promise<EmployeeDto> {
  const existing = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!existing) throw new NotFoundError('We could not find that employee.');

  await assertUnique({ employeeCode: input.employeeCode, email: input.email }, employeeId);

  const changes: string[] = [];
  for (const key of ['employeeCode', 'name', 'email', 'department', 'jobTitle', 'status'] as const) {
    const next = input[key];
    if (next !== undefined && next !== existing[key]) changes.push(key);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.update({
      where: { id: employeeId },
      data: {
        ...(input.employeeCode === undefined ? {} : { employeeCode: input.employeeCode }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.email === undefined ? {} : { email: input.email.toLowerCase() }),
        ...(input.department === undefined ? {} : { department: input.department }),
        ...(input.jobTitle === undefined ? {} : { jobTitle: input.jobTitle }),
        ...(input.status === undefined ? {} : { status: input.status }),
      },
      include: employeeInclude,
    });

    if (changes.length) {
      await tx.auditLog.create({
        data: {
          action: 'EMPLOYEE_UPDATED',
          source: 'MANUAL',
          status: 'SUCCESS',
          userId: actorId,
          employeeId: employee.id,
          summary: employee.name + ' profile updated (' + changes.join(', ') + ')',
          metadata: { changedFields: changes },
        },
      });
    }

    return employee;
  });

  return serializeEmployee(updated);
}

export async function listDepartments(): Promise<Array<{ department: string; count: number }>> {
  const grouped = await prisma.employee.groupBy({
    by: ['department'],
    _count: { _all: true },
    orderBy: { department: 'asc' },
  });
  return grouped.map((row) => ({ department: row.department, count: row._count._all }));
}
