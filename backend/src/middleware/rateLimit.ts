import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env.js';

const shared: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Rate limiting is a safety net, not a test concern.
  skip: () => env.isTest,
};

function jsonMessage(code: string, message: string) {
  return { success: false, error: { code, message } };
}

/** Keyed per authenticated user when available, otherwise per IP. */
function userOrIpKey(req: Request): string {
  return req.user?.id ?? req.ip ?? 'unknown';
}

/** Broad protection for the whole API surface. */
export const apiLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: 300,
  keyGenerator: userOrIpKey,
  message: jsonMessage('RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.'),
});

/** Tight limit on credential checking to blunt password guessing. */
export const loginLimiter = rateLimit({
  ...shared,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: jsonMessage('RATE_LIMITED', 'Too many sign-in attempts. Please wait a few minutes and try again.'),
});

/**
 * The AI endpoints are the expensive ones (they call an external provider), so
 * they get their own configurable per-admin budget.
 */
export const aiLimiter = rateLimit({
  ...shared,
  windowMs: 60 * 1000,
  limit: env.AI_RATE_LIMIT_PER_MINUTE,
  keyGenerator: userOrIpKey,
  message: jsonMessage(
    'AI_RATE_LIMITED',
    'You have reached the AI request limit for this minute. Please wait a moment before trying again.',
  ),
});
