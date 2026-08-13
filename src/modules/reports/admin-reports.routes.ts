import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { adminReportsController } from './admin-reports.controller';
import { customReportSchema, exportQuery, reportKeyParam } from './admin-reports.validation';

/** Mounted at /api/reports. School admin, principal, coordinator — scoped to their own school. */
export const adminReportsRoutes = Router();
adminReportsRoutes.use(authenticate, requireRole('school_admin', 'principal', 'coordinator', 'accountant'));

// Fixed-shape /custom before /:key so the literal path wins over the param route.
adminReportsRoutes.post('/custom', validate({ body: customReportSchema }), asyncHandler(adminReportsController.runCustom));
adminReportsRoutes.post(
  '/custom/export',
  validate({ body: customReportSchema, query: exportQuery }),
  asyncHandler(adminReportsController.exportCustom),
);

adminReportsRoutes.get('/:key', validate({ params: reportKeyParam }), asyncHandler(adminReportsController.getReport));
adminReportsRoutes.get(
  '/:key/export',
  validate({ params: reportKeyParam, query: exportQuery }),
  asyncHandler(adminReportsController.exportReport),
);
