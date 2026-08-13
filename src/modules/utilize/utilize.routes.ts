import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { utilizeController } from './utilize.controller';
import { exportQuery, idParam, remarksSchema, rejectSchema, submitCorrectionSchema } from './utilize.validation';

/**
 * Mounted at /api/utilize. The audit-safe correction & readjustment tool —
 * super_admin, support_engineer, school_admin can search/submit/view. Only
 * super_admin approves/rejects — school_admin and support_engineer submit
 * requests into the queue but are never the approver of their own (or
 * anyone else's) correction, per canApplyDirectly's "super_admin is the
 * approver" rule (utilize.service.ts).
 */
export const utilizeRoutes = Router();
utilizeRoutes.use(authenticate, requireRole('super_admin', 'support_engineer', 'school_admin'));
const approverOnly = requireRole('super_admin');

utilizeRoutes.get('/receipt/search', asyncHandler(utilizeController.searchReceipts));
utilizeRoutes.get('/students/search', asyncHandler(utilizeController.searchStudents));
utilizeRoutes.get('/duplicates', asyncHandler(utilizeController.getDuplicates));

utilizeRoutes.post('/corrections', validate({ body: submitCorrectionSchema }), asyncHandler(utilizeController.submitCorrection));
utilizeRoutes.get('/approval-queue', asyncHandler(utilizeController.getApprovalQueue));
utilizeRoutes.patch(
  '/approval/:id/approve',
  approverOnly,
  validate({ params: idParam, body: remarksSchema }),
  asyncHandler(utilizeController.approveCorrection),
);
utilizeRoutes.patch(
  '/approval/:id/reject',
  approverOnly,
  validate({ params: idParam, body: rejectSchema }),
  asyncHandler(utilizeController.rejectCorrection),
);

utilizeRoutes.get('/audit-log', asyncHandler(utilizeController.getAuditLog));
utilizeRoutes.get('/audit-log/export', validate({ query: exportQuery }), asyncHandler(utilizeController.exportAuditLog));
