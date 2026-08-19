import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { asyncHandler, sendOk } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getFloorPlan, listBuildings } from '../services/seat.service.js';
import { idParamSchema } from './schemas.js';

export const floorsRouter = Router();
export const buildingsRouter = Router();

floorsRouter.use(requireAuth);
buildingsRouter.use(requireAuth);

buildingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => sendOk(res, await listBuildings())),
);

floorsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const floors = await prisma.floor.findMany({
      orderBy: [{ building: { name: 'asc' } }, { floorNumber: 'asc' }],
      include: {
        building: { select: { id: true, name: true, code: true } },
        _count: { select: { seats: true } },
      },
    });
    return sendOk(
      res,
      floors.map((floor) => ({
        id: floor.id,
        name: floor.name,
        floorNumber: floor.floorNumber,
        seatCount: floor._count.seats,
        building: floor.building,
      })),
    );
  }),
);

floorsRouter.get(
  '/:id/plan',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => sendOk(res, await getFloorPlan(req.params.id as string))),
);
