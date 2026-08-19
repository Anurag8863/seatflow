import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hasDatabase } from '../test/setup.js';
import { AppError } from '../lib/errors.js';
import {
  createAdmin,
  createEmployee,
  createFloor,
  createSeat,
  resetDatabase,
} from '../test/factories.js';

/**
 * The seating invariants, exercised against a real PostgreSQL database so the
 * partial unique indexes are part of what is being tested — not just the
 * application-level guards.
 */
describe.skipIf(!hasDatabase)('seating service', () => {
  // Imported lazily so the module (and its PrismaClient) is only constructed
  // when a database is actually configured.
  const load = async () => {
    const [{ prisma }, service] = await Promise.all([
      import('../db/prisma.js'),
      import('./seating.service.js'),
    ]);
    return { prisma, ...service };
  };

  let ctx: Awaited<ReturnType<typeof load>>;
  let adminId: string;

  beforeEach(async () => {
    ctx = await load();
    await resetDatabase(ctx.prisma);
    const admin = await createAdmin(ctx.prisma);
    adminId = admin.id;
  });

  afterAll(async () => {
    if (ctx?.prisma) await ctx.prisma.$disconnect();
  });

  const manual = () => ({ actorId: adminId, source: 'MANUAL' as const });

  // 1 ------------------------------------------------------------------------
  it('assigns an employee to an available seat', async () => {
    const floor = await createFloor(ctx.prisma);
    const seat = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-01' });
    const employee = await createEmployee(ctx.prisma, { name: 'Ada Lovelace' });

    const result = await ctx.assignSeat({ employeeId: employee.id, seatId: seat.id }, manual());

    expect(result.seat?.seatCode).toBe('A-01');
    expect(result.seat?.status).toBe('OCCUPIED');
    expect(result.seat?.occupant?.name).toBe('Ada Lovelace');
    expect(result.employee?.seat?.seatCode).toBe('A-01');

    const assignments = await ctx.prisma.seatAssignment.findMany({ where: { employeeId: employee.id } });
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.active).toBe(true);
    expect(assignments[0]?.releasedAt).toBeNull();
  });

  // 2 ------------------------------------------------------------------------
  it('refuses to assign a seat that is already occupied', async () => {
    const floor = await createFloor(ctx.prisma);
    const seat = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-02' });
    const first = await createEmployee(ctx.prisma, { name: 'Grace Hopper' });
    const second = await createEmployee(ctx.prisma, { name: 'Alan Turing' });

    await ctx.assignSeat({ employeeId: first.id, seatId: seat.id }, manual());

    await expect(ctx.assignSeat({ employeeId: second.id, seatId: seat.id }, manual())).rejects.toMatchObject({
      code: 'SEAT_ALREADY_OCCUPIED',
      statusCode: 409,
    });

    // The rejected attempt must not have created a second live assignment.
    const live = await ctx.prisma.seatAssignment.count({ where: { seatId: seat.id, active: true } });
    expect(live).toBe(1);
  });

  // 3 ------------------------------------------------------------------------
  it('moves an employee from one seat to another atomically', async () => {
    const floor = await createFloor(ctx.prisma);
    const from = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-03' });
    const to = await createSeat(ctx.prisma, floor.id, { seatCode: 'B-03' });
    const employee = await createEmployee(ctx.prisma, { name: 'Katherine Johnson' });

    await ctx.assignSeat({ employeeId: employee.id, seatId: from.id }, manual());
    const result = await ctx.moveEmployee({ employeeId: employee.id, toSeatId: to.id }, manual());

    expect(result.previousSeat?.seatCode).toBe('A-03');
    expect(result.seat?.seatCode).toBe('B-03');

    const [oldSeat, newSeat] = await Promise.all([
      ctx.prisma.seat.findUniqueOrThrow({ where: { id: from.id } }),
      ctx.prisma.seat.findUniqueOrThrow({ where: { id: to.id } }),
    ]);
    expect(oldSeat.status).toBe('AVAILABLE');
    expect(newSeat.status).toBe('OCCUPIED');

    const live = await ctx.prisma.seatAssignment.findMany({ where: { employeeId: employee.id, active: true } });
    expect(live).toHaveLength(1);
    expect(live[0]?.seatId).toBe(to.id);

    const released = await ctx.prisma.seatAssignment.findFirst({ where: { seatId: from.id, active: null } });
    expect(released?.releasedAt).toBeInstanceOf(Date);
  });

  // 4 ------------------------------------------------------------------------
  it('never lets one employee hold two seats', async () => {
    const floor = await createFloor(ctx.prisma);
    const first = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-04' });
    const second = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-05' });
    const employee = await createEmployee(ctx.prisma, { name: 'Margaret Hamilton' });

    await ctx.assignSeat({ employeeId: employee.id, seatId: first.id }, manual());

    await expect(ctx.assignSeat({ employeeId: employee.id, seatId: second.id }, manual())).rejects.toMatchObject({
      code: 'EMPLOYEE_ALREADY_SEATED',
    });

    // The database itself must reject a duplicate live row, independent of the
    // service-level guard above.
    await expect(
      ctx.prisma.seatAssignment.create({
        data: { employeeId: employee.id, seatId: second.id, active: true },
      }),
    ).rejects.toThrow();

    const live = await ctx.prisma.seatAssignment.count({ where: { employeeId: employee.id, active: true } });
    expect(live).toBe(1);
  });

  // 5 ------------------------------------------------------------------------
  it('releases a seat and makes it available again', async () => {
    const floor = await createFloor(ctx.prisma);
    const seat = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-06' });
    const employee = await createEmployee(ctx.prisma, { name: 'Radia Perlman' });

    await ctx.assignSeat({ employeeId: employee.id, seatId: seat.id }, manual());
    const result = await ctx.releaseSeat({ seatId: seat.id }, manual());

    expect(result.seat?.status).toBe('AVAILABLE');
    expect(result.seat?.occupant).toBeNull();
    expect(result.employee?.seat).toBeNull();

    const released = await ctx.prisma.seatAssignment.findFirstOrThrow({ where: { seatId: seat.id } });
    expect(released.active).toBeNull();
    expect(released.releasedAt).toBeInstanceOf(Date);
  });

  it('reports a helpful error when releasing a seat nobody occupies', async () => {
    const floor = await createFloor(ctx.prisma);
    const seat = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-07' });

    await expect(ctx.releaseSeat({ seatId: seat.id }, manual())).rejects.toMatchObject({
      code: 'SEAT_NOT_OCCUPIED',
    });
  });

  // 6 ------------------------------------------------------------------------
  it('refuses to assign a disabled seat', async () => {
    const floor = await createFloor(ctx.prisma);
    const seat = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-08', status: 'DISABLED' });
    const employee = await createEmployee(ctx.prisma);

    await expect(ctx.assignSeat({ employeeId: employee.id, seatId: seat.id }, manual())).rejects.toMatchObject({
      code: 'SEAT_DISABLED',
    });
    await expect(ctx.moveEmployee({ employeeId: employee.id, toSeatId: seat.id }, manual())).rejects.toMatchObject({
      code: 'SEAT_DISABLED',
    });
  });

  it('keeps a released seat disabled rather than silently re-enabling it', async () => {
    const floor = await createFloor(ctx.prisma);
    const seat = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-09' });
    const employee = await createEmployee(ctx.prisma);

    await ctx.assignSeat({ employeeId: employee.id, seatId: seat.id }, manual());
    await ctx.prisma.seat.update({ where: { id: seat.id }, data: { status: 'DISABLED' } });
    await ctx.releaseSeat({ seatId: seat.id }, manual());

    const after = await ctx.prisma.seat.findUniqueOrThrow({ where: { id: seat.id } });
    expect(after.status).toBe('DISABLED');
  });

  it('will not disable a seat somebody is sitting at', async () => {
    const floor = await createFloor(ctx.prisma);
    const seat = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-10' });
    const employee = await createEmployee(ctx.prisma);
    await ctx.assignSeat({ employeeId: employee.id, seatId: seat.id }, manual());

    await expect(
      ctx.setSeatStatus({ seatId: seat.id, status: 'DISABLED' }, manual()),
    ).rejects.toMatchObject({ code: 'SEAT_OCCUPIED' });
  });

  it('refuses to seat an inactive employee', async () => {
    const floor = await createFloor(ctx.prisma);
    const seat = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-11' });
    const employee = await createEmployee(ctx.prisma, { status: 'INACTIVE' });

    await expect(ctx.assignSeat({ employeeId: employee.id, seatId: seat.id }, manual())).rejects.toMatchObject({
      code: 'EMPLOYEE_INACTIVE',
    });
  });

  // Audit --------------------------------------------------------------------
  it('writes an audit record for every mutation', async () => {
    const floor = await createFloor(ctx.prisma);
    const from = await createSeat(ctx.prisma, floor.id, { seatCode: 'C-01' });
    const to = await createSeat(ctx.prisma, floor.id, { seatCode: 'C-02' });
    const employee = await createEmployee(ctx.prisma, { name: 'Barbara Liskov' });

    await ctx.assignSeat({ employeeId: employee.id, seatId: from.id }, manual());
    await ctx.moveEmployee({ employeeId: employee.id, toSeatId: to.id }, manual());
    await ctx.releaseSeat({ seatId: to.id }, manual());

    const logs = await ctx.prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    expect(logs.map((log) => log.action)).toEqual([
      'EMPLOYEE_ASSIGNED',
      'EMPLOYEE_MOVED',
      'SEAT_RELEASED',
    ]);
    expect(logs.every((log) => log.userId === adminId)).toBe(true);
    expect(logs.every((log) => log.source === 'MANUAL')).toBe(true);

    const moveLog = logs[1];
    expect(moveLog?.previousSeatId).toBe(from.id);
    expect(moveLog?.newSeatId).toBe(to.id);
    expect(moveLog?.summary).toContain('Barbara Liskov');
  });

  it('rejects an unknown seat with a 404-shaped error', async () => {
    const employee = await createEmployee(ctx.prisma);
    const error = await ctx
      .assignSeat({ employeeId: employee.id, seatId: 'does-not-exist' }, manual())
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(404);
  });
});
