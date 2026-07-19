import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { feeRefundsController } from './fee-refunds.controller';
import { createSchema, decideSchema, idParam } from './fee-refunds.validation';

/** Mounted at /api/fee. Refund requests + approval workflow. Finance roles. */
export const feeRefundsRoutes = Router();
feeRefundsRoutes.use(authenticate, requireRole('school_admin', 'accountant', 'principal'));

feeRefundsRoutes.get('/refund-requests', asyncHandler(feeRefundsController.list));
feeRefundsRoutes.post('/refund-requests', validate({ body: createSchema }), asyncHandler(feeRefundsController.create));
feeRefundsRoutes.patch('/refund-requests/:id/decide', validate({ params: idParam, body: decideSchema }), asyncHandler(feeRefundsController.decide));
feeRefundsRoutes.delete('/refund-requests/:id', validate({ params: idParam }), asyncHandler(feeRefundsController.cancel));
