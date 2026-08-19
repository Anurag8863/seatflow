import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, paginationMeta, sendCreated, sendOk } from '../lib/http.js';
import { requireAuth, requireWriteAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  createEmployee,
  getEmployeeDetail,
  listDepartments,
  listEmployees,
  updateEmployee,
  type EmployeeSort,
} from '../services/employee.service.js';
import { moveEmployee, releaseEmployeeSeat } from '../services/seating.service.js';
import { idParamSchema, optionalEnum, optionalString, paginationSchema, sortDirSchema } from './schemas.js';

export const employeesRouter = Router();

employeesRouter.use(requireAuth);

const listQuerySchema = paginationSchema.extend({
  search: optionalString,
  department: optionalString,
  status: optionalEnum(['ACTIVE', 'ON_LEAVE', 'INACTIVE']),
  seatState: optionalEnum(['assigned', 'unassigned']),
  floorId: optionalString,
  sortBy: z
    .enum(['name', 'employeeCode', 'department', 'jobTitle', 'status', 'createdAt'])
    .default('name'),
  sortDir: sortDirSchema,
});

employeesRouter.get(
  '/',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    const { items, total } = await listEmployees({
      search: query.search,
      department: query.department,
      status: query.status,
      seatState: query.seatState,
      floorId: query.floorId,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy as EmployeeSort,
      sortDir: query.sortDir,
    });
    return sendOk(res, items, paginationMeta(total, query.page, query.pageSize));
  }),
);

employeesRouter.get(
  '/departments',
  asyncHandler(async (_req, res) => sendOk(res, await listDepartments())),
);

employeesRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => sendOk(res, await getEmployeeDetail(req.params.id as string))),
);

const employeeBodySchema = z.object({
  employeeCode: z.string().trim().min(2).max(20),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  department: z.string().trim().min(2).max(60),
  jobTitle: z.string().trim().min(2).max(80),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'INACTIVE']).optional(),
});

employeesRouter.post(
  '/',
  requireWriteAccess,
  validate({ body: employeeBodySchema }),
  asyncHandler(async (req, res) => {
    const employee = await createEmployee(req.body as z.infer<typeof employeeBodySchema>, req.user!.id);
    return sendCreated(res, employee);
  }),
);

employeesRouter.patch(
  '/:id',
  requireWriteAccess,
  validate({ params: idParamSchema, body: employeeBodySchema.partial() }),
  asyncHandler(async (req, res) => {
    const employee = await updateEmployee(
      req.params.id as string,
      req.body as Partial<z.infer<typeof employeeBodySchema>>,
      req.user!.id,
    );
    return sendOk(res, employee);
  }),
);

const moveBodySchema = z.object({
  seatId: z.string().min(1, 'Choose a destination seat'),
});

employeesRouter.post(
  '/:id/move',
  requireWriteAccess,
  validate({ params: idParamSchema, body: moveBodySchema }),
  asyncHandler(async (req, res) => {
    const result = await moveEmployee(
      { employeeId: req.params.id as string, toSeatId: (req.body as z.infer<typeof moveBodySchema>).seatId },
      { actorId: req.user!.id, source: 'MANUAL' },
    );
    return sendOk(res, result);
  }),
);

employeesRouter.post(
  '/:id/release',
  requireWriteAccess,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const result = await releaseEmployeeSeat(
      { employeeId: req.params.id as string },
      { actorId: req.user!.id, source: 'MANUAL' },
    );
    return sendOk(res, result);
  }),
);
