import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { feeAdjustController } from './fee-adjust.controller';
import { idParam, readjustmentSchema, rejectSchema, remarksSchema, waiveOffSchema } from './fee-adjust.validation';

/** Mounted at /api/fee. Readjustments + waive-offs + composed reports. Finance roles. */
export const feeAdjustRoutes = Router();
feeAdjustRoutes.use(authenticate, requireRole('school_admin', 'accountant', 'principal'));

feeAdjustRoutes.get('/readjustments/history', asyncHandler(feeAdjustController.getReadjustmentHistory));
feeAdjustRoutes.post('/readjustments/:type', validate({ body: readjustmentSchema }), asyncHandler(feeAdjustController.createReadjustment));

feeAdjustRoutes.post('/waive-off/request', validate({ body: waiveOffSchema }), asyncHandler(feeAdjustController.requestWaiveOff));
feeAdjustRoutes.get('/waive-off/queue', asyncHandler(feeAdjustController.getWaiveOffQueue));
feeAdjustRoutes.get('/waive-off/history', asyncHandler(feeAdjustController.getWaiveOffHistory));
feeAdjustRoutes.patch('/waive-off/:id/approve', validate({ params: idParam, body: remarksSchema }), asyncHandler(feeAdjustController.approveWaiveOff));
feeAdjustRoutes.patch('/waive-off/:id/reject', validate({ params: idParam, body: rejectSchema }), asyncHandler(feeAdjustController.rejectWaiveOff));

feeAdjustRoutes.get('/reports/:type', asyncHandler(feeAdjustController.generateReport));
