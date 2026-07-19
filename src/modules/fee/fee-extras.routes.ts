import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { feeExtrasController } from './fee-extras.controller';
import {
  applyConcessionSchema,
  concessionSchema,
  fineRuleSchema,
  idParam,
  reviewSchema,
  revokeSchema,
  waiveSchema,
} from './fee-extras.validation';

/** Second router mounted at /api/fee — fines + concessions. Accountant + school_admin. */
export const feeExtrasRoutes = Router();
feeExtrasRoutes.use(authenticate, requireRole('school_admin', 'accountant'));

// Fine rules
feeExtrasRoutes.get('/fine-rules', asyncHandler(feeExtrasController.listFineRules));
feeExtrasRoutes.post('/fine-rules', validate({ body: fineRuleSchema }), asyncHandler(feeExtrasController.createFineRule));
feeExtrasRoutes.put('/fine-rules/:id', validate({ params: idParam }), asyncHandler(feeExtrasController.updateFineRule));
feeExtrasRoutes.delete('/fine-rules/:id', validate({ params: idParam }), asyncHandler(feeExtrasController.deleteFineRule));

// Applied fines
feeExtrasRoutes.get('/applied-fines', asyncHandler(feeExtrasController.listAppliedFines));
feeExtrasRoutes.patch('/applied-fines/:id/waive', validate({ params: idParam, body: waiveSchema }), asyncHandler(feeExtrasController.waiveFine));

// Concessions — literal sub-paths before /:id
feeExtrasRoutes.get('/concessions', asyncHandler(feeExtrasController.listConcessions));
feeExtrasRoutes.post('/concessions', validate({ body: concessionSchema }), asyncHandler(feeExtrasController.createConcession));
feeExtrasRoutes.get('/concessions/applied', asyncHandler(feeExtrasController.listAppliedConcessions));
feeExtrasRoutes.post('/concessions/applied', validate({ body: applyConcessionSchema }), asyncHandler(feeExtrasController.applyConcession));
feeExtrasRoutes.patch('/concessions/applied/:id/revoke', validate({ params: idParam, body: revokeSchema }), asyncHandler(feeExtrasController.revokeAppliedConcession));
feeExtrasRoutes.get('/concessions/approvals/queue', asyncHandler(feeExtrasController.listApprovals));
feeExtrasRoutes.patch('/concessions/approvals/:id', validate({ params: idParam, body: reviewSchema }), asyncHandler(feeExtrasController.reviewApproval));
feeExtrasRoutes.put('/concessions/:id', validate({ params: idParam }), asyncHandler(feeExtrasController.updateConcession));
feeExtrasRoutes.delete('/concessions/:id', validate({ params: idParam }), asyncHandler(feeExtrasController.deleteConcession));
