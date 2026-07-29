import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { transportTrackingController } from './transport-tracking.controller';
import { addMaintenanceSchema, idParam, saveGpsDeviceSchema } from './transport-tracking.validation';

/** Mounted at /api/transport. */
export const transportTrackingRoutes = Router();
transportTrackingRoutes.use(authenticate, requireRole('school_admin', 'principal', 'coordinator', 'teacher'));

transportTrackingRoutes.get('/vehicles/:id/maintenance', validate({ params: idParam }), asyncHandler(transportTrackingController.getMaintenance));
transportTrackingRoutes.post(
  '/vehicles/:id/maintenance',
  validate({ params: idParam, body: addMaintenanceSchema }),
  asyncHandler(transportTrackingController.addMaintenance),
);
transportTrackingRoutes.get('/vehicles/:id/trips', validate({ params: idParam }), asyncHandler(transportTrackingController.getTripHistory));

transportTrackingRoutes.get('/tracking/live', asyncHandler(transportTrackingController.getLivePositions));

transportTrackingRoutes.get('/gps-devices', asyncHandler(transportTrackingController.getGpsDevices));
transportTrackingRoutes.post(
  '/gps-devices',
  validate({ body: saveGpsDeviceSchema }),
  asyncHandler(transportTrackingController.saveGpsDevice),
);
