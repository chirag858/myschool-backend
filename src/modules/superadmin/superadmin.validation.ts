import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const renewSchema = z
  .object({
    plan: z.enum(['monthly', 'quarterly', 'half_yearly', 'yearly']),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    graceDays: z.number(),
    paymentMethod: z.string().min(1),
    paymentReference: z.string(),
    amountPaid: z.number(),
    notes: z.string().optional(),
  })
  .passthrough();
