import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { AUTH_COOKIE, authCookieOptions, signToken, verifyPassword } from '../lib/auth.js';
import { UnauthorizedError } from '../lib/errors.js';
import { asyncHandler, sendOk } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

authRouter.post(
  '/login',
  loginLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // The same message and roughly the same work for both failure modes, so the
    // response does not reveal whether an account exists.
    const passwordOk = user
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');

    if (!user || !passwordOk) {
      throw new UnauthorizedError('That email and password combination is not recognised.');
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const token = signToken({ sub: user.id, email: user.email, role: user.role });
    res.cookie(AUTH_COOKIE, token, authCookieOptions());

    return sendOk(res, {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      // Also returned so non-browser clients can use a Bearer header.
      token,
    });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    res.clearCookie(AUTH_COOKIE, { ...authCookieOptions(), maxAge: undefined });
    return sendOk(res, { loggedOut: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { id: true, name: true, email: true, role: true, lastLoginAt: true, createdAt: true },
    });
    return sendOk(res, {
      ...user,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      createdAt: user.createdAt.toISOString(),
    });
  }),
);
