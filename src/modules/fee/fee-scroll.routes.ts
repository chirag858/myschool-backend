import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { feeScrollController } from './fee-scroll.controller';
import { closeDaySchema, openDaySchema, reopenDaySchema, scrollExpenseSchema } from './fee-scroll.validation';

export const feeScrollRoutes = Router();
feeScrollRoutes.use(authenticate, requireRole('school_admin', 'principal', 'accountant'));

feeScrollRoutes.get('/scroll', asyncHandler(feeScrollController.getScroll));
feeScrollRoutes.post('/scroll/open-day', validate({ body: openDaySchema }), asyncHandler(feeScrollController.openDay));
feeScrollRoutes.post('/scroll/close-day', validate({ body: closeDaySchema }), asyncHandler(feeScrollController.closeDay));
feeScrollRoutes.post(
  '/scroll/reopen',
  requireRole('school_admin', 'principal'),
  validate({ body: reopenDaySchema }),
  asyncHandler(feeScrollController.reopenDay),
);
feeScrollRoutes.post('/scroll/expense', validate({ body: scrollExpenseSchema }), asyncHandler(feeScrollController.addExpense));
feeScrollRoutes.get('/scroll/expenses', asyncHandler(feeScrollController.getAllExpenses));
feeScrollRoutes.get('/scroll/collectors', asyncHandler(feeScrollController.getCollectors));
feeScrollRoutes.get('/scroll/consolidated', asyncHandler(feeScrollController.getConsolidated));
feeScrollRoutes.get('/scroll/history', asyncHandler(feeScrollController.getHistory));
