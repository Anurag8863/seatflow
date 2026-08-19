import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..', '..');

loadEnv({ path: path.join(backendRoot, '.env') });
loadEnv({ path: path.resolve(backendRoot, '..', '.env') });

process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'local';
process.env.AI_API_KEY = '';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-only-secret-value-not-used-in-production';
process.env.CORS_ORIGIN = '';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
const strict = process.env.REQUIRE_DB_TESTS === '1';

/**
 * Integration specs need a throwaway PostgreSQL database, and they TRUNCATE
 * every table — so TEST_DATABASE_URL must never point at real data.
 *
 * When it is unset or unreachable those specs are skipped and the pure unit
 * suites still run, so `npm test` works on a machine with no database. CI
 * should set REQUIRE_DB_TESTS=1 to turn a skip into a failure.
 *
 * Migrations are applied once in globalSetup.ts; this is only a connectivity
 * check, so it stays cheap even though it runs per test file.
 */
async function probeDatabase(): Promise<boolean> {
  if (!TEST_DATABASE_URL) {
    if (strict) throw new Error('REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set.');
    console.warn(
      '\n  TEST_DATABASE_URL is not set - database integration tests will be SKIPPED.' +
        '\n  Set it in backend/.env to run the full suite.\n',
    );
    // config/env.ts still requires a value, even though nothing will connect.
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:1/unused';
    return false;
  }

  // Point every module that reads DATABASE_URL at the test database *before*
  // config/env.ts is imported by the code under test.
  process.env.DATABASE_URL = TEST_DATABASE_URL;

  const { PrismaClient } = await import('@prisma/client');
  const client = new PrismaClient({ log: ['error'] });
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    if (strict) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error('REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is unreachable.\n' + detail);
    }
    console.warn(
      '\n  Could not reach TEST_DATABASE_URL - database integration tests will be SKIPPED.' +
        '\n  Start PostgreSQL and re-run to exercise the full suite.\n',
    );
    return false;
  } finally {
    await client.$disconnect().catch(() => undefined);
  }
}

export const hasDatabase = await probeDatabase();
