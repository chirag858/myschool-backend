import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { picnicController } from './picnic.controller';
import { decidePicnicSchema, idParam, picnicPayloadSchema } from './picnic.validation';

/**
 * Mounted at /api/picnic. Coordinator builds + submits picnics from their
 * assigned classes; gate_manager reviews, decides, and generates passes.
 * school_admin/principal can see both sides, same convention as coordinator
 * and gate-manager routers.
 */
export const picnicRoutes = Router();
picnicRoutes.use(authenticate, requireRole('coordinator', 'gate_manager', 'school_admin', 'principal'));

const coordinatorOnly = requireRole('coordinator', 'school_admin', 'principal');
const gateManagerOnly = requireRole('gate_manager', 'school_admin', 'principal');

picnicRoutes.get('/classes', coordinatorOnly, asyncHandler(picnicController.getAssignedClasses));
picnicRoutes.get('/classes/students', coordinatorOnly, asyncHandler(picnicController.getStudentsForClasses));
picnicRoutes.get('/mine', coordinatorOnly, asyncHandler(picnicController.listMine));
picnicRoutes.post('/', coordinatorOnly, validate({ body: picnicPayloadSchema }), asyncHandler(picnicController.create));
picnicRoutes.patch('/:id', coordinatorOnly, validate({ params: idParam, body: picnicPayloadSchema }), asyncHandler(picnicController.update));
picnicRoutes.post('/:id/submit', coordinatorOnly, validate({ params: idParam }), asyncHandler(picnicController.submit));

picnicRoutes.get('/requests', gateManagerOnly, asyncHandler(picnicController.listRequests));
picnicRoutes.post('/:id/decide', gateManagerOnly, validate({ params: idParam, body: decidePicnicSchema }), asyncHandler(picnicController.decide));
picnicRoutes.post('/:id/generate-passes', gateManagerOnly, validate({ params: idParam }), asyncHandler(picnicController.generatePasses));

picnicRoutes.get('/:id', validate({ params: idParam }), asyncHandler(picnicController.getDetail));
picnicRoutes.get('/:id/passes', validate({ params: idParam }), asyncHandler(picnicController.listPasses));
