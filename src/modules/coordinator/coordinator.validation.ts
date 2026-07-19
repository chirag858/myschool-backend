import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const applyLeaveSchema = z
  .object({
    studentName: z.string().min(1),
    fromDate: z.string().min(1),
    toDate: z.string().min(1),
  })
  .passthrough();

export const remarksSchema = z.object({ remarks: z.string().optional() });
export const reasonSchema = z.object({ reason: z.string().min(1) });
