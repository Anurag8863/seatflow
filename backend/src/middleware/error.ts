import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError, NotFoundError } from '../lib/errors.js';
import type { ApiFailure } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError('No API route matches ' + req.method + ' ' + req.originalUrl + '.'));
};

/** Maps a Prisma error to a user-facing AppError, or null if it is unexpected. */
function translatePrismaError(error: unknown): AppError | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const target = (error.meta?.target as string[] | string | undefined) ?? [];
        const fields = Array.isArray(target) ? target.join(', ') : String(target);
        // The partial uniques on SeatAssignment are the seating invariants.
        if (fields.includes('seatId')) {
          return new AppError(409, 'SEAT_ALREADY_OCCUPIED', 'That seat was just taken by someone else. Refresh and try again.');
        }
        if (fields.includes('employeeId')) {
          return new AppError(409, 'EMPLOYEE_ALREADY_SEATED', 'That employee already holds a seat. Move them instead of assigning a second seat.');
        }
        return new AppError(409, 'DUPLICATE_VALUE', 'A record with that ' + (fields || 'value') + ' already exists.');
      }
      case 'P2003':
        return new AppError(409, 'RELATED_RECORD_MISSING', 'A referenced record does not exist.');
      case 'P2025':
        return new AppError(404, 'NOT_FOUND', 'The requested record no longer exists.');
      default:
        return null;
    }
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable. Please try again shortly.');
  }
  return null;
}

/**
 * Central error handler. Everything a client sees is deliberate: unexpected
 * errors are logged in full server-side but reported as a generic message so
 * stack traces, SQL and secrets never reach the browser.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = new AppError(422, 'VALIDATION_ERROR', 'Some fields need attention.', {
      details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
  } else {
    appError = translatePrismaError(err) ?? new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our end.');
  }

  if (appError.statusCode >= 500) {
    logger.error('Unhandled request failure', {
      method: req.method,
      path: req.originalUrl,
      code: appError.code,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  } else {
    logger.debug('Request rejected', {
      method: req.method,
      path: req.originalUrl,
      code: appError.code,
      status: appError.statusCode,
    });
  }

  const body: ApiFailure = {
    success: false,
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : 'Something went wrong on our end.',
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
  };

  if (!env.isProduction && appError.statusCode >= 500 && err instanceof Error) {
    (body.error as Record<string, unknown>).devMessage = err.message;
  }

  res.status(appError.statusCode).json(body);
};
