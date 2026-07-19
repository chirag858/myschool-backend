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

/** Mounted at /api/inventory. School admin + principal. (requests/mismatch/dept-stock deferred.) */
export const inventoryRoutes = Router();
inventoryRoutes.use(authenticate, requireRole('school_admin', 'principal'));

inventoryRoutes.get('/dashboard', asyncHandler(inventoryController.kpi));

inventoryRoutes.get('/items', asyncHandler(inventoryController.getItems));
inventoryRoutes.post('/items', validate({ body: upsertItemSchema }), asyncHandler(inventoryController.upsertItem));
inventoryRoutes.get('/items/:id/movements', validate({ params: idParam }), asyncHandler(inventoryController.getMovements));
inventoryRoutes.get('/items/:id', validate({ params: idParam }), asyncHandler(inventoryController.getItem));

inventoryRoutes.get('/purchase', asyncHandler(inventoryController.getPurchases));
inventoryRoutes.post('/purchase', validate({ body: purchaseSchema }), asyncHandler(inventoryController.addPurchase));

inventoryRoutes.get('/issue', asyncHandler(inventoryController.getIssues));
inventoryRoutes.post('/issue', validate({ body: issueSchema }), asyncHandler(inventoryController.addIssue));

inventoryRoutes.get('/vendors', asyncHandler(inventoryController.getVendors));
inventoryRoutes.post('/vendors', validate({ body: upsertVendorSchema }), asyncHandler(inventoryController.upsertVendor));

inventoryRoutes.get('/assets', asyncHandler(inventoryController.getAssets));
inventoryRoutes.post('/assets', validate({ body: upsertAssetSchema }), asyncHandler(inventoryController.upsertAsset));
