import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { inventoryRequestsController } from './inventory-requests.controller';
import {
  createRequestSchema,
  idParam,
  mismatchStatusSchema,
  recordMismatchSchema,
  requestsQuery,
  setStatusSchema,
} from './inventory-requests.validation';

/** Mounted at /api/inventory. Broader role set than the core module — any
 * staff can raise a request or be issued items ("my items"). */
export const inventoryRequestsRoutes = Router();
inventoryRequestsRoutes.use(
  authenticate,
  requireRole('school_admin', 'principal', 'coordinator', 'teacher', 'accountant', 'receptionist', 'gate_manager'),
);

inventoryRequestsRoutes.get('/requests', validate({ query: requestsQuery }), asyncHandler(inventoryRequestsController.listRequests));
inventoryRequestsRoutes.post('/requests', validate({ body: createRequestSchema }), asyncHandler(inventoryRequestsController.createRequest));
inventoryRequestsRoutes.patch(
  '/requests/:id/approve',
  validate({ params: idParam, body: setStatusSchema }),
  asyncHandler(inventoryRequestsController.approve),
);
inventoryRequestsRoutes.patch(
  '/requests/:id/reject',
  validate({ params: idParam, body: setStatusSchema }),
  asyncHandler(inventoryRequestsController.reject),
);
inventoryRequestsRoutes.patch(
  '/requests/:id/forward',
  validate({ params: idParam, body: setStatusSchema }),
  asyncHandler(inventoryRequestsController.forward),
);
inventoryRequestsRoutes.patch(
  '/requests/:id/cancel',
  validate({ params: idParam, body: setStatusSchema }),
  asyncHandler(inventoryRequestsController.cancel),
);

inventoryRequestsRoutes.get('/stock-mismatches', asyncHandler(inventoryRequestsController.listMismatches));
inventoryRequestsRoutes.post('/stock-count', validate({ body: recordMismatchSchema }), asyncHandler(inventoryRequestsController.recordMismatch));
inventoryRequestsRoutes.patch(
  '/stock-mismatches/:id/status',
  validate({ params: idParam, body: mismatchStatusSchema }),
  asyncHandler(inventoryRequestsController.updateMismatchStatus),
);

inventoryRequestsRoutes.get('/department-stock', asyncHandler(inventoryRequestsController.getDeptStock));
inventoryRequestsRoutes.get('/my-items', asyncHandler(inventoryRequestsController.getMyItems));
