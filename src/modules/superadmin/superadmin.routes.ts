import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { superAdminController } from './superadmin.controller';
import { idParam, renewSchema } from './superadmin.validation';

/**
 * Mounted at /api/super-admin (second router alongside schoolRoutes). All
 * super_admin-only. Paths here are the sub-resources not covered by the core
 * school CRUD (subscriptions, infra, audit, tickets, impersonation).
 */
export const superAdminExtrasRoutes = Router();
superAdminExtrasRoutes.use(authenticate, requireRole('super_admin'));

superAdminExtrasRoutes.get('/dashboard/infrastructure', asyncHandler(superAdminController.infrastructure));
superAdminExtrasRoutes.get('/dashboard/revenue-chart', asyncHandler(superAdminController.revenueChart));

superAdminExtrasRoutes.get('/schools/:id/subscriptions', validate({ params: idParam }), asyncHandler(superAdminController.getSubscriptions));
superAdminExtrasRoutes.post('/schools/:id/subscriptions', validate({ params: idParam, body: renewSchema }), asyncHandler(superAdminController.renewSubscription));
superAdminExtrasRoutes.get('/schools/:id/users', validate({ params: idParam }), asyncHandler(superAdminController.getSchoolUsers));
superAdminExtrasRoutes.get('/schools/:id/audit-logs', validate({ params: idParam }), asyncHandler(superAdminController.getSchoolAuditLogs));
superAdminExtrasRoutes.get('/schools/:id/activity', validate({ params: idParam }), asyncHandler(superAdminController.getSchoolRecentActivity));
superAdminExtrasRoutes.post('/schools/:id/impersonate', validate({ params: idParam }), asyncHandler(superAdminController.impersonate));

superAdminExtrasRoutes.get('/audit-logs', asyncHandler(superAdminController.getAuditLogs));
superAdminExtrasRoutes.get('/tickets/stats', asyncHandler(superAdminController.ticketStats));
