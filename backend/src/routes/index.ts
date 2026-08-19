import { Router } from 'express';
import { aiRouter } from './ai.routes.js';
import { auditRouter } from './audit.routes.js';
import { authRouter } from './auth.routes.js';
import { employeesRouter } from './employees.routes.js';
import { buildingsRouter, floorsRouter } from './floors.routes.js';
import { dashboardRouter } from './dashboard.routes.js';
import { searchRouter } from './search.routes.js';
import { seatsRouter } from './seats.routes.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', uptime: Math.round(process.uptime()) } });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/search', searchRouter);
apiRouter.use('/employees', employeesRouter);
apiRouter.use('/seats', seatsRouter);
apiRouter.use('/floors', floorsRouter);
apiRouter.use('/buildings', buildingsRouter);
apiRouter.use('/audit-logs', auditRouter);
apiRouter.use('/ai', aiRouter);
