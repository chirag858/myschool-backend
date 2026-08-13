import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
export const idParam = z.object({ id: objectId });
export const leaveIdParam = z.object({ id: objectId, leaveId: objectId });
export const slipIdParam = z.object({ slipId: objectId });

export const applyLeaveSchema = z
  .object({
    type: z.string().min(1),
    fromDate: z.string().min(1),
    toDate: z.string().min(1),
    days: z.number(),
    reason: z.string().min(1),
    substituteTeacherName: z.string().optional(),
  })
  .passthrough();

export const reviewLeaveSchema = z.object({
  action: z.enum(['approve', 'reject']),
  remarks: z.string().optional(),
});

export const reviseSalarySchema = z.object({
  newBasic: z.number().positive(),
  reason: z.string().min(1),
});

const salaryAdjustment = z.object({
  id: z.string().optional(),
  type: z.string(),
  customLabel: z.string().optional(),
  amount: z.coerce.number().min(0),
  taxable: z.boolean().optional(),
  recurring: z.boolean().optional(),
});

export const saveSalaryStructureSchema = z
  .object({
    basic: z.coerce.number().min(0),
    paymentMode: z.enum(['cash', 'bank', 'cheque']).optional(),
    bankAccountNumber: z.string().optional(),
    bankName: z.string().optional(),
    branch: z.string().optional(),
    ifsc: z.string().optional(),
    allowances: z.array(salaryAdjustment).optional(),
    deductions: z.array(salaryAdjustment).optional(),
  })
  .passthrough();

export const uploadDocSchema = z
  .object({
    category: z.string().min(1),
    fileName: z.string().min(1),
    sizeBytes: z.number(),
  })
  .passthrough();

export const generateDocSchema = z
  .object({
    staffId: objectId,
    documentType: z.string().min(1),
  })
  .passthrough();

export const generatePayrollSchema = z.object({
  month: z.string().min(1),
  year: z.number(),
});

export const markPaidSchema = z
  .object({
    paymentDate: z.string().min(1),
    paymentMode: z.string().min(1),
    reference: z.string(),
  })
  .passthrough();

export const holdSchema = z.object({ reason: z.string().min(1) });

export const createAdvanceSchema = z
  .object({
    staffId: z.string().min(1),
    staffName: z.string().min(1),
    amountRequested: z.number().positive(),
    reason: z.string().min(1),
    repaymentMonths: z.number(),
    monthlyRecovery: z.number(),
  })
  .passthrough();

export const advanceReviewSchema = z.object({ action: z.enum(['approve', 'reject']) });

export const submitExitSchema = z
  .object({
    exitType: z.enum(['resignation', 'termination', 'retirement', 'contract_end']),
    lastWorkingDate: z.string().min(1),
    noticePeriodDays: z.coerce.number().min(0).optional(),
    reason: z.string().min(1),
    handoverNotes: z.string().optional(),
    settlementAmount: z.coerce.number().optional(),
    clearanceItems: z
      .array(z.object({ id: z.string(), label: z.string(), checked: z.boolean() }))
      .optional(),
    remarks: z.string().optional(),
  })
  .passthrough();
