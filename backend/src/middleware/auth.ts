import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Role } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { AUTH_COOKIE, verifyToken } from '../lib/auth.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';

function extractToken(req: Request): string | null {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE];
  if (cookieToken) return cookieToken;

  // Bearer tokens are also accepted so the API stays usable from curl / Postman
  // and from a frontend hosted on a different origin.
  const header = req.header('authorization');
  if (header && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim() || null;
  }
  return null;
}

/**
 * Verifies the session JWT and loads the current user. The user is re-read from
 * the database on every request so a deleted or demoted account loses access
 * immediately rather than when its token expires.
 */
export const requireAuth: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) {
    next(new UnauthorizedError('You must be signed in to do that.'));
    return;
  }

  void (async () => {
    try {
      const payload = verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, name: true, email: true, role: true },
      });
      if (!user) {
        next(new UnauthorizedError('Your account is no longer active.'));
        return;
      }
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  })();
};

/** Restricts a route to the given roles. Must run after `requireAuth`. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      next(new UnauthorizedError());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ForbiddenError('This action requires one of: ' + roles.join(', ') + '.'));
      return;
    }
    next();
  };
}

/** Any role that is allowed to mutate seating data. */
export const requireWriteAccess = requireRole('ADMIN', 'MANAGER');
