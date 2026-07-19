import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const createSchema = z
  .object({
    studentId: z.string().min(1),
    studentName: z.string().min(1),
    className: z.string().min(1),
    amount: z.number().positive(),
    refundMode: z.enum(['cash', 'bank', 'online']),
    reference: z.string().optional(),
    reason: z.string().min(1),
  })
  .passthrough();

export const decideSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().optional(),
});
