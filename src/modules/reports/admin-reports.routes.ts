import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { adminReportsController } from './admin-reports.controller';
import { exportQuery, reportKeyParam } from './admin-reports.validation';

/** Mounted at /api/reports. School admin, principal, coordinator — scoped to their own school. */
export const adminReportsRoutes = Router();
adminReportsRoutes.use(authenticate, requireRole('school_admin', 'principal', 'coordinator'));

adminReportsRoutes.get('/:key', validate({ params: reportKeyParam }), asyncHandler(adminReportsController.getReport));
adminReportsRoutes.get(
  '/:key/export',
  validate({ params: reportKeyParam, query: exportQuery }),
  asyncHandler(adminReportsController.exportReport),
);
