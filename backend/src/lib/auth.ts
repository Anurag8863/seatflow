import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env.js';
import { UnauthorizedError } from './errors.js';

const BCRYPT_ROUNDS = 12;

export const AUTH_COOKIE = 'seatflow_token';

export interface TokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: TokenPayload): string {
  const options = { expiresIn: env.JWT_EXPIRES_IN } as SignOptions;
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): TokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'string' || !decoded.sub) {
      throw new UnauthorizedError('Your session is invalid. Please sign in again.');
    }
    return {
      sub: String(decoded.sub),
      email: String((decoded as Record<string, unknown>).email ?? ''),
      role: (decoded as Record<string, unknown>).role as Role,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw new UnauthorizedError('Your session has expired. Please sign in again.');
  }
}

/**
 * Cookie options for the session token. HttpOnly keeps the JWT out of reach of
 * any script on the page, and SameSite=Lax blocks cross-site form posts while
 * still allowing normal top-level navigation.
 */
export function authCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  };
}
