import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/config -> backend -> repo root. Both locations are supported so a single
// root .env works for `npm run dev` and a backend/.env works for the workspace.
const backendRoot = path.resolve(here, '..', '..');
const repoRoot = path.resolve(backendRoot, '..');

loadEnv({ path: path.join(backendRoot, '.env') });
loadEnv({ path: path.join(repoRoot, '.env') });

const truthy = new Set(['1', 'true', 'yes', 'on']);

const EXAMPLE_SECRET = 'change-me-to-a-long-random-string-at-least-32-chars';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
    JWT_EXPIRES_IN: z.string().default('12h'),
    CORS_ORIGIN: z.string().optional().default(''),
    AI_PROVIDER: z.enum(['gemini', 'groq', 'local']).default('local'),
    AI_API_KEY: z.string().optional().default(''),
    AI_MODEL: z.string().optional().default(''),
    AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
    SEED_ADMIN_EMAIL: z.string().email().default('admin@seatflow.io'),
    SEED_ADMIN_PASSWORD: z.string().min(8).default('SeatFlow!2024'),
    SEED_ADMIN_NAME: z.string().default('Avery Collins'),
    SERVE_STATIC: z.string().optional().default(''),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production') {
      if (value.JWT_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET must be at least 32 characters in production',
        });
      }
      if (value.JWT_SECRET === EXAMPLE_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'JWT_SECRET is still the example value - generate a real secret',
        });
      }
    }
    if (value.AI_PROVIDER !== 'local' && !value.AI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_API_KEY'],
        message: 'AI_API_KEY is required unless AI_PROVIDER is "local"',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => '  - ' + (issue.path.join('.') || 'env') + ': ' + issue.message)
    .join('\n');
  console.error('\nInvalid environment configuration:\n' + issues + '\n');
  console.error('Copy .env.example to .env and fill in the missing values.\n');
  process.exit(1);
}

const raw = parsed.data;

const defaultModels: Record<string, string> = {
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.3-70b-versatile',
  local: 'seatflow-rule-interpreter',
};

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  corsOrigins: raw.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  aiModel: raw.AI_MODEL || defaultModels[raw.AI_PROVIDER] || 'unknown',
  /**
   * In production the API also serves the built frontend from a single Railway
   * service. Set SERVE_STATIC=false to run the API headless behind a separate
   * static host.
   */
  serveStatic:
    raw.SERVE_STATIC === ''
      ? raw.NODE_ENV === 'production'
      : truthy.has(raw.SERVE_STATIC.toLowerCase()),
} as const;

export type Env = typeof env;
