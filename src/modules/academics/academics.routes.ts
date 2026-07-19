import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ACADEMIC_ADMIN_ROLES } from '../user/roles';
import { classController, holidayController, sessionController } from './academics.controller';
import {
  classIdParam,
  classSectionParams,
  closeSessionSchema,
  createClassSchema,
  createHolidaySchema,
  createSectionSchema,
  createSessionSchema,
  idParam,
  reorderSchema,
  updateClassSchema,
  updateHolidaySchema,
  updateSectionSchema,
} from './academics.validation';

const gate = [authenticate, requireRole(...ACADEMIC_ADMIN_ROLES)];

// ── /api/sessions ─────────────────────────────────────────────────
export const sessionRoutes = Router();
sessionRoutes.use(...gate);
sessionRoutes.get('/', asyncHandler(sessionController.list));
sessionRoutes.post('/', validate({ body: createSessionSchema }), asyncHandler(sessionController.create));
sessionRoutes.get('/:id/stats', validate({ params: idParam }), asyncHandler(sessionController.stats));
sessionRoutes.patch('/:id/activate', validate({ params: idParam }), asyncHandler(sessionController.activate));
sessionRoutes.patch(
  '/:id/close',
  validate({ params: idParam, body: closeSessionSchema }),
  asyncHandler(sessionController.close),
);
sessionRoutes.patch('/:id/archive', validate({ params: idParam }), asyncHandler(sessionController.archive));

// ── /api/classes ──────────────────────────────────────────────────
export const classRoutes = Router();
classRoutes.use(...gate);
classRoutes.get('/', asyncHandler(classController.list));
classRoutes.post('/', validate({ body: createClassSchema }), asyncHandler(classController.create));
classRoutes.patch('/reorder', validate({ body: reorderSchema }), asyncHandler(classController.reorder));
classRoutes.get('/:classId/sections', validate({ params: classIdParam }), asyncHandler(classController.listSections));
classRoutes.post(
  '/:classId/sections',
  validate({ params: classIdParam, body: createSectionSchema }),
  asyncHandler(classController.createSection),
);
classRoutes.put(
  '/:classId/sections/:sectionId',
  validate({ params: classSectionParams, body: updateSectionSchema }),
  asyncHandler(classController.updateSection),
);
classRoutes.delete(
  '/:classId/sections/:sectionId',
  validate({ params: classSectionParams }),
  asyncHandler(classController.deleteSection),
);
classRoutes.put('/:id', validate({ params: idParam, body: updateClassSchema }), asyncHandler(classController.update));
classRoutes.delete('/:id', validate({ params: idParam }), asyncHandler(classController.remove));

// ── /api/holidays ─────────────────────────────────────────────────
export const holidayRoutes = Router();
holidayRoutes.use(...gate);
holidayRoutes.get('/', asyncHandler(holidayController.list));
holidayRoutes.post('/', validate({ body: createHolidaySchema }), asyncHandler(holidayController.create));
holidayRoutes.post('/copy-from-session', asyncHandler(holidayController.copyFromSession));
holidayRoutes.get('/working-days-summary', asyncHandler(holidayController.workingDaysSummary));
holidayRoutes.put('/:id', validate({ params: idParam, body: updateHolidaySchema }), asyncHandler(holidayController.update));
holidayRoutes.delete('/:id', validate({ params: idParam }), asyncHandler(holidayController.remove));
