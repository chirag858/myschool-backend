import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { studentAppController } from './student-app.controller';
import { markReadSchema, submitSchema } from './student-app.validation';

/** Mounted at /api/student. The logged-in student is the single subject. */
export const studentAppRoutes = Router();
studentAppRoutes.use(authenticate, requireRole('student'));

studentAppRoutes.get('/me', asyncHandler(studentAppController.me));
studentAppRoutes.get('/dashboard-summary', asyncHandler(studentAppController.summary));
studentAppRoutes.get('/id-card', asyncHandler(studentAppController.idCard));
studentAppRoutes.get('/library', asyncHandler(studentAppController.library));

studentAppRoutes.get('/notices', asyncHandler(studentAppController.notices));
studentAppRoutes.post('/notices/read', validate({ body: markReadSchema }), asyncHandler(studentAppController.markNoticeRead));
studentAppRoutes.post('/notices/read-all', asyncHandler(studentAppController.markAllNoticesRead));

studentAppRoutes.get('/assignments', asyncHandler(studentAppController.assignments));
studentAppRoutes.post('/assignments/submit', validate({ body: submitSchema }), asyncHandler(studentAppController.submit));
