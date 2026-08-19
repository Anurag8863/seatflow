import { env } from '../config/env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: Level = env.isTest ? 'error' : env.isProduction ? 'info' : 'debug';

/**
 * Keys whose values must never reach the logs. Redaction happens on the way in
 * so a careless `logger.info(req.body)` cannot leak a password or an API key.
 */
const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'token',
  'accesstoken',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'ai_api_key',
  'jwt_secret',
  'secret',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(val, depth + 1);
  }
  return out;
}

function write(level: Level, message: string, context?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(context === undefined ? {} : { context: redact(context) }),
  };
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  target(env.isProduction ? JSON.stringify(line) : `${line.ts} ${level.toUpperCase()} ${message}`);
  if (!env.isProduction && context !== undefined) {
    target(redact(context));
  }
}

export const logger = {
  debug: (message: string, context?: unknown) => write('debug', message, context),
  info: (message: string, context?: unknown) => write('info', message, context),
  warn: (message: string, context?: unknown) => write('warn', message, context),
  error: (message: string, context?: unknown) => write('error', message, context),
};
