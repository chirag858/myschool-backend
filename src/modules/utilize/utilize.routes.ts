import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { utilizeController } from './utilize.controller';
import { idParam, remarksSchema, rejectSchema, submitCorrectionSchema } from './utilize.validation';

/** Mounted at /api/utilize. The audit-safe correction & readjustment tool — super_admin, support_engineer, school_admin only. */
export const utilizeRoutes = Router();
utilizeRoutes.use(authenticate, requireRole('super_admin', 'support_engineer', 'school_admin'));

utilizeRoutes.get('/receipt/search', asyncHandler(utilizeController.searchReceipts));
utilizeRoutes.get('/duplicates', asyncHandler(utilizeController.getDuplicates));

utilizeRoutes.post('/corrections', validate({ body: submitCorrectionSchema }), asyncHandler(utilizeController.submitCorrection));
utilizeRoutes.get('/approval-queue', asyncHandler(utilizeController.getApprovalQueue));
utilizeRoutes.patch('/approval/:id/approve', validate({ params: idParam, body: remarksSchema }), asyncHandler(utilizeController.approveCorrection));
utilizeRoutes.patch('/approval/:id/reject', validate({ params: idParam, body: rejectSchema }), asyncHandler(utilizeController.rejectCorrection));

utilizeRoutes.get('/audit-log', asyncHandler(utilizeController.getAuditLog));
