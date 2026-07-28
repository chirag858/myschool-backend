import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { feeController } from './fee.controller';
import {
  cancelSchema,
  collectSchema,
  createHeadSchema,
  idParam,
  ledgerQuery,
  receiptsQuery,
  reorderSchema,
  saveStructureSchema,
  updateHeadSchema,
} from './fee.validation';

/**
 * Mounted at /api/fee. Accountant + school_admin, plus super_admin for the
 * cross-tenant Utilize (receipt correction) tool — receipts/:id lookups fall
 * back to an unscoped search when the caller has no schoolId (see
 * fee.controller's tenantScope()).
 */
export const feeRoutes = Router();
feeRoutes.use(authenticate, requireRole('school_admin', 'accountant', 'super_admin'));

// Fee heads
feeRoutes.get('/heads', asyncHandler(feeController.listHeads));
feeRoutes.post('/heads', validate({ body: createHeadSchema }), asyncHandler(feeController.createHead));
feeRoutes.patch('/heads/reorder', validate({ body: reorderSchema }), asyncHandler(feeController.reorderHeads));
feeRoutes.put('/heads/:id', validate({ params: idParam, body: updateHeadSchema }), asyncHandler(feeController.updateHead));
feeRoutes.delete('/heads/:id', validate({ params: idParam }), asyncHandler(feeController.removeHead));

// Structure
feeRoutes.get('/structure', asyncHandler(feeController.getStructure));
feeRoutes.post('/structure/save', validate({ body: saveStructureSchema }), asyncHandler(feeController.saveStructure));
feeRoutes.post('/structure/copy-from-session', asyncHandler(feeController.copyFromSession));

// Collection
feeRoutes.get('/pending/:studentId', asyncHandler(feeController.studentContext));
feeRoutes.post('/collect', validate({ body: collectSchema }), asyncHandler(feeController.collect));

// Receipts
feeRoutes.get('/receipts', validate({ query: receiptsQuery }), asyncHandler(feeController.listReceipts));
feeRoutes.get('/stats/today', asyncHandler(feeController.stats));
feeRoutes.get('/receipts/:id', validate({ params: idParam }), asyncHandler(feeController.getReceipt));
feeRoutes.post('/receipts/:id/duplicate', validate({ params: idParam }), asyncHandler(feeController.duplicateReceipt));
feeRoutes.patch('/receipts/:id/cancel', validate({ params: idParam, body: cancelSchema }), asyncHandler(feeController.cancelReceipt));

// Ledger
feeRoutes.get('/ledger', validate({ query: ledgerQuery }), asyncHandler(feeController.ledger));

// Student ledger — used by the student profile fee tab.
// Also allow 'principal' and 'coordinator' so they can view a student's fee history.
feeRoutes.get(
  '/student-ledger/:studentId',
  requireRole('school_admin', 'principal', 'coordinator', 'accountant'),
  asyncHandler(feeController.studentLedger),
);
