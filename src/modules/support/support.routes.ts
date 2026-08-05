import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { supportController } from './support.controller';
import {
  assignSchema,
  commentSchema,
  createTicketSchema,
  idParam,
  prioritySchema,
  statusSchema,
  ticketsQuerySchema,
} from './support.validation';

/**
 * Mounted at /api/support. Platform support desk. Any staff role can raise
 * and track tickets (matches SupportDashboardPage's allowedRoles) — the
 * technical roles (super_admin, support_engineer) are the ones who typically
 * resolve them, but status/assign controls aren't role-split in the UI, so
 * the API gate stays flat too.
 */
export const supportRoutes = Router();
supportRoutes.use(
  authenticate,
  requireRole(
    'super_admin',
    'support_engineer',
    'school_admin',
    'principal',
    'receptionist',
    'coordinator',
    'teacher',
    'accountant',
  ),
);

supportRoutes.get('/kpi', asyncHandler(supportController.getKpi));
supportRoutes.get('/tickets', validate({ query: ticketsQuerySchema }), asyncHandler(supportController.getTickets));
supportRoutes.post('/tickets', validate({ body: createTicketSchema }), asyncHandler(supportController.createTicket));
supportRoutes.get('/tickets/:id', validate({ params: idParam }), asyncHandler(supportController.getTicket));
supportRoutes.patch(
  '/tickets/:id/status',
  validate({ params: idParam, body: statusSchema }),
  asyncHandler(supportController.changeStatus),
);
supportRoutes.patch(
  '/tickets/:id/priority',
  validate({ params: idParam, body: prioritySchema }),
  asyncHandler(supportController.changePriority),
);
supportRoutes.patch(
  '/tickets/:id/assign',
  validate({ params: idParam, body: assignSchema }),
  asyncHandler(supportController.assignTicket),
);
supportRoutes.get('/tickets/:id/comments', validate({ params: idParam }), asyncHandler(supportController.getComments));
supportRoutes.post(
  '/tickets/:id/comments',
  validate({ params: idParam, body: commentSchema }),
  asyncHandler(supportController.addComment),
);
supportRoutes.get('/tickets/:id/activity', validate({ params: idParam }), asyncHandler(supportController.getActivity));
