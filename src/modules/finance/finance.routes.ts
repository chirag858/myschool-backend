import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { financeController } from './finance.controller';
import { depositSchema, incomeSchema, vendorPaymentSchema } from './finance.validation';

const gate = [authenticate, requireRole('school_admin', 'principal', 'accountant')];

// ── /api/bank ──
export const bankRoutes = Router();
bankRoutes.use(...gate);
bankRoutes.get('/accounts', asyncHandler(financeController.getBankAccounts));
bankRoutes.get('/deposits/stats', asyncHandler(financeController.depositStats));
bankRoutes.get('/deposits', asyncHandler(financeController.getDeposits));
bankRoutes.post('/deposits', validate({ body: depositSchema }), asyncHandler(financeController.recordDeposit));

// ── /api/expenses ──
export const expensesRoutes = Router();
expensesRoutes.use(...gate);
expensesRoutes.get('/income', asyncHandler(financeController.getIncome));
expensesRoutes.post('/income', validate({ body: incomeSchema }), asyncHandler(financeController.addIncome));
expensesRoutes.get('/vendor-payments', asyncHandler(financeController.getVendorPayments));
expensesRoutes.post('/vendor-payments', validate({ body: vendorPaymentSchema }), asyncHandler(financeController.recordVendorPayment));
expensesRoutes.get('/cash-book', asyncHandler(financeController.getCashBook));
expensesRoutes.get('/profit-loss', asyncHandler(financeController.getProfitLoss));
expensesRoutes.get('/stats', asyncHandler(financeController.getExpenseStats));
