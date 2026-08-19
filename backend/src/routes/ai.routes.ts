import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, paginationMeta, sendOk } from '../lib/http.js';
import { requireAuth, requireWriteAccess } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import {
  cancelAiAction,
  executeAiAction,
  getAiAction,
  interpretPrompt,
  listAiActions,
} from '../services/ai/index.js';
import { describeProvider } from '../services/ai/provider.js';
import { idParamSchema, optionalEnum, optionalString, paginationSchema } from './schemas.js';

export const aiRouter = Router();

aiRouter.use(requireAuth);

aiRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const provider = describeProvider();
    return sendOk(res, {
      ...provider,
      // Never the key itself — only whether one is configured.
      configured: true,
      description:
        provider.provider === 'local'
          ? 'Running the built-in deterministic interpreter. Set AI_PROVIDER and AI_API_KEY to use a hosted model.'
          : 'Connected to ' + provider.provider + ' (' + provider.model + ').',
    });
  }),
);

const interpretSchema = z.object({
  prompt: z.string().trim().min(3, 'Tell me what you would like to change').max(500),
  selectedEmployeeId: z.string().min(1).nullish(),
  selectedFloorId: z.string().min(1).nullish(),
  scopeBuildingId: z.string().min(1).nullish(),
});

aiRouter.post(
  '/interpret',
  requireWriteAccess,
  aiLimiter,
  validate({ body: interpretSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof interpretSchema>;
    const plan = await interpretPrompt({
      prompt: body.prompt,
      userId: req.user!.id,
      selectedEmployeeId: body.selectedEmployeeId ?? null,
      selectedFloorId: body.selectedFloorId ?? null,
      scopeBuildingId: body.scopeBuildingId ?? null,
    });
    return sendOk(res, plan);
  }),
);

const executeSchema = z.object({
  aiActionId: z.string().min(1, 'An AI action id is required'),
});

aiRouter.post(
  '/execute',
  requireWriteAccess,
  aiLimiter,
  validate({ body: executeSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof executeSchema>;
    return sendOk(res, await executeAiAction(body.aiActionId, req.user!.id));
  }),
);

aiRouter.post(
  '/cancel',
  requireWriteAccess,
  validate({ body: executeSchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof executeSchema>;
    return sendOk(res, await cancelAiAction(body.aiActionId, req.user!.id));
  }),
);

const historyQuerySchema = paginationSchema.extend({
  search: optionalString,
  status: optionalEnum(['PENDING', 'EXECUTED', 'FAILED', 'CANCELLED', 'REJECTED', 'NEEDS_INPUT', 'ANSWERED']),
});

aiRouter.get(
  '/actions',
  validate({ query: historyQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof historyQuerySchema>;
    const { items, total } = await listAiActions({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      search: query.search,
    });
    return sendOk(res, items, paginationMeta(total, query.page, query.pageSize));
  }),
);

aiRouter.get(
  '/actions/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => sendOk(res, await getAiAction(req.params.id as string))),
);
