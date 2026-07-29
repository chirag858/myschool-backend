import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { enquiryController } from './enquiry.controller';
import { createEnquirySchema, idParam, updateStatusSchema } from './enquiry.validation';

/**
 * Mounted at /api/enquiries.
 * Accessible to school_admin, principal, coordinator, and receptionist —
 * matching the ProtectedRoute roles on the admissions page.
 */
export const enquiryRoutes = Router();
enquiryRoutes.use(
  authenticate,
  requireRole('school_admin', 'principal', 'coordinator', 'receptionist'),
);

enquiryRoutes.get('/', asyncHandler(enquiryController.list));
enquiryRoutes.post('/', validate({ body: createEnquirySchema }), asyncHandler(enquiryController.create));
enquiryRoutes.patch('/:id/status', validate({ params: idParam, body: updateStatusSchema }), asyncHandler(enquiryController.updateStatus));
enquiryRoutes.patch('/:id/convert', validate({ params: idParam }), asyncHandler(enquiryController.convert));
enquiryRoutes.delete('/:id', validate({ params: idParam }), asyncHandler(enquiryController.delete));
