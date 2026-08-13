import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { outpassController } from './outpass.controller';
import { addVisitorSchema, idParam, issueOutPassSchema } from './outpass.validation';

/** Mounted at /api/outpass. School admin, principal, coordinator, receptionist. */
export const outpassRoutes = Router();
outpassRoutes.use(authenticate, requireRole('school_admin', 'principal', 'coordinator', 'receptionist'));

outpassRoutes.get('/', asyncHandler(outpassController.list));
outpassRoutes.post('/', validate({ body: issueOutPassSchema }), asyncHandler(outpassController.issue));
outpassRoutes.patch('/:id/return', validate({ params: idParam }), asyncHandler(outpassController.recordReturn));
outpassRoutes.patch('/:id/cancel', validate({ params: idParam }), asyncHandler(outpassController.cancel));
outpassRoutes.post('/otp/send', asyncHandler(outpassController.sendOtp));

outpassRoutes.get('/visitors', asyncHandler(outpassController.listVisitors));
outpassRoutes.post('/visitors', validate({ body: addVisitorSchema }), asyncHandler(outpassController.addVisitor));
outpassRoutes.patch(
  '/visitors/:id/checkout',
  validate({ params: idParam }),
  asyncHandler(outpassController.checkoutVisitor),
);
