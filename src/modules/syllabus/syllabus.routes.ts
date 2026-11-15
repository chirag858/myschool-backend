import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { upload } from '../../middleware/upload';
import { validate } from '../../middleware/validate';
import { syllabusController as C } from './syllabus.controller';
import { createSyllabusSchema, idParam, updateSyllabusSchema } from './syllabus.validation';

/**
 * Mounted at /api/syllabus. Staff surface: a teacher / school admin uploads a
 * syllabus file per class; parents read it through the parent-app routes
 * (child-class scoped). Role-gated only — not behind a tenant module switch.
 */
export const syllabusRoutes = Router();
const gate = [authenticate, requireRole('school_admin', 'principal', 'coordinator', 'teacher')];

syllabusRoutes.get('/', ...gate, asyncHandler(C.list));
syllabusRoutes.post('/', ...gate, validate({ body: createSyllabusSchema }), asyncHandler(C.create));
syllabusRoutes.post('/upload-file', ...gate, upload.single('file'), asyncHandler(C.uploadFile));
syllabusRoutes.patch('/:id', ...gate, validate({ params: idParam, body: updateSyllabusSchema }), asyncHandler(C.update));
syllabusRoutes.delete('/:id', ...gate, validate({ params: idParam }), asyncHandler(C.remove));
