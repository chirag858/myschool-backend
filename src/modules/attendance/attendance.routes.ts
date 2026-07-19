import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ACADEMIC_ADMIN_ROLES } from '../user/roles';
import { attendanceController } from './attendance.controller';
import {
  markQuerySchema,
  overridePayloadSchema,
  savePayloadSchema,
} from './attendance.validation';

/** Mounted at /api/attendance. Academic admins + teachers. */
export const attendanceRoutes = Router();
attendanceRoutes.use(authenticate, requireRole(...ACADEMIC_ADMIN_ROLES, 'teacher'));

attendanceRoutes.get('/dashboard', asyncHandler(attendanceController.dashboard));
attendanceRoutes.get('/mark', validate({ query: markQuerySchema }), asyncHandler(attendanceController.markSession));
attendanceRoutes.post('/save', validate({ body: savePayloadSchema }), asyncHandler(attendanceController.save));
attendanceRoutes.post('/save-and-alert', validate({ body: savePayloadSchema }), asyncHandler(attendanceController.saveAndAlert));
attendanceRoutes.patch('/override', validate({ body: overridePayloadSchema }), asyncHandler(attendanceController.override));
attendanceRoutes.get('/override-history', asyncHandler(attendanceController.overrideHistory));
attendanceRoutes.get('/reports/daily', asyncHandler(attendanceController.dailySummary));
attendanceRoutes.get('/reports/absentees', asyncHandler(attendanceController.absentees));
attendanceRoutes.get('/reports/monthly', asyncHandler(attendanceController.monthlyReport));
attendanceRoutes.get('/reports/low-attendance', asyncHandler(attendanceController.lowAttendance));
attendanceRoutes.get('/reports/register', asyncHandler(attendanceController.registerMatrix));
