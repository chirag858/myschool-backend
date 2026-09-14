import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { driverAppController as C } from './driver-app.controller';

/**
 * Mounted at /api/driver. The driver app's whole surface — five routes.
 *
 * Everything is scoped to the driver's own bus, resolved from the token via
 * `Vehicle.driverUserId`; nothing here takes a route or bus id from the client.
 */
export const driverAppRoutes = Router();
driverAppRoutes.use(authenticate, requireRole('driver'));

driverAppRoutes.get('/my-bus', asyncHandler(C.myBus));
driverAppRoutes.get('/my-bus/students', asyncHandler(C.myBusStudents));
driverAppRoutes.post('/my-bus/trip/start', asyncHandler(C.startBusTrip));
driverAppRoutes.post('/my-bus/trip/end', asyncHandler(C.endBusTrip));

// On-demand location: the app parks `duty/wait` while on duty and answers a
// parent's request with `duty/position`. Nothing here is ever persisted.
driverAppRoutes.get('/duty/wait', asyncHandler(C.dutyWait));
driverAppRoutes.post('/duty/position', asyncHandler(C.dutyPosition));
