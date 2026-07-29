import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { adminAppController } from './admin-app.controller';
import { actSchema } from './admin-app.validation';

/** Mounted at /api/admin. Mobile management app — school_admin + principal. */
export const adminAppRoutes = Router();
adminAppRoutes.use(authenticate, requireRole('school_admin', 'principal'));

adminAppRoutes.get('/dashboard', asyncHandler(adminAppController.dashboard));
adminAppRoutes.get('/fee-summary', asyncHandler(adminAppController.feeSummary));
adminAppRoutes.get('/attendance-summary', asyncHandler(adminAppController.attendanceSummary));
adminAppRoutes.get('/reports', asyncHandler(adminAppController.reports));

adminAppRoutes.get('/approvals', asyncHandler(adminAppController.approvals));
adminAppRoutes.get('/approvals/detail', asyncHandler(adminAppController.approvalDetail));
adminAppRoutes.post('/approvals/act', validate({ body: actSchema }), asyncHandler(adminAppController.act));
