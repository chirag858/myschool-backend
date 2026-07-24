import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { reportsController } from './reports.controller';
import { exportQuery, reportKeyParam } from './reports.validation';

/** Mounted at /api/super-admin/reports. Platform-wide report data + export. */
export const reportsRoutes = Router();
reportsRoutes.use(authenticate, requireRole('super_admin'));

reportsRoutes.get('/:key', validate({ params: reportKeyParam }), asyncHandler(reportsController.getReport));
reportsRoutes.get(
  '/:key/export',
  validate({ params: reportKeyParam, query: exportQuery }),
  asyncHandler(reportsController.exportReport),
);
