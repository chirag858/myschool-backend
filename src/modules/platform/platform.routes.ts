import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { platformController } from './platform.controller';
import {
  emailTemplatePatch,
  keyParam,
  settingsBody,
  settingsTypeParam,
  templateIdParam,
  toggleSchema,
} from './platform.validation';

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
platformRoutes.get('/roles/user-counts', asyncHandler(platformController.roleUserCounts));

platformRoutes.get(
  '/settings/:type',
  validate({ params: settingsTypeParam }),
  asyncHandler(platformController.getSetting),
);
platformRoutes.put(
  '/settings/:type',
  validate({ params: settingsTypeParam, body: settingsBody }),
  asyncHandler(platformController.saveSetting),
);

platformRoutes.get('/settings/whatsapp/templates', asyncHandler(platformController.getWhatsAppTemplates));
platformRoutes.post('/settings/whatsapp/templates', asyncHandler(platformController.addWhatsAppTemplate));
platformRoutes.delete(
  '/settings/whatsapp/templates/:id',
  validate({ params: templateIdParam }),
  asyncHandler(platformController.deleteWhatsAppTemplate),
);

platformRoutes.get('/settings/email/templates', asyncHandler(platformController.getEmailTemplates));
platformRoutes.patch(
  '/settings/email/templates/:id',
  validate({ params: templateIdParam, body: emailTemplatePatch }),
  asyncHandler(platformController.saveEmailTemplate),
);
