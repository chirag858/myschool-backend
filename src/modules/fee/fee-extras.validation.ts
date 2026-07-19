import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const fineRuleSchema = z.object({ name: z.string().min(1) }).passthrough();
export const waiveSchema = z.object({ reason: z.string().min(1) });

export const concessionSchema = z.object({ name: z.string().min(1) }).passthrough();

export const applyConcessionSchema = z
  .object({
    concessionId: z.string().min(1),
    studentId: z.string().min(1),
    studentName: z.string().optional(),
    className: z.string().optional(),
    effectiveFrom: z.string().optional(),
    value: z.number().optional(),
  })
  .passthrough();

export const revokeSchema = z.object({ reason: z.string().optional() });
export const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  remarks: z.string().optional(),
});
