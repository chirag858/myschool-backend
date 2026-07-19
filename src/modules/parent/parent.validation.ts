import { z } from 'zod';

export const childQuery = z.object({ childId: z.string().min(1) });

export const complaintSchema = z
  .object({
    childId: z.string().min(1),
    subject: z.string().min(1),
    category: z.string().min(1),
    description: z.string().min(1),
  })
  .passthrough();
