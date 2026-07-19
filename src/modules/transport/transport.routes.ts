import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { transportController } from './transport.controller';
import {
  assignSchema,
  createDriverSchema,
  createVehicleSchema,
  idParam,
  statusSchema,
  updateDriverSchema,
  updateVehicleSchema,
  upsertRouteSchema,
} from './transport.validation';

/** Mounted at /api/transport. School admin + principal. (GPS/maintenance/tracking deferred.) */
export const transportRoutes = Router();
transportRoutes.use(authenticate, requireRole('school_admin', 'principal'));

transportRoutes.get('/dashboard', asyncHandler(transportController.kpi));

transportRoutes.get('/vehicles', asyncHandler(transportController.getVehicles));
transportRoutes.post('/vehicles', validate({ body: createVehicleSchema }), asyncHandler(transportController.createVehicle));
transportRoutes.get('/vehicles/:id', validate({ params: idParam }), asyncHandler(transportController.getVehicle));
transportRoutes.put('/vehicles/:id', validate({ params: idParam, body: updateVehicleSchema }), asyncHandler(transportController.updateVehicle));
transportRoutes.patch('/vehicles/:id/status', validate({ params: idParam, body: statusSchema }), asyncHandler(transportController.changeVehicleStatus));

transportRoutes.get('/drivers', asyncHandler(transportController.getDrivers));
transportRoutes.post('/drivers', validate({ body: createDriverSchema }), asyncHandler(transportController.createDriver));
transportRoutes.put('/drivers/:id', validate({ params: idParam, body: updateDriverSchema }), asyncHandler(transportController.updateDriver));

transportRoutes.get('/routes', asyncHandler(transportController.getRoutes));
transportRoutes.post('/routes', validate({ body: upsertRouteSchema }), asyncHandler(transportController.upsertRoute));
transportRoutes.get('/routes/:id', validate({ params: idParam }), asyncHandler(transportController.getRoute));
transportRoutes.delete('/routes/:id', validate({ params: idParam }), asyncHandler(transportController.deleteRoute));

transportRoutes.get('/students', asyncHandler(transportController.getAssignments));
transportRoutes.post('/students/assign', validate({ body: assignSchema }), asyncHandler(transportController.upsertAssignment));
transportRoutes.delete('/students/:id/assignment', validate({ params: idParam }), asyncHandler(transportController.removeAssignment));
