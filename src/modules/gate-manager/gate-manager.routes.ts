import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { gateManagerController } from './gate-manager.controller';
import { idParam, otpSchema, releaseSchema, teacherPassSchema, visitorSchema } from './gate-manager.validation';

/** Mounted at /api/gate-manager. gate_manager + school_admin + principal. */
export const gateManagerRoutes = Router();
gateManagerRoutes.use(authenticate, requireRole('gate_manager', 'school_admin', 'principal'));

gateManagerRoutes.get('/dashboard', asyncHandler(gateManagerController.dashboard));
gateManagerRoutes.get('/students', asyncHandler(gateManagerController.searchStudents));

gateManagerRoutes.get('/pickups', asyncHandler(gateManagerController.getPickups));
gateManagerRoutes.post('/pickups', validate({ body: releaseSchema }), asyncHandler(gateManagerController.releaseStudent));
gateManagerRoutes.post('/otp/send', validate({ body: otpSchema }), asyncHandler(gateManagerController.sendOtp));

gateManagerRoutes.get('/visitors', asyncHandler(gateManagerController.getVisitors));
gateManagerRoutes.post('/visitors', validate({ body: visitorSchema }), asyncHandler(gateManagerController.logVisitor));
gateManagerRoutes.patch('/visitors/:id/checkout', validate({ params: idParam }), asyncHandler(gateManagerController.checkoutVisitor));

gateManagerRoutes.get('/teacher-passes', asyncHandler(gateManagerController.getTeacherPasses));
gateManagerRoutes.post('/teacher-passes', validate({ body: teacherPassSchema }), asyncHandler(gateManagerController.logTeacherPass));
gateManagerRoutes.patch('/teacher-passes/:id/return', validate({ params: idParam }), asyncHandler(gateManagerController.returnTeacherPass));
