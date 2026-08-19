import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..', '..');

loadEnv({ path: path.join(backendRoot, '.env') });
loadEnv({ path: path.resolve(backendRoot, '..', '.env') });

/**
 * Runs once for the whole suite (not once per file): brings the test database
 * up to the current schema. Each test file then only needs a cheap connection
 * check, which keeps the suite fast.
 */
export default function globalSetup(): void {
  const url = process.env.TEST_DATABASE_URL ?? '';
  const strict = process.env.REQUIRE_DB_TESTS === '1';

  if (!url) {
    if (strict) throw new Error('REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set.');
    return;
  }

  try {
    execSync('npx prisma migrate deploy', {
      cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
  } catch (error) {
    if (strict) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error('Could not apply migrations to TEST_DATABASE_URL.\n' + detail);
    }
    // Not fatal: setup.ts probes the connection and skips integration specs.
  }
}
