import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { asyncHandler, sendOk } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { employeeInclude, seatInclude, serializeEmployee, serializeSeat } from '../services/serializers.js';

export const searchRouter = Router();

searchRouter.use(requireAuth);

const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Type something to search for').max(80),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

/** Powers the header command palette: a few best matches from each entity. */
searchRouter.get(
  '/',
  validate({ query: searchQuerySchema }),
  asyncHandler(async (req, res) => {
    const { q, limit } = req.query as unknown as z.infer<typeof searchQuerySchema>;
    const term = q.trim();

    const [employees, seats] = await Promise.all([
      prisma.employee.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { employeeCode: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
            { department: { contains: term, mode: 'insensitive' } },
          ],
        },
        include: employeeInclude,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      prisma.seat.findMany({
        where: {
          OR: [
            { seatCode: { contains: term, mode: 'insensitive' } },
            { zone: { contains: term, mode: 'insensitive' } },
            { floor: { name: { contains: term, mode: 'insensitive' } } },
            {
              assignments: {
                some: { active: true, employee: { name: { contains: term, mode: 'insensitive' } } },
              },
            },
          ],
        },
        include: seatInclude,
        take: limit,
        orderBy: { seatCode: 'asc' },
      }),
    ]);

    return sendOk(res, {
      query: term,
      employees: employees.map(serializeEmployee),
      seats: seats.map(serializeSeat),
    });
  }),
);
