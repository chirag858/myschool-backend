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

/**
 * Mounted at /api/coordinator. Coordinator + school_admin + principal for
 * the portal itself. support_engineer is also let through, but ONLY for the
 * class-assignment picker (search-coordinators / class-keys / assigned-classes
 * write) — it has no schoolId of its own and passes ?schoolId= explicitly
 * (see schoolId() in coordinator.controller.ts), same pattern as
 * transport-tracking/school-reports. It cannot reach the rest of this router
 * (dashboard, leaves, marks, etc.) — those stay tenant-only below.
 */
export const coordinatorRoutes = Router();
coordinatorRoutes.use(authenticate, requireRole('coordinator', 'school_admin', 'principal', 'support_engineer'));
const tenantOnly = requireRole('coordinator', 'school_admin', 'principal');

coordinatorRoutes.get('/search-coordinators', asyncHandler(coordinatorController.searchCoordinators));
coordinatorRoutes.get('/class-keys', asyncHandler(coordinatorController.getClassKeys));
coordinatorRoutes.patch(
  '/assigned-classes/:userId',
  requireRole('school_admin', 'principal', 'support_engineer'),
  validate({ params: userIdParam, body: assignedClassesSchema }),
  asyncHandler(coordinatorController.setAssignedClasses),
);

coordinatorRoutes.get('/dashboard', tenantOnly, asyncHandler(coordinatorController.dashboard));
coordinatorRoutes.get('/students', tenantOnly, asyncHandler(coordinatorController.getStudents));
coordinatorRoutes.get('/students/export', tenantOnly, asyncHandler(coordinatorController.exportStudents));

coordinatorRoutes.get('/teachers', tenantOnly, asyncHandler(coordinatorController.getTeachers));
coordinatorRoutes.get('/teacher-assignments', tenantOnly, asyncHandler(coordinatorController.getTeacherAssignments));
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

coordinatorRoutes.get('/student-leaves', tenantOnly, asyncHandler(coordinatorController.getStudentLeaves));
coordinatorRoutes.post('/student-leaves', tenantOnly, validate({ body: applyLeaveSchema }), asyncHandler(coordinatorController.applyOnBehalf));
coordinatorRoutes.patch('/student-leaves/:id/approve', tenantOnly, validate({ params: idParam, body: remarksSchema }), asyncHandler(coordinatorController.approve));
coordinatorRoutes.patch('/student-leaves/:id/reject', tenantOnly, validate({ params: idParam, body: reasonSchema }), asyncHandler(coordinatorController.reject));
coordinatorRoutes.patch('/student-leaves/:id/forward', tenantOnly, validate({ params: idParam, body: remarksSchema }), asyncHandler(coordinatorController.forward));

coordinatorRoutes.get('/staff-leaves', tenantOnly, asyncHandler(coordinatorController.getStaffLeaves));
coordinatorRoutes.patch('/staff-leaves/:id/approve-level1', tenantOnly, validate({ params: idParam, body: remarksSchema }), asyncHandler(coordinatorController.approveStaffLeaveLevel1));
coordinatorRoutes.patch('/staff-leaves/:id/reject', tenantOnly, validate({ params: idParam, body: reasonSchema }), asyncHandler(coordinatorController.rejectStaffLeave));

coordinatorRoutes.get('/marks-overview', tenantOnly, asyncHandler(coordinatorController.getMarksOverview));
coordinatorRoutes.get('/staff-overview', tenantOnly, asyncHandler(coordinatorController.getStaffOverview));
coordinatorRoutes.get('/staff-attendance', tenantOnly, asyncHandler(coordinatorController.getStaffAttendance));
coordinatorRoutes.get('/staff-attendance/export', tenantOnly, asyncHandler(coordinatorController.exportStaffAttendance));
coordinatorRoutes.post(
  '/staff/:staffId/message',
  tenantOnly,
  validate({ params: staffIdParam, body: messageBodySchema }),
  asyncHandler(coordinatorController.messageStaff),
);
