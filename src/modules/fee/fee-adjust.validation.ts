import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const readjustmentSchema = z
  .object({
    oldValue: z.string(),
    newValue: z.string(),
    difference: z.string(),
    reason: z.string().min(1),
  })
  .passthrough();

export const waiveOffSchema = z
  .object({
    studentId: z.string().min(1),
    studentName: z.string().min(1),
    className: z.string().min(1),
    type: z.enum(['full', 'partial', 'specific_head']),
    amount: z.number().nonnegative(),
    reasonCode: z.string().min(1),
    reason: z.string().min(1),
    selfApprove: z.boolean().optional(),
  })
  .passthrough();

export const remarksSchema = z.object({ remarks: z.string().optional() });
export const rejectSchema = z.object({ reason: z.string().min(1) });
