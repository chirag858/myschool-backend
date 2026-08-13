import { Router } from 'express';
import { z } from 'zod';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ACADEMIC_ADMIN_ROLES } from '../user/roles';
import { examsProgressController } from './exams-progress.controller';
import { idParam } from './exams.validation';

const subjectStatusQuery = z.object({ classKey: z.string().min(1) });

/** Mounted at /api/exams. */
export const examsProgressRoutes = Router();
examsProgressRoutes.use(authenticate, requireRole(...ACADEMIC_ADMIN_ROLES, 'teacher'));

examsProgressRoutes.get('/:id/progress', validate({ params: idParam }), asyncHandler(examsProgressController.getClassMarksProgress));
examsProgressRoutes.get(
  '/:id/marks-status',
  validate({ params: idParam, query: subjectStatusQuery }),
  asyncHandler(examsProgressController.getSubjectMarksStatus),
);
examsProgressRoutes.get('/:id/audit', validate({ params: idParam }), asyncHandler(examsProgressController.getAuditLog));
