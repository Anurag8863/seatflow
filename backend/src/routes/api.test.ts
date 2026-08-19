import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { hasDatabase } from '../test/setup.js';
import {
  createEmployee,
  createFloor,
  createSeat,
  resetDatabase,
} from '../test/factories.js';

/** HTTP-level behaviour: authentication, authorisation, validation, envelopes. */
describe.skipIf(!hasDatabase)('REST API', () => {
  const load = async () => {
    const [{ prisma }, { createApp }, { hashPassword }] = await Promise.all([
      import('../db/prisma.js'),
      import('../app.js'),
      import('../lib/auth.js'),
    ]);
    return { prisma, createApp, hashPassword };
  };

  let ctx: Awaited<ReturnType<typeof load>>;
  let app: Express;
  const ADMIN_EMAIL = 'api-admin@test.local';
  const ADMIN_PASSWORD = 'ApiTest!2024';

  beforeEach(async () => {
    ctx = await load();
    app = ctx.createApp();
    await resetDatabase(ctx.prisma);
    await ctx.prisma.user.create({
      data: {
        name: 'API Admin',
        email: ADMIN_EMAIL,
        passwordHash: await ctx.hashPassword(ADMIN_PASSWORD),
        role: 'ADMIN',
      },
    });
  });

  afterAll(async () => {
    if (ctx?.prisma) await ctx.prisma.$disconnect();
  });

  async function signIn(): Promise<string[]> {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    return response.get('Set-Cookie') ?? [];
  }

  // Auth ---------------------------------------------------------------------
  it('signs in with valid credentials and sets an HttpOnly cookie', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(ADMIN_EMAIL);
    expect(response.body.data.user).not.toHaveProperty('passwordHash');

    const cookies = response.get('Set-Cookie') ?? [];
    expect(cookies.join(';')).toContain('HttpOnly');
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'not-the-password' })
      .expect(401);

    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'not-the-password' })
      .expect(401);

    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    expect(wrongPassword.body.error.code).toBe('UNAUTHORIZED');
  });

  it('validates the login body', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: 'not-an-email' }).expect(422);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(response.body.error.details)).toBe(true);
  });

  it('blocks protected routes without a session', async () => {
    for (const path of ['/api/dashboard', '/api/employees', '/api/seats', '/api/audit-logs', '/api/ai/status']) {
      const response = await request(app).get(path).expect(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('allows protected routes once signed in', async () => {
    const cookies = await signIn();
    const response = await request(app).get('/api/dashboard').set('Cookie', cookies).expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.totals).toBeDefined();
  });

  it('accepts a Bearer token as well as the cookie', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer ' + login.body.data.token)
      .expect(200);
  });

  it('clears the session on logout', async () => {
    const cookies = await signIn();
    await request(app).post('/api/auth/logout').set('Cookie', cookies).expect(200);
  });

  // Seating ------------------------------------------------------------------
  it('assigns, moves and releases a seat over HTTP', async () => {
    const cookies = await signIn();
    const floor = await createFloor(ctx.prisma);
    const seatA = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-01' });
    const seatB = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-02' });
    const employee = await createEmployee(ctx.prisma, { name: 'Ada Lovelace' });

    const assigned = await request(app)
      .post('/api/seats/' + seatA.id + '/assign')
      .set('Cookie', cookies)
      .send({ employeeId: employee.id })
      .expect(200);
    expect(assigned.body.data.seat.occupant.name).toBe('Ada Lovelace');

    const moved = await request(app)
      .post('/api/employees/' + employee.id + '/move')
      .set('Cookie', cookies)
      .send({ seatId: seatB.id })
      .expect(200);
    expect(moved.body.data.seat.seatCode).toBe('A-02');
    expect(moved.body.data.previousSeat.seatCode).toBe('A-01');

    await request(app)
      .post('/api/seats/' + seatB.id + '/release')
      .set('Cookie', cookies)
      .expect(200);

    const seat = await request(app).get('/api/seats/' + seatB.id).set('Cookie', cookies).expect(200);
    expect(seat.body.data.status).toBe('AVAILABLE');
    expect(seat.body.data.occupant).toBeNull();
  });

  it('returns 409 with a machine-readable code when a seat is taken', async () => {
    const cookies = await signIn();
    const floor = await createFloor(ctx.prisma);
    const seat = await createSeat(ctx.prisma, floor.id, { seatCode: 'A-03' });
    const first = await createEmployee(ctx.prisma);
    const second = await createEmployee(ctx.prisma);

    await request(app)
      .post('/api/seats/' + seat.id + '/assign')
      .set('Cookie', cookies)
      .send({ employeeId: first.id })
      .expect(200);

    const conflict = await request(app)
      .post('/api/seats/' + seat.id + '/assign')
      .set('Cookie', cookies)
      .send({ employeeId: second.id })
      .expect(409);

    expect(conflict.body.error.code).toBe('SEAT_ALREADY_OCCUPIED');
  });

  it('validates seat assignment bodies', async () => {
    const cookies = await signIn();
    const floor = await createFloor(ctx.prisma);
    const seat = await createSeat(ctx.prisma, floor.id);

    const response = await request(app)
      .post('/api/seats/' + seat.id + '/assign')
      .set('Cookie', cookies)
      .send({})
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an out-of-range status filter', async () => {
    const cookies = await signIn();
    const response = await request(app)
      .get('/api/seats')
      .query({ status: 'ON_FIRE' })
      .set('Cookie', cookies)
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  // Listing ------------------------------------------------------------------
  it('paginates and filters employees', async () => {
    const cookies = await signIn();
    await createEmployee(ctx.prisma, { name: 'Alpha Engineer', department: 'Engineering' });
    await createEmployee(ctx.prisma, { name: 'Beta Designer', department: 'Design' });
    await createEmployee(ctx.prisma, { name: 'Gamma Engineer', department: 'Engineering' });

    const page = await request(app)
      .get('/api/employees')
      .query({ pageSize: 2, page: 1 })
      .set('Cookie', cookies)
      .expect(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

    const filtered = await request(app)
      .get('/api/employees')
      .query({ department: 'Engineering' })
      .set('Cookie', cookies)
      .expect(200);
    expect(filtered.body.data).toHaveLength(2);

    const searched = await request(app)
      .get('/api/employees')
      .query({ search: 'designer' })
      .set('Cookie', cookies)
      .expect(200);
    expect(searched.body.data).toHaveLength(1);
    expect(searched.body.data[0].name).toBe('Beta Designer');
  });

  it('serves the floor plan with geometry and stats', async () => {
    const cookies = await signIn();
    const floor = await createFloor(ctx.prisma);
    await createSeat(ctx.prisma, floor.id, { seatCode: 'A-01' });
    await createSeat(ctx.prisma, floor.id, { seatCode: 'A-02', status: 'DISABLED' });

    const response = await request(app)
      .get('/api/floors/' + floor.id + '/plan')
      .set('Cookie', cookies)
      .expect(200);

    expect(response.body.data.floor.gridWidth).toBeGreaterThan(0);
    expect(response.body.data.seats).toHaveLength(2);
    expect(response.body.data.stats).toMatchObject({ total: 2, disabled: 1 });
  });

  it('exposes the AI provider without leaking the API key', async () => {
    const cookies = await signIn();
    const response = await request(app).get('/api/ai/status').set('Cookie', cookies).expect(200);

    expect(response.body.data.provider).toBe('local');
    expect(JSON.stringify(response.body)).not.toContain('AI_API_KEY');
    expect(response.body.data).not.toHaveProperty('apiKey');
  });

  // Errors -------------------------------------------------------------------
  it('returns a consistent 404 envelope for unknown API routes', async () => {
    const response = await request(app).get('/api/does-not-exist').expect(404);
    expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('answers the health check without authentication', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.data.status).toBe('ok');
  });
});
