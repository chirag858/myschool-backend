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
 * Mounted at /api/fee. Accountant + school_admin + principal (every fee
 * screen's ProtectedRoute on the frontend allows principal — this list must
 * match, or principal silently gets 403'd and the page just renders empty),
 * plus super_admin for the cross-tenant Utilize (receipt correction) tool —
 * receipts/:id lookups fall back to an unscoped search when the caller has
 * no schoolId (see fee.controller's tenantScope()).
 */
export const feeRoutes = Router();
feeRoutes.use(authenticate);
const staffOnly = requireRole('school_admin', 'principal', 'accountant', 'super_admin');

// Fee heads
feeRoutes.get('/heads', staffOnly, asyncHandler(feeController.listHeads));
feeRoutes.post('/heads', staffOnly, validate({ body: createHeadSchema }), asyncHandler(feeController.createHead));
feeRoutes.patch('/heads/reorder', staffOnly, validate({ body: reorderSchema }), asyncHandler(feeController.reorderHeads));
feeRoutes.put('/heads/:id', staffOnly, validate({ params: idParam, body: updateHeadSchema }), asyncHandler(feeController.updateHead));
feeRoutes.delete('/heads/:id', staffOnly, validate({ params: idParam }), asyncHandler(feeController.removeHead));

// Structure
feeRoutes.get('/structure', staffOnly, asyncHandler(feeController.getStructure));
feeRoutes.post('/structure/save', staffOnly, validate({ body: saveStructureSchema }), asyncHandler(feeController.saveStructure));
feeRoutes.post('/structure/copy-from-session', staffOnly, asyncHandler(feeController.copyFromSession));

// Collection
feeRoutes.get('/pending/:studentId', staffOnly, asyncHandler(feeController.studentContext));
feeRoutes.post('/collect', staffOnly, validate({ body: collectSchema }), asyncHandler(feeController.collect));

// Receipts
feeRoutes.get('/receipts', staffOnly, validate({ query: receiptsQuery }), asyncHandler(feeController.listReceipts));
feeRoutes.get('/stats/today', staffOnly, asyncHandler(feeController.stats));
feeRoutes.get('/accountant/dashboard', staffOnly, asyncHandler(feeController.accountantDashboard));
feeRoutes.get('/receipts/:id', staffOnly, validate({ params: idParam }), asyncHandler(feeController.getReceipt));
feeRoutes.post('/receipts/:id/duplicate', staffOnly, validate({ params: idParam }), asyncHandler(feeController.duplicateReceipt));
feeRoutes.patch('/receipts/:id/cancel', staffOnly, validate({ params: idParam, body: cancelSchema }), asyncHandler(feeController.cancelReceipt));

// Ledger
feeRoutes.get('/ledger', staffOnly, validate({ query: ledgerQuery }), asyncHandler(feeController.ledger));

// Student ledger — used by the student profile fee tab. Broader access:
// principal/coordinator can view a student's fee history too; receptionist
// gets read-only access from the Student Search profile view.
feeRoutes.get(
  '/student-ledger/:studentId',
  requireRole('school_admin', 'principal', 'coordinator', 'accountant', 'receptionist'),
  asyncHandler(feeController.studentLedger),
);
