import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { inventoryController } from './inventory.controller';
import {
  idParam,
  issueSchema,
  purchaseSchema,
  upsertAssetSchema,
  upsertItemSchema,
  upsertVendorSchema,
} from './inventory.validation';

/**
 * Mounted at /api/inventory. School admin + principal by default (`adminGate`).
 * `/vendors` (GET) also allows accountant — Accounts > Vendor Payments reuses
 * the inventory vendor master to populate its "Vendor" picker.
 */
export const inventoryRoutes = Router();
inventoryRoutes.use(authenticate);
const adminGate = requireRole('school_admin', 'principal');

inventoryRoutes.get('/dashboard', adminGate, asyncHandler(inventoryController.kpi));

inventoryRoutes.get('/items', adminGate, asyncHandler(inventoryController.getItems));
inventoryRoutes.post('/items', adminGate, validate({ body: upsertItemSchema }), asyncHandler(inventoryController.upsertItem));
inventoryRoutes.get('/items/:id/movements', adminGate, validate({ params: idParam }), asyncHandler(inventoryController.getMovements));
inventoryRoutes.get('/items/:id', adminGate, validate({ params: idParam }), asyncHandler(inventoryController.getItem));

inventoryRoutes.get('/purchase', adminGate, asyncHandler(inventoryController.getPurchases));
inventoryRoutes.post('/purchase', adminGate, validate({ body: purchaseSchema }), asyncHandler(inventoryController.addPurchase));

inventoryRoutes.get('/issue', adminGate, asyncHandler(inventoryController.getIssues));
inventoryRoutes.post('/issue', adminGate, validate({ body: issueSchema }), asyncHandler(inventoryController.addIssue));

inventoryRoutes.get('/vendors', requireRole('school_admin', 'principal', 'accountant'), asyncHandler(inventoryController.getVendors));
inventoryRoutes.post('/vendors', adminGate, validate({ body: upsertVendorSchema }), asyncHandler(inventoryController.upsertVendor));

inventoryRoutes.get('/assets', adminGate, asyncHandler(inventoryController.getAssets));
inventoryRoutes.post('/assets', adminGate, validate({ body: upsertAssetSchema }), asyncHandler(inventoryController.upsertAsset));
