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
// Reads: any authenticated tenant user (teacher, coordinator, accountant, ...)
// needs the real class/section/session list to drive its own pickers
// (e.g. teacher timetable resolving its assigned class to a real classId).
// Service layer still scopes every query to req.user.schoolId, so this is
// just "see your own school's academic structure", not privileged data.
// Writes stay admin-only via `gate`.
const readGate = [authenticate];

// ── /api/sessions ─────────────────────────────────────────────────
export const sessionRoutes = Router();
sessionRoutes.get('/', ...readGate, asyncHandler(sessionController.list));
sessionRoutes.post('/', ...gate, validate({ body: createSessionSchema }), asyncHandler(sessionController.create));
sessionRoutes.get('/:id/stats', ...gate, validate({ params: idParam }), asyncHandler(sessionController.stats));
sessionRoutes.patch('/:id/activate', ...gate, validate({ params: idParam }), asyncHandler(sessionController.activate));
sessionRoutes.patch(
  '/:id/close',
  ...gate,
  validate({ params: idParam, body: closeSessionSchema }),
  asyncHandler(sessionController.close),
);
sessionRoutes.patch('/:id/archive', ...gate, validate({ params: idParam }), asyncHandler(sessionController.archive));

// ── /api/classes ──────────────────────────────────────────────────
export const classRoutes = Router();
classRoutes.get('/', ...readGate, asyncHandler(classController.list));
classRoutes.post('/', ...gate, validate({ body: createClassSchema }), asyncHandler(classController.create));
classRoutes.patch('/reorder', ...gate, validate({ body: reorderSchema }), asyncHandler(classController.reorder));
classRoutes.get(
  '/:classId/sections',
  ...readGate,
  validate({ params: classIdParam }),
  asyncHandler(classController.listSections),
);
classRoutes.post(
  '/:classId/sections',
  ...gate,
  validate({ params: classIdParam, body: createSectionSchema }),
  asyncHandler(classController.createSection),
);
classRoutes.put(
  '/:classId/sections/:sectionId',
  ...gate,
  validate({ params: classSectionParams, body: updateSectionSchema }),
  asyncHandler(classController.updateSection),
);
classRoutes.delete(
  '/:classId/sections/:sectionId',
  ...gate,
  validate({ params: classSectionParams }),
  asyncHandler(classController.deleteSection),
);
classRoutes.put(
  '/:id',
  ...gate,
  validate({ params: idParam, body: updateClassSchema }),
  asyncHandler(classController.update),
);
classRoutes.delete('/:id', ...gate, validate({ params: idParam }), asyncHandler(classController.remove));

// ── /api/holidays ─────────────────────────────────────────────────
export const holidayRoutes = Router();
holidayRoutes.get('/', ...readGate, asyncHandler(holidayController.list));
holidayRoutes.post('/', ...gate, validate({ body: createHolidaySchema }), asyncHandler(holidayController.create));
holidayRoutes.post('/copy-from-session', ...gate, asyncHandler(holidayController.copyFromSession));
holidayRoutes.get('/working-days-summary', ...readGate, asyncHandler(holidayController.workingDaysSummary));
holidayRoutes.put(
  '/:id',
  ...gate,
  validate({ params: idParam, body: updateHolidaySchema }),
  asyncHandler(holidayController.update),
);
holidayRoutes.delete('/:id', ...gate, validate({ params: idParam }), asyncHandler(holidayController.remove));
