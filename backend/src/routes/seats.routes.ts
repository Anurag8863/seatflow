import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, paginationMeta, sendOk } from '../lib/http.js';
import { requireAuth, requireWriteAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getSeat, listSeats, listZones, type SeatSort } from '../services/seat.service.js';
import { assignSeat, releaseSeat, setSeatStatus } from '../services/seating.service.js';
import { idParamSchema, optionalEnum, optionalString, paginationSchema, sortDirSchema } from './schemas.js';

export const seatsRouter = Router();

seatsRouter.use(requireAuth);

const listQuerySchema = paginationSchema.extend({
  search: optionalString,
  buildingId: optionalString,
  floorId: optionalString,
  zone: optionalString,
  status: optionalEnum(['AVAILABLE', 'OCCUPIED', 'RESERVED', 'DISABLED']),
  department: optionalString,
  sortBy: z.enum(['seatCode', 'zone', 'status', 'updatedAt']).default('seatCode'),
  sortDir: sortDirSchema,
});

seatsRouter.get(
  '/',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    const { items, total } = await listSeats({
      search: query.search,
      buildingId: query.buildingId,
      floorId: query.floorId,
      zone: query.zone,
      status: query.status,
      department: query.department,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy as SeatSort,
      sortDir: query.sortDir,
    });
    return sendOk(res, items, paginationMeta(total, query.page, query.pageSize));
  }),
);

seatsRouter.get(
  '/zones',
  validate({ query: z.object({ floorId: optionalString }) }),
  asyncHandler(async (req, res) => {
    const { floorId } = req.query as { floorId?: string };
    return sendOk(res, await listZones(floorId));
  }),
);

seatsRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => sendOk(res, await getSeat(req.params.id as string))),
);

const assignBodySchema = z.object({
  employeeId: z.string().min(1, 'Choose an employee'),
});

seatsRouter.post(
  '/:id/assign',
  requireWriteAccess,
  validate({ params: idParamSchema, body: assignBodySchema }),
  asyncHandler(async (req, res) => {
    const result = await assignSeat(
      {
        seatId: req.params.id as string,
        employeeId: (req.body as z.infer<typeof assignBodySchema>).employeeId,
      },
      { actorId: req.user!.id, source: 'MANUAL' },
    );
    return sendOk(res, result);
  }),
);

seatsRouter.post(
  '/:id/release',
  requireWriteAccess,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const result = await releaseSeat(
      { seatId: req.params.id as string },
      { actorId: req.user!.id, source: 'MANUAL' },
    );
    return sendOk(res, result);
  }),
);

const statusBodySchema = z.object({
  status: z.enum(['AVAILABLE', 'RESERVED', 'DISABLED']),
  notes: z.string().trim().max(280).nullish(),
});

seatsRouter.patch(
  '/:id/status',
  requireWriteAccess,
  validate({ params: idParamSchema, body: statusBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof statusBodySchema>;
    const result = await setSeatStatus(
      { seatId: req.params.id as string, status: body.status, notes: body.notes ?? undefined },
      { actorId: req.user!.id, source: 'MANUAL' },
    );
    return sendOk(res, result);
  }),
);
