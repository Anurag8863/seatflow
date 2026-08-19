import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * A single PrismaClient is reused across the process. Caching it on globalThis
 * stops hot-reloading in development from opening a new connection pool on
 * every file change.
 */
const globalForPrisma = globalThis as unknown as { seatflowPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.seatflowPrisma ??
  new PrismaClient({
    log: env.isDevelopment ? ['warn', 'error'] : ['error'],
  });

if (!env.isProduction) {
  globalForPrisma.seatflowPrisma = prisma;
}
