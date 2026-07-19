import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ACADEMIC_ADMIN_ROLES } from '../user/roles';
import { examController } from './exams.controller';
import {
  classKeyBody,
  createExamSchema,
  idParam,
  marksQuery,
  resultsQuery,
  saveMarksSchema,
} from './exams.validation';

/** Mounted at /api/exams. Academic admins + teachers (marks entry). */
export const examRoutes = Router();
examRoutes.use(authenticate, requireRole(...ACADEMIC_ADMIN_ROLES, 'teacher'));

examRoutes.get('/kpi', asyncHandler(examController.kpi));
examRoutes.get('/upcoming', asyncHandler(examController.upcoming));
examRoutes.get('/', asyncHandler(examController.list));
examRoutes.post('/', validate({ body: createExamSchema }), asyncHandler(examController.create));
examRoutes.get('/:id', validate({ params: idParam }), asyncHandler(examController.get));
examRoutes.patch('/:id/publish', validate({ params: idParam }), asyncHandler(examController.publish));
examRoutes.patch('/:id/unpublish', validate({ params: idParam }), asyncHandler(examController.unpublish));
examRoutes.delete('/:id', validate({ params: idParam }), asyncHandler(examController.remove));

examRoutes.get('/:id/marks', validate({ params: idParam, query: marksQuery }), asyncHandler(examController.getMarks));
examRoutes.post('/:id/marks/save-draft', validate({ params: idParam, body: saveMarksSchema }), asyncHandler(examController.saveDraft));
examRoutes.post('/:id/marks/submit', validate({ params: idParam, body: saveMarksSchema }), asyncHandler(examController.submit));

examRoutes.post('/:id/results/calculate', validate({ params: idParam, body: classKeyBody }), asyncHandler(examController.calculate));
examRoutes.get('/:id/results', validate({ params: idParam, query: resultsQuery }), asyncHandler(examController.results));
examRoutes.patch('/:id/results/publish', validate({ params: idParam, body: classKeyBody }), asyncHandler(examController.publishResults));
examRoutes.patch('/:id/results/unpublish', validate({ params: idParam, body: classKeyBody }), asyncHandler(examController.unpublishResults));
