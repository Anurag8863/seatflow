import { Router } from 'express';
import { asyncHandler, sendOk } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { getDashboardStats } from '../services/dashboard.service.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/',
  asyncHandler(async (_req, res) => sendOk(res, await getDashboardStats())),
);
