import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { messagingController } from './messaging.controller';
import { idParam, sendMessageSchema, upsertTemplateSchema } from './messaging.validation';

/** Mounted at /api/messaging. */
export const messagingRoutes = Router();
messagingRoutes.use(authenticate, requireRole('school_admin', 'principal', 'coordinator'));

messagingRoutes.get('/history', asyncHandler(messagingController.getMessages));
messagingRoutes.post('/send', validate({ body: sendMessageSchema }), asyncHandler(messagingController.sendMessage));
messagingRoutes.get('/:id/delivery-report', validate({ params: idParam }), asyncHandler(messagingController.getDeliveryReport));
messagingRoutes.post('/:id/resend-failed', validate({ params: idParam }), asyncHandler(messagingController.resendFailed));

messagingRoutes.get('/templates', asyncHandler(messagingController.getTemplates));
messagingRoutes.post('/templates', validate({ body: upsertTemplateSchema }), asyncHandler(messagingController.upsertTemplate));
messagingRoutes.delete('/templates/:id', validate({ params: idParam }), asyncHandler(messagingController.deleteTemplate));
