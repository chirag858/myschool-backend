import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { teacherAppController } from './teacher-app.controller';

/**
 * Mounted at /api/teacher AFTER the web teacher router — these mobile-only
 * paths don't exist in the web router, so they fall through to here. (The
 * mobile "teaching cohorts" read lives at /teacher/teaching to avoid colliding
 * with the web's /teacher/assignments = graded assignments.)
 */
export const teacherAppRoutes = Router();
teacherAppRoutes.use(authenticate, requireRole('teacher', 'school_admin', 'principal'));

teacherAppRoutes.get('/teaching', asyncHandler(teacherAppController.teaching));
teacherAppRoutes.get('/roster', asyncHandler(teacherAppController.roster));
teacherAppRoutes.get('/dashboard', asyncHandler(teacherAppController.dashboard));

teacherAppRoutes.get('/assignment-mgmt', asyncHandler(teacherAppController.getAssignments));
teacherAppRoutes.post('/assignment-mgmt', asyncHandler(teacherAppController.createAssignment));
teacherAppRoutes.post('/assignment-mgmt/update', asyncHandler(teacherAppController.updateAssignment));
teacherAppRoutes.post('/assignment-mgmt/deactivate', asyncHandler(teacherAppController.deactivateAssignment));
teacherAppRoutes.get('/assignment-mgmt/submissions', asyncHandler(teacherAppController.submissions));
teacherAppRoutes.post('/assignment-mgmt/grade', asyncHandler(teacherAppController.grade));

teacherAppRoutes.get('/attendance', asyncHandler(teacherAppController.getAttendance));
teacherAppRoutes.post('/attendance/submit', asyncHandler(teacherAppController.submitAttendance));

teacherAppRoutes.get('/content', asyncHandler(teacherAppController.getContent));
teacherAppRoutes.post('/content', asyncHandler(teacherAppController.createContent));
teacherAppRoutes.post('/content/update', asyncHandler(teacherAppController.updateContent));
teacherAppRoutes.post('/content/deactivate', asyncHandler(teacherAppController.deactivateContent));

teacherAppRoutes.get('/assessments', asyncHandler(teacherAppController.getAssessments));
teacherAppRoutes.get('/marks', asyncHandler(teacherAppController.marksSheet));
teacherAppRoutes.post('/marks/save', asyncHandler(teacherAppController.saveMarks));

teacherAppRoutes.get('/performance', asyncHandler(teacherAppController.performance));
teacherAppRoutes.get('/performance/student', asyncHandler(teacherAppController.studentPerformance));
