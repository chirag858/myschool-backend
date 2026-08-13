import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { certificatesController } from './certificates.controller';
import { generateCertificateSchema, idParam } from './certificates.validation';

/** Mounted at /api/certificates. School admin, principal, coordinator. */
export const certificatesRoutes = Router();
certificatesRoutes.use(authenticate, requireRole('school_admin', 'principal', 'coordinator'));

certificatesRoutes.get('/history', asyncHandler(certificatesController.getHistory));
certificatesRoutes.get('/tc-number/generate', asyncHandler(certificatesController.generateTCNumber));
certificatesRoutes.post('/generate', validate({ body: generateCertificateSchema }), asyncHandler(certificatesController.generate));
certificatesRoutes.patch(
  '/students/:id/mark-tc-issued',
  validate({ params: idParam }),
  asyncHandler(certificatesController.markStudentTCIssued),
);
