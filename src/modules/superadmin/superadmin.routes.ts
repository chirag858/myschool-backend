import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { superAdminController } from './superadmin.controller';
import { billingRenewSchema, gracePeriodSchema, idParam, renewSchema } from './superadmin.validation';

/**
 * Mounted at /api/super-admin (second router alongside schoolRoutes). Mostly
 * super_admin-only. Paths here are the sub-resources not covered by the core
 * school CRUD (subscriptions, infra, audit, tickets, impersonation).
 *
 * Impersonation is also opened to support_engineer, mirroring schoolRoutes'
 * readRoles split (see school.routes.ts) — support engineers need to sign in
 * as a school to reproduce/debug issues, same as super_admin.
 */
export const superAdminExtrasRoutes = Router();

const writeOnly = requireRole('super_admin');
const impersonateRoles = requireRole('super_admin', 'support_engineer');

superAdminExtrasRoutes.use(authenticate);

superAdminExtrasRoutes.get('/dashboard/infrastructure', writeOnly, asyncHandler(superAdminController.infrastructure));
superAdminExtrasRoutes.get('/dashboard/revenue-chart', writeOnly, asyncHandler(superAdminController.revenueChart));

superAdminExtrasRoutes.get('/billing/overview', writeOnly, asyncHandler(superAdminController.billingOverview));
superAdminExtrasRoutes.post('/billing/renew', writeOnly, validate({ body: billingRenewSchema }), asyncHandler(superAdminController.billingRenew));
superAdminExtrasRoutes.patch('/billing/:id/grace-period', writeOnly, validate({ params: idParam, body: gracePeriodSchema }), asyncHandler(superAdminController.billingGracePeriod));

superAdminExtrasRoutes.get('/schools/:id/subscriptions', writeOnly, validate({ params: idParam }), asyncHandler(superAdminController.getSubscriptions));
superAdminExtrasRoutes.post('/schools/:id/subscriptions', writeOnly, validate({ params: idParam, body: renewSchema }), asyncHandler(superAdminController.renewSubscription));
superAdminExtrasRoutes.get('/schools/:id/users', writeOnly, validate({ params: idParam }), asyncHandler(superAdminController.getSchoolUsers));
superAdminExtrasRoutes.get('/schools/:id/audit-logs', writeOnly, validate({ params: idParam }), asyncHandler(superAdminController.getSchoolAuditLogs));
superAdminExtrasRoutes.get('/schools/:id/activity', writeOnly, validate({ params: idParam }), asyncHandler(superAdminController.getSchoolRecentActivity));
superAdminExtrasRoutes.post('/schools/:id/impersonate', impersonateRoles, validate({ params: idParam }), asyncHandler(superAdminController.impersonate));

superAdminExtrasRoutes.get('/audit-logs', writeOnly, asyncHandler(superAdminController.getAuditLogs));
superAdminExtrasRoutes.get('/audit-logs-full', writeOnly, asyncHandler(superAdminController.getFullAuditLogs));
superAdminExtrasRoutes.get('/audit-logs-full/:id', writeOnly, validate({ params: idParam }), asyncHandler(superAdminController.getAuditLogDetail));
superAdminExtrasRoutes.get('/tickets/stats', writeOnly, asyncHandler(superAdminController.ticketStats));
