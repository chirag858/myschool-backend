import { Router } from 'express';
import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { enquiryController } from './enquiry.controller';

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
enquiryRoutes.post('/', asyncHandler(enquiryController.create));
enquiryRoutes.patch('/:id/status', asyncHandler(enquiryController.updateStatus));
enquiryRoutes.patch('/:id/convert', asyncHandler(enquiryController.convert));
enquiryRoutes.delete('/:id', asyncHandler(enquiryController.delete));
