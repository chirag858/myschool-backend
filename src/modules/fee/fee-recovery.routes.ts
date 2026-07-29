import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { feeRecoveryController } from './fee-recovery.controller';
import {
  assignInstallmentSchema,
  createPlanSchema,
  createRuleSchema,
  defaultersQuery,
  idParam,
  sendReminderSchema,
  toggleRuleSchema,
  updatePlanSchema,
} from './fee-recovery.validation';

/** Mounted at /api/fee/recovery. */
export const feeRecoveryRoutes = Router();
feeRecoveryRoutes.use(authenticate, requireRole('school_admin', 'principal', 'accountant', 'super_admin'));

feeRecoveryRoutes.get('/dashboard', asyncHandler(feeRecoveryController.dashboard));

feeRecoveryRoutes.get('/installment-plans', asyncHandler(feeRecoveryController.listPlans));
feeRecoveryRoutes.post('/installment-plans', validate({ body: createPlanSchema }), asyncHandler(feeRecoveryController.createPlan));
feeRecoveryRoutes.patch(
  '/installment-plans/:id',
  validate({ params: idParam, body: updatePlanSchema }),
  asyncHandler(feeRecoveryController.updatePlan),
);

feeRecoveryRoutes.get('/student-installments', asyncHandler(feeRecoveryController.listStudentInstallments));
feeRecoveryRoutes.post(
  '/student-installments',
  validate({ body: assignInstallmentSchema }),
  asyncHandler(feeRecoveryController.assignInstallment),
);
feeRecoveryRoutes.delete(
  '/student-installments/:id',
  validate({ params: idParam }),
  asyncHandler(feeRecoveryController.removeStudentInstallment),
);

feeRecoveryRoutes.get('/reminder-rules', asyncHandler(feeRecoveryController.listRules));
feeRecoveryRoutes.post('/reminder-rules', validate({ body: createRuleSchema }), asyncHandler(feeRecoveryController.createRule));
feeRecoveryRoutes.patch(
  '/reminder-rules/:id',
  validate({ params: idParam, body: toggleRuleSchema }),
  asyncHandler(feeRecoveryController.toggleRule),
);
feeRecoveryRoutes.delete('/reminder-rules/:id', validate({ params: idParam }), asyncHandler(feeRecoveryController.deleteRule));
feeRecoveryRoutes.get('/reminder-log', asyncHandler(feeRecoveryController.getReminderLog));

feeRecoveryRoutes.get('/sibling-groups', asyncHandler(feeRecoveryController.listSiblingGroups));
feeRecoveryRoutes.post('/sibling-groups/scan', asyncHandler(feeRecoveryController.scanSiblings));
feeRecoveryRoutes.post(
  '/sibling-groups/bulk-apply',
  asyncHandler(feeRecoveryController.bulkApplySiblingDiscount),
);
feeRecoveryRoutes.post(
  '/sibling-groups/:id/apply',
  validate({ params: idParam }),
  asyncHandler(feeRecoveryController.applySiblingDiscount),
);

feeRecoveryRoutes.get('/defaulters', validate({ query: defaultersQuery }), asyncHandler(feeRecoveryController.getDefaulters));
feeRecoveryRoutes.post(
  '/defaulters/send-reminder',
  validate({ body: sendReminderSchema }),
  asyncHandler(feeRecoveryController.sendReminder),
);
