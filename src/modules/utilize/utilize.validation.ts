import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const submitCorrectionSchema = z.object({
  category: z.enum(['receipt', 'readjustment']),
  action: z.string().min(1),
  recordRef: z.string().min(1),
  /** The real Mongo _id of the record being corrected — recordRef is a human-readable label, this is what's actually mutated. */
  targetId: z.string().optional(),
  studentId: z.string().min(1),
  studentName: z.string().min(1),
  oldValue: z.record(z.string(), z.unknown()).nullable(),
  newValue: z.record(z.string(), z.unknown()).nullable(),
  reasonCode: z.string().min(1),
  reason: z.string().min(1),
  amount: z.number(),
});

export const remarksSchema = z.object({ remarks: z.string().optional() });
export const rejectSchema = z.object({ reason: z.string().min(1) });
export const exportQuery = z.object({ format: z.enum(['excel', 'pdf']) });
