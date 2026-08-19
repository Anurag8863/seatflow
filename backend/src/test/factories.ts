import type { PrismaClient, SeatStatus } from '@prisma/client';

/**
 * Small, explicit fixtures. Each test builds exactly the office it needs, so a
 * failure points at the rule under test rather than at shared seed data.
 */

let counter = 0;
const uniq = () => {
  counter += 1;
  return counter;
};

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.aIAction.deleteMany();
  await prisma.seatAssignment.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.floorArea.deleteMany();
  await prisma.floor.deleteMany();
  await prisma.building.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.user.deleteMany();
}

export async function createAdmin(prisma: PrismaClient, overrides: { email?: string; passwordHash?: string } = {}) {
  const index = uniq();
  return prisma.user.create({
    data: {
      name: 'Test Admin ' + index,
      email: overrides.email ?? 'admin' + index + '@test.local',
      // bcrypt hash of "TestPassword!1" — precomputed to keep tests fast.
      passwordHash:
        overrides.passwordHash ?? '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewYyQBLbLXQGDPmm',
      role: 'ADMIN',
    },
  });
}

export async function createFloor(
  prisma: PrismaClient,
  options: { buildingName?: string; buildingCode?: string; floorName?: string; floorNumber?: number } = {},
) {
  const index = uniq();
  const building = await prisma.building.create({
    data: {
      name: options.buildingName ?? 'Building ' + index,
      code: options.buildingCode ?? 'B' + index,
      address: '1 Test Street',
    },
  });

  return prisma.floor.create({
    data: {
      buildingId: building.id,
      name: options.floorName ?? 'Floor ' + (options.floorNumber ?? 1),
      floorNumber: options.floorNumber ?? 1,
    },
    include: { building: true },
  });
}

export async function createSeat(
  prisma: PrismaClient,
  floorId: string,
  options: { seatCode?: string; zone?: string; status?: SeatStatus; x?: number; y?: number } = {},
) {
  const index = uniq();
  return prisma.seat.create({
    data: {
      floorId,
      seatCode: options.seatCode ?? 'S-' + String(index).padStart(2, '0'),
      zone: options.zone ?? 'A',
      status: options.status ?? 'AVAILABLE',
      xPosition: options.x ?? index * 2,
      yPosition: options.y ?? 0,
    },
  });
}

export async function createEmployee(
  prisma: PrismaClient,
  options: { name?: string; department?: string; status?: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE' } = {},
) {
  const index = uniq();
  return prisma.employee.create({
    data: {
      employeeCode: 'EMP-' + String(index).padStart(4, '0'),
      name: options.name ?? 'Employee ' + index,
      email: 'employee' + index + '@test.local',
      department: options.department ?? 'Engineering',
      jobTitle: 'Engineer',
      status: options.status ?? 'ACTIVE',
    },
  });
}
