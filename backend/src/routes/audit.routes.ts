import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, paginationMeta, sendOk } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getAuditSummary, listAuditLogs } from '../services/audit.service.js';
import { optionalEnum, optionalString, paginationSchema } from './schemas.js';

export const auditRouter = Router();

auditRouter.use(requireAuth);

const AUDIT_ACTIONS = [
  'EMPLOYEE_ASSIGNED',
  'EMPLOYEE_MOVED',
  'SEAT_RELEASED',
  'SEAT_DISABLED',
  'SEAT_ENABLED',
  'SEAT_RESERVED',
  'SEAT_UNRESERVED',
  'EMPLOYEE_CREATED',
  'EMPLOYEE_UPDATED',
  'AI_ACTION_EXECUTED',
] as const;

const listQuerySchema = paginationSchema.extend({
  search: optionalString,
  action: optionalEnum(AUDIT_ACTIONS),
  source: optionalEnum(['MANUAL', 'AI', 'SYSTEM']),
  employeeId: optionalString,
  from: optionalString,
  to: optionalString,
});

auditRouter.get(
  '/',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    const { items, total } = await listAuditLogs({
      search: query.search,
      action: query.action,
      source: query.source,
      employeeId: query.employeeId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    return sendOk(res, items, paginationMeta(total, query.page, query.pageSize));
  }),
);

auditRouter.get(
  '/summary',
  asyncHandler(async (_req, res) => sendOk(res, await getAuditSummary())),
);
