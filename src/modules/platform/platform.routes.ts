import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { platformController } from './platform.controller';
import { keyParam, toggleSchema } from './platform.validation';

/** Mounted at /api/super-admin. Platform-wide module/app toggles. */
export const platformRoutes = Router();
platformRoutes.use(authenticate, requireRole('super_admin'));

platformRoutes.get('/modules/overview', asyncHandler(platformController.modulesOverview));
platformRoutes.patch(
  '/modules/:key',
  validate({ params: keyParam, body: toggleSchema }),
  asyncHandler(platformController.setModule),
);
platformRoutes.get('/apps/overview', asyncHandler(platformController.appsOverview));
platformRoutes.patch(
  '/apps/:key',
  validate({ params: keyParam, body: toggleSchema }),
  asyncHandler(platformController.setApp),
);
