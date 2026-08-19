import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './db/prisma.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  // Fail fast with a clear message rather than surfacing connection errors on
  // the first request a user makes.
  try {
    await prisma.$connect();
  } catch (error) {
    logger.error('Could not connect to the database', {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info('SeatFlow API listening', {
      port: env.PORT,
      env: env.NODE_ENV,
      aiProvider: env.AI_PROVIDER,
      servingFrontend: env.serveStatic,
    });
  });

  const shutdown = (signal: string) => {
    logger.info('Shutting down', { signal });
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main();
