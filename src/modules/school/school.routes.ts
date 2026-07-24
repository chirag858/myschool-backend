import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { schoolController } from './school.controller';
import {
  createSchoolSchema,
  idParamSchema,
  modulesSchema,
  schoolsQuerySchema,
  statusSchema,
} from './school.validation';

/** Mounted at /api/super-admin. All routes are super_admin-only. */
export const schoolRoutes = Router();

schoolRoutes.use(authenticate, requireRole('super_admin'));

schoolRoutes.get('/dashboard/stats', asyncHandler(schoolController.dashboardStats));

schoolRoutes.get(
  '/schools',
  validate({ query: schoolsQuerySchema }),
  asyncHandler(schoolController.list),
);
schoolRoutes.get('/schools/list', asyncHandler(schoolController.listLite));
schoolRoutes.get('/schools/activation-overview', asyncHandler(schoolController.activationOverview));
schoolRoutes.post(
  '/schools',
  validate({ body: createSchoolSchema }),
  asyncHandler(schoolController.create),
);
schoolRoutes.get(
  '/schools/:id',
  validate({ params: idParamSchema }),
  asyncHandler(schoolController.detail),
);
schoolRoutes.patch(
  '/schools/:id/status',
  validate({ params: idParamSchema, body: statusSchema }),
  asyncHandler(schoolController.setStatus),
);
schoolRoutes.delete(
  '/schools/:id',
  validate({ params: idParamSchema }),
  asyncHandler(schoolController.remove),
);
schoolRoutes.get(
  '/schools/:id/modules',
  validate({ params: idParamSchema }),
  asyncHandler(schoolController.getModules),
);
schoolRoutes.put(
  '/schools/:id/modules',
  validate({ params: idParamSchema, body: modulesSchema }),
  asyncHandler(schoolController.setModules),
);
