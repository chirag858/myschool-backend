import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { receptionController } from './reception.controller';
import { appointmentSchema, callLogSchema, idParam, statusSchema } from './reception.validation';

/** Mounted at /api/reception. Receptionist + school_admin. */
export const receptionRoutes = Router();
receptionRoutes.use(authenticate, requireRole('receptionist', 'school_admin'));

receptionRoutes.get('/dashboard', asyncHandler(receptionController.dashboard));

receptionRoutes.get('/appointments', asyncHandler(receptionController.getAppointments));
receptionRoutes.post('/appointments', validate({ body: appointmentSchema }), asyncHandler(receptionController.createAppointment));
receptionRoutes.patch('/appointments/:id/status', validate({ params: idParam, body: statusSchema }), asyncHandler(receptionController.setAppointmentStatus));

receptionRoutes.get('/call-logs', asyncHandler(receptionController.getCallLogs));
receptionRoutes.post('/call-logs', validate({ body: callLogSchema }), asyncHandler(receptionController.createCallLog));
receptionRoutes.patch('/call-logs/:id/follow-up-done', validate({ params: idParam }), asyncHandler(receptionController.markFollowUpDone));
