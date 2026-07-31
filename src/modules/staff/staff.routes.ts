import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { staffController } from './staff.controller';
import {
  attendanceMonthQuery,
  createCredentialsSchema,
  createStaffSchema,
  idParam,
  lockSchema,
  resetPasswordSchema,
  saveAttendanceSchema,
  staffQuery,
  statusSchema,
  updateCredentialsSchema,
} from './staff.validation';

/** Mounted at /api/staff. School admin + principal. (payroll/leave/salary/exit deferred.) */
export const staffRoutes = Router();
staffRoutes.use(authenticate, requireRole('school_admin', 'principal'));

staffRoutes.get('/', validate({ query: staffQuery }), asyncHandler(staffController.list));
staffRoutes.post('/', validate({ body: createStaffSchema }), asyncHandler(staffController.create));
staffRoutes.get('/stats', asyncHandler(staffController.stats));
staffRoutes.get('/generate-id', asyncHandler(staffController.generateId));
staffRoutes.get('/check-id', asyncHandler(staffController.checkId));

staffRoutes.get('/attendance', asyncHandler(staffController.getAttendance));
staffRoutes.post('/attendance/save', validate({ body: saveAttendanceSchema }), asyncHandler(staffController.saveAttendance));
staffRoutes.patch('/attendance/lock', validate({ body: lockSchema }), asyncHandler(staffController.lock));
staffRoutes.get('/attendance/report', asyncHandler(staffController.report));

staffRoutes.get('/:id/attendance-month', validate({ params: idParam, query: attendanceMonthQuery }), asyncHandler(staffController.attendanceMonth));
staffRoutes.get('/:id', validate({ params: idParam }), asyncHandler(staffController.profile));
staffRoutes.patch('/:id/status', validate({ params: idParam, body: statusSchema }), asyncHandler(staffController.updateStatus));

staffRoutes.get('/:id/credentials', validate({ params: idParam }), asyncHandler(staffController.getCredentials));
staffRoutes.post('/:id/credentials', validate({ params: idParam, body: createCredentialsSchema }), asyncHandler(staffController.createCredentials));
staffRoutes.patch('/:id/credentials', validate({ params: idParam, body: updateCredentialsSchema }), asyncHandler(staffController.updateCredentials));
staffRoutes.post('/:id/credentials/reset-password', validate({ params: idParam, body: resetPasswordSchema }), asyncHandler(staffController.resetPassword));
