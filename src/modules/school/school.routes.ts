import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { upload } from '../../middleware/upload';
import { validate } from '../../middleware/validate';
import { schoolController } from './school.controller';
import {
  codeCheckQuerySchema,
  createSchoolSchema,
  generateCodeQuerySchema,
  idParamSchema,
  modulesSchema,
  schoolsQuerySchema,
  statusSchema,
} from './school.validation';

/**
 * Mounted at /api/super-admin. Creation/deletion/status/module toggles stay
 * super_admin-only. The two plain listing reads (`/schools`, `/schools/list`)
 * are also opened to support_engineer — both the GPS Devices and School
 * Reports pages need a school picker for that role, which has no fixed
 * schoolId of its own (see transport-tracking/school-reports controllers).
 */
export const schoolRoutes = Router();

const readRoles = requireRole('super_admin', 'support_engineer');
const writeOnly = requireRole('super_admin');

schoolRoutes.use(authenticate);

schoolRoutes.get('/dashboard/stats', writeOnly, asyncHandler(schoolController.dashboardStats));

schoolRoutes.post(
  '/schools/upload-asset',
  writeOnly,
  upload.single('asset'),
  asyncHandler(schoolController.uploadAsset),
);

schoolRoutes.get(
  '/schools',
  readRoles,
  validate({ query: schoolsQuerySchema }),
  asyncHandler(schoolController.list),
);
schoolRoutes.get('/schools/list', readRoles, asyncHandler(schoolController.listLite));
schoolRoutes.get('/schools/activation-overview', writeOnly, asyncHandler(schoolController.activationOverview));
// Specific single-segment routes must precede the blanket '/schools/:id' below.
schoolRoutes.get(
  '/schools/generate-code',
  writeOnly,
  validate({ query: generateCodeQuerySchema }),
  asyncHandler(schoolController.generateCode),
);
schoolRoutes.get(
  '/schools/code-check',
  writeOnly,
  validate({ query: codeCheckQuerySchema }),
  asyncHandler(schoolController.checkCode),
);
schoolRoutes.post(
  '/schools',
  writeOnly,
  validate({ body: createSchoolSchema }),
  asyncHandler(schoolController.create),
);
schoolRoutes.get(
  '/schools/:id',
  writeOnly,
  validate({ params: idParamSchema }),
  asyncHandler(schoolController.detail),
);
schoolRoutes.patch(
  '/schools/:id/status',
  writeOnly,
  validate({ params: idParamSchema, body: statusSchema }),
  asyncHandler(schoolController.setStatus),
);
schoolRoutes.delete(
  '/schools/:id',
  writeOnly,
  validate({ params: idParamSchema }),
  asyncHandler(schoolController.remove),
);
schoolRoutes.get(
  '/schools/:id/modules',
  writeOnly,
  validate({ params: idParamSchema }),
  asyncHandler(schoolController.getModules),
);
schoolRoutes.put(
  '/schools/:id/modules',
  writeOnly,
  validate({ params: idParamSchema, body: modulesSchema }),
  asyncHandler(schoolController.setModules),
);
