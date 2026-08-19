import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { apiRouter } from './routes/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/ (built) or src/ (tsx) -> backend -> repo root -> frontend/dist
const frontendDist = path.resolve(here, '..', '..', 'frontend', 'dist');

export function createApp(): Express {
  const app = express();

  // Railway terminates TLS upstream; trusting the proxy keeps req.ip and the
  // Secure cookie flag correct behind it.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The SPA is served from this same origin; the default CSP would block
      // its inline styles, so a tailored policy is applied instead.
      contentSecurityPolicy: env.isProduction
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              fontSrc: ["'self'", 'data:'],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  if (env.corsOrigins.length > 0) {
    app.use(
      cors({
        origin: env.corsOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      }),
    );
  }

  app.use(compression());
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(cookieParser());

  if (!env.isTest) {
    app.use(
      morgan(env.isProduction ? 'combined' : 'dev', {
        skip: (req) => req.path === '/api/health',
      }),
    );
  }

  app.use('/api', apiLimiter, apiRouter);
  app.use('/api', notFoundHandler);

  if (env.serveStatic) {
    app.use(
      express.static(frontendDist, {
        index: false,
        maxAge: '1y',
        setHeaders: (res, filePath) => {
          // Hashed assets can be cached hard; the shell must not be.
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );

    // Client-side routing: anything that is not an API call gets the SPA shell.
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
