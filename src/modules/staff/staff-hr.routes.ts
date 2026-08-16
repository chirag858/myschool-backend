import { Router } from 'express';

import { asyncHandler } from '../../lib/async-handler';
import { authenticate, requireRole } from '../../middleware/auth';
import { upload } from '../../middleware/upload';
import { validate } from '../../middleware/validate';
import { staffHrController } from './staff-hr.controller';
import {
  advanceReviewSchema,
  applyLeaveSchema,
  createAdvanceSchema,
  generateDocSchema,
  generatePayrollSchema,
  holdSchema,
  idParam,
  leaveIdParam,
  markPaidSchema,
  reviewLeaveSchema,
  reviseSalarySchema,
  saveSalaryStructureSchema,
  slipIdParam,
  submitExitSchema,
  uploadDocSchema,
} from './staff-hr.validation';

/** Extra /staff sub-routes (HR). Mounted at /api/staff after the core staff router. */
export const staffHrRoutes = Router();
staffHrRoutes.use(authenticate, requireRole('school_admin', 'principal'));

// Leave
staffHrRoutes.get('/notice-period/:employmentType', asyncHandler(staffHrController.noticePeriod));
staffHrRoutes.get('/:id/leave-balance', validate({ params: idParam }), asyncHandler(staffHrController.leaveBalance));
staffHrRoutes.get('/:id/leave-history', validate({ params: idParam }), asyncHandler(staffHrController.leaveHistory));
staffHrRoutes.post('/:id/leave-apply', validate({ params: idParam, body: applyLeaveSchema }), asyncHandler(staffHrController.applyLeave));
staffHrRoutes.patch('/:id/leave/:leaveId/review', validate({ params: leaveIdParam, body: reviewLeaveSchema }), asyncHandler(staffHrController.reviewLeave));

// Salary
staffHrRoutes.post('/:id/salary-revise', validate({ params: idParam, body: reviseSalarySchema }), asyncHandler(staffHrController.reviseSalary));
staffHrRoutes.put('/:id/salary-structure', validate({ params: idParam, body: saveSalaryStructureSchema }), asyncHandler(staffHrController.saveSalaryStructure));
staffHrRoutes.get('/:id/payroll-history', validate({ params: idParam }), asyncHandler(staffHrController.payrollHistory));

// Documents
staffHrRoutes.post('/documents/generate', validate({ body: generateDocSchema }), asyncHandler(staffHrController.generateDocument));
staffHrRoutes.get('/:id/documents', validate({ params: idParam }), asyncHandler(staffHrController.getDocuments));
staffHrRoutes.post(
  '/:id/documents',
  upload.single('document'),
  validate({ params: idParam, body: uploadDocSchema }),
  asyncHandler(staffHrController.uploadDocument),
);

// Activity + exit
staffHrRoutes.get('/:id/activity-log', validate({ params: idParam }), asyncHandler(staffHrController.activityLog));
staffHrRoutes.post('/:id/exit', validate({ params: idParam, body: submitExitSchema }), asyncHandler(staffHrController.submitExit));
staffHrRoutes.get('/:id/exit-record', validate({ params: idParam }), asyncHandler(staffHrController.exitRecord));

/** Payroll router. Mounted at /api/payroll. */
export const payrollRoutes = Router();
payrollRoutes.use(authenticate, requireRole('school_admin', 'principal', 'accountant'));

payrollRoutes.get('/stats', asyncHandler(staffHrController.payrollKpi));
payrollRoutes.get('/advance-requests', asyncHandler(staffHrController.advanceRequests));
payrollRoutes.post('/advance-requests', validate({ body: createAdvanceSchema }), asyncHandler(staffHrController.createAdvance));
payrollRoutes.patch('/advance-requests/:id/review', validate({ params: idParam, body: advanceReviewSchema }), asyncHandler(staffHrController.reviewAdvance));
payrollRoutes.get('/active-advances', asyncHandler(staffHrController.activeAdvances));
payrollRoutes.get('/', asyncHandler(staffHrController.getPayroll));
payrollRoutes.post('/generate', validate({ body: generatePayrollSchema }), asyncHandler(staffHrController.generatePayroll));
payrollRoutes.patch('/:slipId/mark-paid', validate({ params: slipIdParam, body: markPaidSchema }), asyncHandler(staffHrController.markPaid));
payrollRoutes.patch('/:slipId/hold', validate({ params: slipIdParam, body: holdSchema }), asyncHandler(staffHrController.putOnHold));
