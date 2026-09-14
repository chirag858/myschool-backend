import { z } from 'zod';

export const actSchema = z
  .object({
    id: z.string().min(1),
    action: z.enum(['endorse', 'authorize', 'reject']),
    reason: z.string().min(1),
    expectedLevel: z.number(),
  })
  .passthrough();
