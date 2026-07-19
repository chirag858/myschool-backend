import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { parentController } from './parent.controller';
import { childQuery, complaintSchema } from './parent.validation';

/** Mounted at /api/parent. Parent portal — each call is scoped to the parent's own children. */
export const parentRoutes = Router();
parentRoutes.use(authenticate, requireRole('parent'));

parentRoutes.get('/children', asyncHandler(parentController.getChildren));
parentRoutes.get('/fee-summary', validate({ query: childQuery }), asyncHandler(parentController.getFeeSummary));
parentRoutes.get('/fee-monthly', validate({ query: childQuery }), asyncHandler(parentController.getFeeMonthly));
parentRoutes.get('/attendance', validate({ query: childQuery }), asyncHandler(parentController.getAttendance));
parentRoutes.get('/circulars', asyncHandler(parentController.getCirculars));
parentRoutes.get('/complaints', validate({ query: childQuery }), asyncHandler(parentController.getComplaints));
parentRoutes.post('/complaints', validate({ body: complaintSchema }), asyncHandler(parentController.submitComplaint));
