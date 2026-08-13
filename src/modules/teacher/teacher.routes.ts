import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { teacherController } from './teacher.controller';
import {
  applyLeaveSchema,
  assignmentPatchSchema,
  assignmentSchema,
  circularPatchSchema,
  circularSchema,
  gradeParams,
  gradeSchema,
  homeworkPatchSchema,
  homeworkSchema,
  homeworkSubmissionSchema,
  idParam,
  receiveSubmissionSchema,
  reviewTeacherLeaveSchema,
} from './teacher.validation';

/** Mounted at /api/teacher. The logged-in teacher's own portal. */
export const teacherRoutes = Router();
teacherRoutes.use(authenticate, requireRole('teacher', 'school_admin', 'principal'));

teacherRoutes.get('/my-classes', asyncHandler(teacherController.myClasses));
teacherRoutes.get('/my-students', asyncHandler(teacherController.myStudents));
teacherRoutes.get('/my-exams', asyncHandler(teacherController.myExams));
teacherRoutes.get('/my-teaching', asyncHandler(teacherController.myTeaching));
teacherRoutes.get('/dashboard-summary', asyncHandler(teacherController.dashboardSummary));

teacherRoutes.get('/homework', asyncHandler(teacherController.getHomework));
teacherRoutes.post('/homework', validate({ body: homeworkSchema }), asyncHandler(teacherController.createHomework));
teacherRoutes.get('/homework/:id/submissions', validate({ params: idParam }), asyncHandler(teacherController.homeworkSubmissions));
teacherRoutes.patch(
  '/homework/:id/submissions/:studentId',
  validate({ params: gradeParams, body: homeworkSubmissionSchema }),
  asyncHandler(teacherController.setHomeworkSubmission),
);
teacherRoutes.post('/homework/:id/remind', validate({ params: idParam }), asyncHandler(teacherController.remindHomework));
teacherRoutes.get('/homework/:id', validate({ params: idParam }), asyncHandler(teacherController.homeworkById));
teacherRoutes.delete('/homework/:id', validate({ params: idParam }), asyncHandler(teacherController.deleteHomework));

teacherRoutes.get('/assignments', asyncHandler(teacherController.getAssignments));
teacherRoutes.post('/assignments', validate({ body: assignmentSchema }), asyncHandler(teacherController.createAssignment));
teacherRoutes.patch('/assignments/:id/close', validate({ params: idParam }), asyncHandler(teacherController.closeAssignment));
teacherRoutes.patch(
  '/assignments/:id',
  validate({ params: idParam, body: assignmentPatchSchema }),
  asyncHandler(teacherController.updateAssignment),
);
teacherRoutes.delete('/assignments/:id', validate({ params: idParam }), asyncHandler(teacherController.deleteAssignment));
teacherRoutes.get('/assignments/:id/submissions', validate({ params: idParam }), asyncHandler(teacherController.getSubmissions));
teacherRoutes.patch(
  '/assignments/:id/submissions/:studentId/grade',
  validate({ params: gradeParams, body: gradeSchema }),
  asyncHandler(teacherController.gradeSubmission),
);
teacherRoutes.patch(
  '/assignments/:id/submissions/:studentId',
  validate({ params: gradeParams, body: receiveSubmissionSchema }),
  asyncHandler(teacherController.receiveSubmission),
);

teacherRoutes.get('/circulars/received', asyncHandler(teacherController.receivedCirculars));
teacherRoutes.get('/circulars/mine', asyncHandler(teacherController.myCirculars));
teacherRoutes.post('/circulars', validate({ body: circularSchema }), asyncHandler(teacherController.createCircular));
teacherRoutes.post('/circulars/:id/read', validate({ params: idParam }), asyncHandler(teacherController.readCircular));
teacherRoutes.patch('/circulars/:id', validate({ params: idParam, body: circularPatchSchema }), asyncHandler(teacherController.updateCircular));
teacherRoutes.delete('/circulars/:id', validate({ params: idParam }), asyncHandler(teacherController.deleteCircular));

teacherRoutes.get('/leave/balance', asyncHandler(teacherController.leaveBalance));
teacherRoutes.get('/leave/history', asyncHandler(teacherController.leaveHistory));
teacherRoutes.get('/leave/all-pending', asyncHandler(teacherController.getAllPendingLeaves));
teacherRoutes.post('/leave/apply', validate({ body: applyLeaveSchema }), asyncHandler(teacherController.applyLeave));
teacherRoutes.delete('/leave/:id/cancel', validate({ params: idParam }), asyncHandler(teacherController.cancelLeave));
teacherRoutes.patch(
  '/leave/:id/review',
  validate({ params: idParam, body: reviewTeacherLeaveSchema }),
  asyncHandler(teacherController.reviewLeave),
);

/** Mounted at /api/homework. Cross-role homework overview + role-gated edit. */
export const homeworkRoutes = Router();
homeworkRoutes.use(authenticate, requireRole('school_admin', 'principal', 'coordinator', 'support_engineer', 'teacher'));
homeworkRoutes.get('/', asyncHandler(teacherController.getAllHomework));
homeworkRoutes.get('/:id', validate({ params: idParam }), asyncHandler(teacherController.homeworkById));
homeworkRoutes.patch('/:id', validate({ params: idParam, body: homeworkPatchSchema }), asyncHandler(teacherController.updateHomework));
