import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { driverAppController as C } from './driver-app.controller';

/** Mounted at /api/driver. Driver app — the producer of the live bus feed. */
export const driverAppRoutes = Router();
driverAppRoutes.use(authenticate, requireRole('driver'));

driverAppRoutes.get('/assignment', asyncHandler(C.assignment));
driverAppRoutes.get('/manifest', asyncHandler(C.manifest));
driverAppRoutes.post('/manifest/mark', asyncHandler(C.markBoarding));
driverAppRoutes.post('/trip/start', asyncHandler(C.startTrip));
driverAppRoutes.post('/trip/end', asyncHandler(C.endTrip));
driverAppRoutes.post('/location/emit', asyncHandler(C.emit));
driverAppRoutes.get('/location/preview', asyncHandler(C.preview));
driverAppRoutes.get('/alerts', asyncHandler(C.alerts));
driverAppRoutes.post('/alerts', asyncHandler(C.triggerAlert));
driverAppRoutes.get('/trips', asyncHandler(C.tripHistory));
driverAppRoutes.get('/trips/detail', asyncHandler(C.tripDetail));
