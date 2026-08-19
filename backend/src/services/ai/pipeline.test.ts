import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hasDatabase } from '../../test/setup.js';
import {
  createAdmin,
  createEmployee,
  createFloor,
  createSeat,
  resetDatabase,
} from '../../test/factories.js';

/**
 * The full AI pipeline against a real database:
 *   prompt -> intent -> validated plan -> PENDING -> explicit confirm -> execute
 *
 * The load-bearing assertion in several of these is what does *not* happen:
 * interpreting a request must never change seating data on its own.
 */
describe.skipIf(!hasDatabase)('AI pipeline', () => {
  const load = async () => {
    const [{ prisma }, ai, seating] = await Promise.all([
      import('../../db/prisma.js'),
      import('./index.js'),
      import('../seating.service.js'),
    ]);
    return { prisma, ...ai, ...seating };
  };

  let ctx: Awaited<ReturnType<typeof load>>;
  let adminId: string;
  let floorId: string;

  beforeEach(async () => {
    ctx = await load();
    await resetDatabase(ctx.prisma);
    const admin = await createAdmin(ctx.prisma);
    adminId = admin.id;
    const floor = await createFloor(ctx.prisma, { floorName: 'Floor 1', floorNumber: 1 });
    floorId = floor.id;
  });

  afterAll(async () => {
    if (ctx?.prisma) await ctx.prisma.$disconnect();
  });

  // 7 ------------------------------------------------------------------------
  it('interprets a move but does not apply it without confirmation', async () => {
    const from = await createSeat(ctx.prisma, floorId, { seatCode: 'A-12', zone: 'A' });
    const to = await createSeat(ctx.prisma, floorId, { seatCode: 'B-07', zone: 'B' });
    const employee = await createEmployee(ctx.prisma, { name: 'Rahul Sharma' });
    await ctx.assignSeat({ employeeId: employee.id, seatId: from.id }, { actorId: adminId, source: 'MANUAL' });

    const plan = await ctx.interpretPrompt({ prompt: 'Move Rahul Sharma to B-07', userId: adminId });

    expect(plan.kind).toBe('mutation');
    expect(plan.action).toBe('MOVE_EMPLOYEE');
    expect(plan.preview?.title).toContain('Rahul Sharma');
    expect(plan.preview?.fields.find((field) => field.label === 'New seat')?.value).toBe('B-07');

    // Nothing moved yet.
    const stillAtOldSeat = await ctx.prisma.seatAssignment.findFirst({
      where: { employeeId: employee.id, active: true },
    });
    expect(stillAtOldSeat?.seatId).toBe(from.id);
    expect(await ctx.prisma.seat.findUniqueOrThrow({ where: { id: to.id } })).toMatchObject({
      status: 'AVAILABLE',
    });

    const record = await ctx.prisma.aIAction.findUniqueOrThrow({ where: { id: plan.aiActionId } });
    expect(record.status).toBe('PENDING');
  });

  // 8 ------------------------------------------------------------------------
  it('applies the move on confirmation and records an AI-sourced audit entry', async () => {
    const from = await createSeat(ctx.prisma, floorId, { seatCode: 'A-12', zone: 'A' });
    const to = await createSeat(ctx.prisma, floorId, { seatCode: 'B-07', zone: 'B' });
    const employee = await createEmployee(ctx.prisma, { name: 'Rahul Sharma' });
    await ctx.assignSeat({ employeeId: employee.id, seatId: from.id }, { actorId: adminId, source: 'MANUAL' });

    const plan = await ctx.interpretPrompt({ prompt: 'Move Rahul Sharma to B-07', userId: adminId });
    const result = await ctx.executeAiAction(plan.aiActionId, adminId);

    expect(result.status).toBe('EXECUTED');
    expect(result.affected).toHaveLength(1);
    expect(result.affected[0]?.seat?.seatCode).toBe('B-07');
    expect(result.affected[0]?.previousSeat?.seatCode).toBe('A-12');

    const live = await ctx.prisma.seatAssignment.findFirstOrThrow({
      where: { employeeId: employee.id, active: true },
    });
    expect(live.seatId).toBe(to.id);

    const auditLog = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { source: 'AI' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditLog.action).toBe('EMPLOYEE_MOVED');
    expect(auditLog.userId).toBe(adminId);
    expect(auditLog.previousSeatId).toBe(from.id);
    expect(auditLog.newSeatId).toBe(to.id);
    expect(auditLog.metadata).toMatchObject({ aiActionId: plan.aiActionId });

    const record = await ctx.prisma.aIAction.findUniqueOrThrow({ where: { id: plan.aiActionId } });
    expect(record.status).toBe('EXECUTED');
    expect(record.executedAt).toBeInstanceOf(Date);
  });

  it('refuses to execute the same AI action twice', async () => {
    await createSeat(ctx.prisma, floorId, { seatCode: 'A-01', zone: 'A' });
    const employee = await createEmployee(ctx.prisma, { name: 'Ada Lovelace' });

    const plan = await ctx.interpretPrompt({ prompt: 'Assign Ada Lovelace to A-01', userId: adminId });
    await ctx.executeAiAction(plan.aiActionId, adminId);

    await expect(ctx.executeAiAction(plan.aiActionId, adminId)).rejects.toMatchObject({
      code: 'AI_ACTION_NOT_PENDING',
    });
    expect(await ctx.prisma.seatAssignment.count({ where: { employeeId: employee.id } })).toBe(1);
  });

  it('lets an administrator cancel a pending action without changing anything', async () => {
    await createSeat(ctx.prisma, floorId, { seatCode: 'A-01', zone: 'A' });
    await createEmployee(ctx.prisma, { name: 'Ada Lovelace' });

    const plan = await ctx.interpretPrompt({ prompt: 'Assign Ada Lovelace to A-01', userId: adminId });
    const cancelled = await ctx.cancelAiAction(plan.aiActionId, adminId);

    expect(cancelled.status).toBe('CANCELLED');
    expect(await ctx.prisma.seatAssignment.count()).toBe(0);
    await expect(ctx.executeAiAction(plan.aiActionId, adminId)).rejects.toMatchObject({
      code: 'AI_ACTION_NOT_PENDING',
    });
  });

  it('re-validates against live data, so a seat taken after preview is rejected', async () => {
    const target = await createSeat(ctx.prisma, floorId, { seatCode: 'B-07', zone: 'B' });
    const mover = await createEmployee(ctx.prisma, { name: 'Rahul Sharma' });
    const squatter = await createEmployee(ctx.prisma, { name: 'Grace Hopper' });

    const plan = await ctx.interpretPrompt({ prompt: 'Move Rahul Sharma to B-07', userId: adminId });
    expect(plan.kind).toBe('mutation');

    // Somebody else takes the seat between preview and confirmation.
    await ctx.assignSeat({ employeeId: squatter.id, seatId: target.id }, { actorId: adminId, source: 'MANUAL' });

    await expect(ctx.executeAiAction(plan.aiActionId, adminId)).rejects.toMatchObject({
      code: 'SEAT_ALREADY_OCCUPIED',
    });

    const record = await ctx.prisma.aIAction.findUniqueOrThrow({ where: { id: plan.aiActionId } });
    expect(record.status).toBe('FAILED');
    expect(await ctx.prisma.seatAssignment.count({ where: { employeeId: mover.id, active: true } })).toBe(0);
  });

  it('rejects an unknown employee without creating anything executable', async () => {
    await createSeat(ctx.prisma, floorId, { seatCode: 'A-01', zone: 'A' });

    const plan = await ctx.interpretPrompt({ prompt: 'Move Nobody Here to A-01', userId: adminId });

    expect(plan.kind).toBe('rejected');
    expect(plan.message).toContain('could not find an employee');
    await expect(ctx.executeAiAction(plan.aiActionId, adminId)).rejects.toMatchObject({
      code: 'AI_ACTION_NOT_PENDING',
    });
  });

  it('reports the occupant when the destination seat is taken', async () => {
    const seat = await createSeat(ctx.prisma, floorId, { seatCode: 'B-07', zone: 'B' });
    const occupant = await createEmployee(ctx.prisma, { name: 'Priya Singh' });
    await createEmployee(ctx.prisma, { name: 'Rahul Sharma' });
    await ctx.assignSeat({ employeeId: occupant.id, seatId: seat.id }, { actorId: adminId, source: 'MANUAL' });

    const plan = await ctx.interpretPrompt({ prompt: 'Move Rahul Sharma to B-07', userId: adminId });

    expect(plan.kind).toBe('rejected');
    expect(plan.message).toContain('Priya Singh');
  });

  it('refuses a disabled destination seat', async () => {
    await createSeat(ctx.prisma, floorId, { seatCode: 'B-08', zone: 'B', status: 'DISABLED' });
    await createEmployee(ctx.prisma, { name: 'Rahul Sharma' });

    const plan = await ctx.interpretPrompt({ prompt: 'Move Rahul Sharma to B-08', userId: adminId });

    expect(plan.kind).toBe('rejected');
    expect(plan.message).toContain('disabled');
  });

  it('asks which person is meant when a name is ambiguous', async () => {
    await createSeat(ctx.prisma, floorId, { seatCode: 'A-01', zone: 'A' });
    await createEmployee(ctx.prisma, { name: 'Arjun Mehta', department: 'Engineering' });
    await createEmployee(ctx.prisma, { name: 'Arjun Mehta', department: 'Operations' });

    const plan = await ctx.interpretPrompt({ prompt: 'Move Arjun Mehta to A-01', userId: adminId });

    expect(plan.kind).toBe('clarification');
    expect(plan.options).toHaveLength(2);
    expect(plan.message).toContain('2 people');
  });

  it('resolves the ambiguity once a specific employee is chosen', async () => {
    const seat = await createSeat(ctx.prisma, floorId, { seatCode: 'A-01', zone: 'A' });
    const first = await createEmployee(ctx.prisma, { name: 'Arjun Mehta', department: 'Engineering' });
    await createEmployee(ctx.prisma, { name: 'Arjun Mehta', department: 'Operations' });

    const plan = await ctx.interpretPrompt({
      prompt: 'Move Arjun Mehta to A-01',
      userId: adminId,
      selectedEmployeeId: first.id,
    });

    expect(plan.kind).toBe('mutation');
    const result = await ctx.executeAiAction(plan.aiActionId, adminId);
    expect(result.affected[0]?.employee?.id).toBe(first.id);
    expect(result.affected[0]?.seat?.id).toBe(seat.id);
  });

  it('uses the stated current seat to disambiguate a shared first name', async () => {
    const seatA = await createSeat(ctx.prisma, floorId, { seatCode: 'A-12', zone: 'A' });
    await createSeat(ctx.prisma, floorId, { seatCode: 'B-07', zone: 'B' });
    const priyaSingh = await createEmployee(ctx.prisma, { name: 'Priya Singh' });
    await createEmployee(ctx.prisma, { name: 'Priya Nair' });
    await ctx.assignSeat({ employeeId: priyaSingh.id, seatId: seatA.id }, { actorId: adminId, source: 'MANUAL' });

    const plan = await ctx.interpretPrompt({ prompt: 'Move Priya from A-12 to B-07', userId: adminId });

    expect(plan.kind).toBe('mutation');
    expect(plan.preview?.title).toContain('Priya Singh');
  });

  it('answers occupancy questions without creating a pending action', async () => {
    const seat = await createSeat(ctx.prisma, floorId, { seatCode: 'A-01', zone: 'A' });
    await createSeat(ctx.prisma, floorId, { seatCode: 'A-02', zone: 'A' });
    const employee = await createEmployee(ctx.prisma);
    await ctx.assignSeat({ employeeId: employee.id, seatId: seat.id }, { actorId: adminId, source: 'MANUAL' });

    const plan = await ctx.interpretPrompt({ prompt: 'How many seats are occupied on Floor 1?', userId: adminId });

    expect(plan.kind).toBe('answer');
    expect(plan.answer?.text).toContain('1 of 2');

    const record = await ctx.prisma.aIAction.findUniqueOrThrow({ where: { id: plan.aiActionId } });
    expect(record.status).toBe('ANSWERED');
  });

  it('lists available seats for a floor', async () => {
    await createSeat(ctx.prisma, floorId, { seatCode: 'A-01', zone: 'A' });
    await createSeat(ctx.prisma, floorId, { seatCode: 'A-02', zone: 'A' });

    const plan = await ctx.interpretPrompt({ prompt: 'Which seats are available on Floor 1?', userId: adminId });

    expect(plan.kind).toBe('answer');
    expect(plan.answer?.seats?.map((seat) => seat.seatCode).sort()).toEqual(['A-01', 'A-02']);
  });

  it('says so plainly when a floor has no free desks', async () => {
    const seat = await createSeat(ctx.prisma, floorId, { seatCode: 'A-01', zone: 'A' });
    const employee = await createEmployee(ctx.prisma);
    await ctx.assignSeat({ employeeId: employee.id, seatId: seat.id }, { actorId: adminId, source: 'MANUAL' });

    const plan = await ctx.interpretPrompt({ prompt: 'Which seats are available on Floor 1?', userId: adminId });

    expect(plan.answer?.text).toContain('no available seats');
  });

  it('asks which building when the same floor name exists in several', async () => {
    // Two buildings both have a "Floor 2" - a real ambiguity, not a failure.
    const hqTwo = await createFloor(ctx.prisma, { floorName: 'Floor 2', floorNumber: 2 });
    await createSeat(ctx.prisma, hqTwo.id, { seatCode: 'D-01', zone: 'D' });
    const annexTwo = await createFloor(ctx.prisma, { floorName: 'Floor 2', floorNumber: 2 });
    await createSeat(ctx.prisma, annexTwo.id, { seatCode: 'L-01', zone: 'L' });

    const plan = await ctx.interpretPrompt({ prompt: 'Which seats are available on Floor 2?', userId: adminId });

    expect(plan.kind).toBe('clarification');
    expect(plan.optionKind).toBe('floor');
    expect(plan.options).toHaveLength(2);
  });

  it('uses the building open in the UI to resolve a bare floor name', async () => {
    const hqTwo = await createFloor(ctx.prisma, { floorName: 'Floor 2', floorNumber: 2 });
    await createSeat(ctx.prisma, hqTwo.id, { seatCode: 'D-01', zone: 'D' });
    const annexTwo = await createFloor(ctx.prisma, { floorName: 'Floor 2', floorNumber: 2 });
    await createSeat(ctx.prisma, annexTwo.id, { seatCode: 'L-01', zone: 'L' });

    const plan = await ctx.interpretPrompt({
      prompt: 'Which seats are available on Floor 2?',
      userId: adminId,
      scopeBuildingId: annexTwo.buildingId,
    });

    expect(plan.kind).toBe('answer');
    expect(plan.answer?.seats?.map((seat) => seat.seatCode)).toEqual(['L-01']);
  });

  it('labels employee ambiguity options as people', async () => {
    await createSeat(ctx.prisma, floorId, { seatCode: 'A-01', zone: 'A' });
    await createEmployee(ctx.prisma, { name: 'Arjun Mehta', department: 'Engineering' });
    await createEmployee(ctx.prisma, { name: 'Arjun Mehta', department: 'Operations' });

    const plan = await ctx.interpretPrompt({ prompt: 'Move Arjun Mehta to A-01', userId: adminId });
    expect(plan.optionKind).toBe('employee');
  });

  it('declines requests outside the seating domain', async () => {
    const plan = await ctx.interpretPrompt({ prompt: 'Delete every employee record', userId: adminId });

    expect(plan.kind).toBe('rejected');
    expect(plan.action).toBe('UNSUPPORTED');
    expect(await ctx.prisma.employee.count()).toBe(0);
  });

  it('only lets the requesting administrator confirm their own action', async () => {
    await createSeat(ctx.prisma, floorId, { seatCode: 'A-01', zone: 'A' });
    await createEmployee(ctx.prisma, { name: 'Ada Lovelace' });
    const other = await createAdmin(ctx.prisma);

    const plan = await ctx.interpretPrompt({ prompt: 'Assign Ada Lovelace to A-01', userId: adminId });

    await expect(ctx.executeAiAction(plan.aiActionId, other.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('previews a bulk move and applies every row on confirmation', async () => {
    const floorTwo = await createFloor(ctx.prisma, { floorName: 'Floor 2', floorNumber: 2 });
    await createSeat(ctx.prisma, floorTwo.id, { seatCode: 'D-01', zone: 'D' });
    await createSeat(ctx.prisma, floorTwo.id, { seatCode: 'D-02', zone: 'D' });
    await createEmployee(ctx.prisma, { name: 'Marketer One', department: 'Marketing' });
    await createEmployee(ctx.prisma, { name: 'Marketer Two', department: 'Marketing' });

    const plan = await ctx.interpretPrompt({
      prompt: 'Move all available Marketing employees to Floor 2',
      userId: adminId,
    });

    expect(plan.kind).toBe('mutation');
    expect(plan.preview?.rows).toHaveLength(2);
    expect(await ctx.prisma.seatAssignment.count({ where: { active: true } })).toBe(0);

    const result = await ctx.executeAiAction(plan.aiActionId, adminId);
    expect(result.affected).toHaveLength(2);
    expect(await ctx.prisma.seatAssignment.count({ where: { active: true } })).toBe(2);

    // Bulk actions also leave a single summary row in the audit log.
    const summary = await ctx.prisma.auditLog.findFirst({ where: { action: 'AI_ACTION_EXECUTED' } });
    expect(summary?.source).toBe('AI');
  });
});
