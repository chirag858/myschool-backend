import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { communicationController } from './communication.controller';
import {
  idParam,
  preferencesSchema,
  upsertAnnouncementSchema,
  upsertCircularSchema,
} from './communication.validation';

const gate = [authenticate, requireRole('school_admin', 'principal', 'coordinator')];

// ── /api/communication ──
export const communicationRoutes = Router();
communicationRoutes.use(...gate);
communicationRoutes.get('/kpi', asyncHandler(communicationController.kpi));

// ── /api/circulars ──
export const circularRoutes = Router();
circularRoutes.use(...gate);
circularRoutes.get('/', asyncHandler(communicationController.getCirculars));
circularRoutes.post('/', validate({ body: upsertCircularSchema }), asyncHandler(communicationController.upsertCircular));
circularRoutes.patch('/:id/publish', validate({ params: idParam }), asyncHandler(communicationController.publishCircular));
circularRoutes.patch('/:id/archive', validate({ params: idParam }), asyncHandler(communicationController.archiveCircular));
circularRoutes.delete('/:id', validate({ params: idParam }), asyncHandler(communicationController.deleteCircular));

// ── /api/announcements ──
export const announcementRoutes = Router();
announcementRoutes.use(...gate);
announcementRoutes.get('/', asyncHandler(communicationController.getAnnouncements));
announcementRoutes.post('/', validate({ body: upsertAnnouncementSchema }), asyncHandler(communicationController.upsertAnnouncement));
announcementRoutes.delete('/:id', validate({ params: idParam }), asyncHandler(communicationController.deleteAnnouncement));

// ── /api/notifications ──
export const notificationRoutes = Router();
notificationRoutes.use(...gate);
notificationRoutes.get('/', asyncHandler(communicationController.getNotifications));
notificationRoutes.patch('/mark-all-read', asyncHandler(communicationController.markAllRead));
notificationRoutes.delete('/read', asyncHandler(communicationController.clearRead));
notificationRoutes.get('/preferences', asyncHandler(communicationController.getPreferences));
notificationRoutes.put('/preferences', validate({ body: preferencesSchema }), asyncHandler(communicationController.savePreferences));
notificationRoutes.patch('/:id/read', validate({ params: idParam }), asyncHandler(communicationController.markRead));
