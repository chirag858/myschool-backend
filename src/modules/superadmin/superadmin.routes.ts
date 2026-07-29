import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { superAdminController } from './superadmin.controller';
import { billingRenewSchema, gracePeriodSchema, idParam, renewSchema } from './superadmin.validation';

/**
 * Mounted at /api/super-admin (second router alongside schoolRoutes). All
 * super_admin-only. Paths here are the sub-resources not covered by the core
 * school CRUD (subscriptions, infra, audit, tickets, impersonation).
 */
export const superAdminExtrasRoutes = Router();
superAdminExtrasRoutes.use(authenticate, requireRole('super_admin'));

superAdminExtrasRoutes.get('/dashboard/infrastructure', asyncHandler(superAdminController.infrastructure));
superAdminExtrasRoutes.get('/dashboard/revenue-chart', asyncHandler(superAdminController.revenueChart));

superAdminExtrasRoutes.get('/billing/overview', asyncHandler(superAdminController.billingOverview));
superAdminExtrasRoutes.post('/billing/renew', validate({ body: billingRenewSchema }), asyncHandler(superAdminController.billingRenew));
superAdminExtrasRoutes.patch('/billing/:id/grace-period', validate({ params: idParam, body: gracePeriodSchema }), asyncHandler(superAdminController.billingGracePeriod));

superAdminExtrasRoutes.get('/schools/:id/subscriptions', validate({ params: idParam }), asyncHandler(superAdminController.getSubscriptions));
superAdminExtrasRoutes.post('/schools/:id/subscriptions', validate({ params: idParam, body: renewSchema }), asyncHandler(superAdminController.renewSubscription));
superAdminExtrasRoutes.get('/schools/:id/users', validate({ params: idParam }), asyncHandler(superAdminController.getSchoolUsers));
superAdminExtrasRoutes.get('/schools/:id/audit-logs', validate({ params: idParam }), asyncHandler(superAdminController.getSchoolAuditLogs));
superAdminExtrasRoutes.get('/schools/:id/activity', validate({ params: idParam }), asyncHandler(superAdminController.getSchoolRecentActivity));
superAdminExtrasRoutes.post('/schools/:id/impersonate', validate({ params: idParam }), asyncHandler(superAdminController.impersonate));

superAdminExtrasRoutes.get('/audit-logs', asyncHandler(superAdminController.getAuditLogs));
superAdminExtrasRoutes.get('/audit-logs-full', asyncHandler(superAdminController.getFullAuditLogs));
superAdminExtrasRoutes.get('/audit-logs-full/:id', validate({ params: idParam }), asyncHandler(superAdminController.getAuditLogDetail));
superAdminExtrasRoutes.get('/tickets/stats', asyncHandler(superAdminController.ticketStats));
