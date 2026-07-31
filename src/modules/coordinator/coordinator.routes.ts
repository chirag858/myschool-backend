import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { coordinatorController } from './coordinator.controller';
import {
  applyLeaveSchema,
  assignedClassesSchema,
  idParam,
  messageBodySchema,
  reasonSchema,
  remarksSchema,
  staffIdParam,
  teacherAssignmentSchema,
  userIdParam,
} from './coordinator.validation';

/** Mounted at /api/coordinator. Coordinator + school_admin + principal. */
export const coordinatorRoutes = Router();
coordinatorRoutes.use(authenticate, requireRole('coordinator', 'school_admin', 'principal'));

coordinatorRoutes.get('/dashboard', asyncHandler(coordinatorController.dashboard));
coordinatorRoutes.get('/students', asyncHandler(coordinatorController.getStudents));
coordinatorRoutes.get('/students/export', asyncHandler(coordinatorController.exportStudents));
coordinatorRoutes.patch(
  '/assigned-classes/:userId',
  requireRole('school_admin', 'principal'),
  validate({ params: userIdParam, body: assignedClassesSchema }),
  asyncHandler(coordinatorController.setAssignedClasses),
);

coordinatorRoutes.get('/teachers', asyncHandler(coordinatorController.getTeachers));
coordinatorRoutes.get('/teacher-assignments', asyncHandler(coordinatorController.getTeacherAssignments));
coordinatorRoutes.post(
  '/teacher-assignments',
  requireRole('school_admin', 'principal'),
  validate({ body: teacherAssignmentSchema }),
  asyncHandler(coordinatorController.saveTeacherAssignment),
);
coordinatorRoutes.delete(
  '/teacher-assignments/:id',
  requireRole('school_admin', 'principal'),
  validate({ params: idParam }),
  asyncHandler(coordinatorController.deleteTeacherAssignment),
);

coordinatorRoutes.get('/student-leaves', asyncHandler(coordinatorController.getStudentLeaves));
coordinatorRoutes.post('/student-leaves', validate({ body: applyLeaveSchema }), asyncHandler(coordinatorController.applyOnBehalf));
coordinatorRoutes.patch('/student-leaves/:id/approve', validate({ params: idParam, body: remarksSchema }), asyncHandler(coordinatorController.approve));
coordinatorRoutes.patch('/student-leaves/:id/reject', validate({ params: idParam, body: reasonSchema }), asyncHandler(coordinatorController.reject));
coordinatorRoutes.patch('/student-leaves/:id/forward', validate({ params: idParam, body: remarksSchema }), asyncHandler(coordinatorController.forward));

coordinatorRoutes.get('/staff-leaves', asyncHandler(coordinatorController.getStaffLeaves));
coordinatorRoutes.patch('/staff-leaves/:id/approve-level1', validate({ params: idParam, body: remarksSchema }), asyncHandler(coordinatorController.approveStaffLeaveLevel1));
coordinatorRoutes.patch('/staff-leaves/:id/reject', validate({ params: idParam, body: reasonSchema }), asyncHandler(coordinatorController.rejectStaffLeave));

coordinatorRoutes.get('/marks-overview', asyncHandler(coordinatorController.getMarksOverview));
coordinatorRoutes.get('/staff-overview', asyncHandler(coordinatorController.getStaffOverview));
coordinatorRoutes.get('/staff-attendance', asyncHandler(coordinatorController.getStaffAttendance));
coordinatorRoutes.get('/staff-attendance/export', asyncHandler(coordinatorController.exportStaffAttendance));
coordinatorRoutes.post(
  '/staff/:staffId/message',
  validate({ params: staffIdParam, body: messageBodySchema }),
  asyncHandler(coordinatorController.messageStaff),
);
