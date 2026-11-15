import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { upload } from '../../middleware/upload';
import { validate } from '../../middleware/validate';
import { eventsController as C } from './events.controller';
import { addPhotoSchema, createAlbumSchema, idParam, photoParams, updateAlbumSchema } from './events.validation';

/**
 * Mounted at /api/events. Staff surface for the Events photo gallery: a teacher
 * or school admin creates albums and uploads photos; parents read them through
 * the parent-app routes (child-class scoped). Role-gated only — NOT behind a
 * tenant module switch, because the client wants Events always available.
 */
export const eventsRoutes = Router();
const gate = [authenticate, requireRole('school_admin', 'principal', 'coordinator', 'teacher')];

eventsRoutes.get('/', ...gate, asyncHandler(C.list));
eventsRoutes.post('/', ...gate, validate({ body: createAlbumSchema }), asyncHandler(C.create));
eventsRoutes.post('/upload-photo', ...gate, upload.single('file'), asyncHandler(C.uploadPhoto));
eventsRoutes.get('/:id', ...gate, validate({ params: idParam }), asyncHandler(C.getById));
eventsRoutes.patch('/:id', ...gate, validate({ params: idParam, body: updateAlbumSchema }), asyncHandler(C.update));
eventsRoutes.delete('/:id', ...gate, validate({ params: idParam }), asyncHandler(C.remove));
eventsRoutes.post('/:id/photos', ...gate, validate({ params: idParam, body: addPhotoSchema }), asyncHandler(C.addPhoto));
eventsRoutes.delete('/:id/photos/:photoId', ...gate, validate({ params: photoParams }), asyncHandler(C.removePhoto));
