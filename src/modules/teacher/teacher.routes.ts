import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { teacherController } from './teacher.controller';
import {
  applyLeaveSchema,
  assignmentSchema,
  circularSchema,
  gradeParams,
  gradeSchema,
  homeworkPatchSchema,
  homeworkSchema,
  idParam,
} from './teacher.validation';

/** Mounted at /api/teacher. The logged-in teacher's own portal. */
export const teacherRoutes = Router();
teacherRoutes.use(authenticate, requireRole('teacher', 'school_admin', 'principal'));

teacherRoutes.get('/my-classes', asyncHandler(teacherController.myClasses));
teacherRoutes.get('/my-students', asyncHandler(teacherController.myStudents));
teacherRoutes.get('/my-exams', asyncHandler(teacherController.myExams));
teacherRoutes.get('/dashboard-summary', asyncHandler(teacherController.dashboardSummary));

teacherRoutes.get('/homework', asyncHandler(teacherController.getHomework));
teacherRoutes.post('/homework', validate({ body: homeworkSchema }), asyncHandler(teacherController.createHomework));
teacherRoutes.get('/homework/:id/submissions', validate({ params: idParam }), asyncHandler(teacherController.homeworkSubmissions));
teacherRoutes.delete('/homework/:id', validate({ params: idParam }), asyncHandler(teacherController.deleteHomework));

teacherRoutes.get('/assignments', asyncHandler(teacherController.getAssignments));
teacherRoutes.post('/assignments', validate({ body: assignmentSchema }), asyncHandler(teacherController.createAssignment));
teacherRoutes.patch('/assignments/:id/close', validate({ params: idParam }), asyncHandler(teacherController.closeAssignment));
teacherRoutes.delete('/assignments/:id', validate({ params: idParam }), asyncHandler(teacherController.deleteAssignment));
teacherRoutes.get('/assignments/:id/submissions', validate({ params: idParam }), asyncHandler(teacherController.getSubmissions));
teacherRoutes.patch(
  '/assignments/:id/submissions/:studentId/grade',
  validate({ params: gradeParams, body: gradeSchema }),
  asyncHandler(teacherController.gradeSubmission),
);

teacherRoutes.get('/circulars/received', asyncHandler(teacherController.receivedCirculars));
teacherRoutes.get('/circulars/mine', asyncHandler(teacherController.myCirculars));
teacherRoutes.post('/circulars', validate({ body: circularSchema }), asyncHandler(teacherController.createCircular));

teacherRoutes.get('/leave/balance', asyncHandler(teacherController.leaveBalance));
teacherRoutes.get('/leave/history', asyncHandler(teacherController.leaveHistory));
teacherRoutes.post('/leave/apply', validate({ body: applyLeaveSchema }), asyncHandler(teacherController.applyLeave));
teacherRoutes.delete('/leave/:id/cancel', validate({ params: idParam }), asyncHandler(teacherController.cancelLeave));

/** Mounted at /api/homework. Cross-role homework overview + role-gated edit. */
export const homeworkRoutes = Router();
homeworkRoutes.use(authenticate, requireRole('school_admin', 'principal', 'coordinator', 'support_engineer', 'teacher'));
homeworkRoutes.get('/', asyncHandler(teacherController.getAllHomework));
homeworkRoutes.patch('/:id', validate({ params: idParam, body: homeworkPatchSchema }), asyncHandler(teacherController.updateHomework));
