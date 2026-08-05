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

/**
 * Mounted at /api/transport. Vehicle/driver mutation, the KPI dashboard, and
 * student-transport assignment stay school_admin/principal-only — the
 * sidebar never exposes those to coordinator/teacher. The routes list and
 * the read-only vehicle/driver lookups it depends on (for the route
 * builder's Select dropdowns, and for the GPS Devices table's Vehicle/Route
 * columns) are opened to coordinator/teacher/super_admin/support_engineer,
 * matching the `/admin/transport/routes` and `/admin/transport/gps-devices`
 * pages they're allowed to reach.
 */
export const transportRoutes = Router();
transportRoutes.use(authenticate);

const adminOnly = requireRole('school_admin', 'principal');
const routesReaders = requireRole(
  'school_admin',
  'principal',
  'coordinator',
  'teacher',
  'super_admin',
  'support_engineer',
);

transportRoutes.get('/dashboard', adminOnly, asyncHandler(transportController.kpi));

transportRoutes.get('/vehicles', routesReaders, asyncHandler(transportController.getVehicles));
transportRoutes.post('/vehicles', adminOnly, validate({ body: createVehicleSchema }), asyncHandler(transportController.createVehicle));
transportRoutes.get('/vehicles/:id', adminOnly, validate({ params: idParam }), asyncHandler(transportController.getVehicle));
transportRoutes.put('/vehicles/:id', adminOnly, validate({ params: idParam, body: updateVehicleSchema }), asyncHandler(transportController.updateVehicle));
transportRoutes.patch('/vehicles/:id/status', adminOnly, validate({ params: idParam, body: statusSchema }), asyncHandler(transportController.changeVehicleStatus));

transportRoutes.get('/drivers', routesReaders, asyncHandler(transportController.getDrivers));
transportRoutes.post('/drivers', adminOnly, validate({ body: createDriverSchema }), asyncHandler(transportController.createDriver));
transportRoutes.put('/drivers/:id', adminOnly, validate({ params: idParam, body: updateDriverSchema }), asyncHandler(transportController.updateDriver));

transportRoutes.get('/routes', routesReaders, asyncHandler(transportController.getRoutes));
transportRoutes.post('/routes', routesReaders, validate({ body: upsertRouteSchema }), asyncHandler(transportController.upsertRoute));
transportRoutes.get('/routes/:id', routesReaders, validate({ params: idParam }), asyncHandler(transportController.getRoute));
transportRoutes.delete('/routes/:id', adminOnly, validate({ params: idParam }), asyncHandler(transportController.deleteRoute));

transportRoutes.get('/students', adminOnly, asyncHandler(transportController.getAssignments));
transportRoutes.post('/students/assign', adminOnly, validate({ body: assignSchema }), asyncHandler(transportController.upsertAssignment));
transportRoutes.delete('/students/:id/assignment', adminOnly, validate({ params: idParam }), asyncHandler(transportController.removeAssignment));
