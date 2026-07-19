import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { hostelController } from './hostel.controller';
import {
  addVisitorSchema,
  allocateSchema,
  idParam,
  upsertBuildingSchema,
  upsertRoomSchema,
  vacateSchema,
} from './hostel.validation';

/** Mounted at /api/hostel. School admin + principal. */
export const hostelRoutes = Router();
hostelRoutes.use(authenticate, requireRole('school_admin', 'principal'));

hostelRoutes.get('/dashboard', asyncHandler(hostelController.kpi));

hostelRoutes.get('/buildings', asyncHandler(hostelController.getBuildings));
hostelRoutes.post('/buildings', validate({ body: upsertBuildingSchema }), asyncHandler(hostelController.upsertBuilding));

hostelRoutes.get('/rooms', asyncHandler(hostelController.getRooms));
hostelRoutes.post('/rooms', validate({ body: upsertRoomSchema }), asyncHandler(hostelController.upsertRoom));
hostelRoutes.get('/rooms/:id', validate({ params: idParam }), asyncHandler(hostelController.getRoom));

hostelRoutes.get('/students', asyncHandler(hostelController.getStudents));
hostelRoutes.post('/students/allocate', validate({ body: allocateSchema }), asyncHandler(hostelController.allocate));
hostelRoutes.post('/students/:id/vacate', validate({ params: idParam, body: vacateSchema }), asyncHandler(hostelController.vacate));

hostelRoutes.get('/fee', asyncHandler(hostelController.feeRows));

hostelRoutes.get('/visitors', asyncHandler(hostelController.getVisitors));
hostelRoutes.post('/visitors', validate({ body: addVisitorSchema }), asyncHandler(hostelController.addVisitor));
hostelRoutes.patch('/visitors/:id/checkout', validate({ params: idParam }), asyncHandler(hostelController.checkoutVisitor));
