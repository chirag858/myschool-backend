import { z } from 'zod';

export const childQuery = z.object({ childId: z.string().min(1) });

/** Path `:id` for a single receipt — a 24-char Mongo ObjectId. */
export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/) });

export const complaintSchema = z
  .object({
    childId: z.string().min(1),
    subject: z.string().min(1),
    category: z.string().min(1),
    description: z.string().min(1),
  })
  .passthrough();
