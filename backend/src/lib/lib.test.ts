import { describe, expect, it, vi } from 'vitest';
import { paginationMeta } from './http.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from './errors.js';
import { logger } from './logger.js';
import { optionalEnum, optionalString, paginationSchema } from '../routes/schemas.js';

/** Pure unit coverage — no database or network required. */

describe('paginationMeta', () => {
  it('computes page counts', () => {
    expect(paginationMeta(0, 1, 20)).toMatchObject({ total: 0, totalPages: 1 });
    expect(paginationMeta(20, 1, 20)).toMatchObject({ totalPages: 1 });
    expect(paginationMeta(21, 2, 20)).toMatchObject({ page: 2, totalPages: 2 });
    expect(paginationMeta(100, 3, 10)).toMatchObject({ totalPages: 10 });
  });
});

describe('error types', () => {
  it('carry the right status, code and exposure', () => {
    expect(new NotFoundError()).toMatchObject({ statusCode: 404, code: 'NOT_FOUND', expose: true });
    expect(new ValidationError()).toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
    expect(new ConflictError('taken', 'SEAT_ALREADY_OCCUPIED')).toMatchObject({
      statusCode: 409,
      code: 'SEAT_ALREADY_OCCUPIED',
    });
  });

  it('marks 5xx errors as not safe to expose', () => {
    const internal = new AppError(500, 'INTERNAL_ERROR', 'boom');
    expect(internal.expose).toBe(false);
  });
});

describe('query schemas', () => {
  it('applies pagination defaults and coerces strings', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationSchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
  });

  it('rejects out-of-range pagination', () => {
    expect(() => paginationSchema.parse({ page: '0' })).toThrow();
    expect(() => paginationSchema.parse({ pageSize: '1000' })).toThrow();
  });

  it('treats an empty query string as absent', () => {
    expect(optionalString.parse('')).toBeUndefined();
    expect(optionalString.parse('  hello  ')).toBe('hello');
  });

  it('constrains enum-style filters to known values', () => {
    const status = optionalEnum(['AVAILABLE', 'OCCUPIED']);
    expect(status.parse('AVAILABLE')).toBe('AVAILABLE');
    expect(status.parse('')).toBeUndefined();
    expect(() => status.parse('DROP TABLE')).toThrow();
  });
});

describe('logger redaction', () => {
  it('never writes secrets into log context', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    logger.error('login attempt', {
      email: 'admin@seatflow.io',
      password: 'SuperSecret!1',
      token: 'jwt.token.value',
      nested: { apiKey: 'sk-live-123', safe: 'keep-me' },
    });

    const output = spy.mock.calls.flat().map((entry) => JSON.stringify(entry)).join(' ');
    spy.mockRestore();

    expect(output).not.toContain('SuperSecret!1');
    expect(output).not.toContain('jwt.token.value');
    expect(output).not.toContain('sk-live-123');
    expect(output).toContain('[redacted]');
    expect(output).toContain('keep-me');
  });
});
