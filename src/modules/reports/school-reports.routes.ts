import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { schoolReportsController } from './school-reports.controller';
import { exportQuery, schoolReportParams } from './school-reports.validation';

/** Mounted at /api/super-admin/school-reports. Per-school report data + export. */
export const schoolReportsRoutes = Router();
schoolReportsRoutes.use(authenticate, requireRole('super_admin'));

schoolReportsRoutes.get(
  '/:schoolId/:key',
  validate({ params: schoolReportParams }),
  asyncHandler(schoolReportsController.getReport),
);
schoolReportsRoutes.get(
  '/:schoolId/:key/export',
  validate({ params: schoolReportParams, query: exportQuery }),
  asyncHandler(schoolReportsController.exportReport),
);
