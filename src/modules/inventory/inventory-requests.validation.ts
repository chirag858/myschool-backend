import { z } from 'zod';

export const idParam = z.object({ id: z.string().min(1) });

export const createRequestSchema = z.object({
  id: z.string().optional(),
  itemId: z.string().min(1),
  itemName: z.string().default(''),
  category: z.string().default(''),
  quantity: z.number().int().positive(),
  availableStock: z.number().default(0),
  unitPrice: z.number().default(0),
  purpose: z.string().min(1),
  department: z.string().default(''),
  requestedBy: z.string().default(''),
  requestedById: z.string().default(''),
  requestedOn: z.string().default(''),
  neededBy: z.string().optional(),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  status: z.string().optional(),
});

export const requestStatusAction = z.enum(['approve', 'reject', 'forward', 'cancel']);
export const setStatusSchema = z.object({
  approvedBy: z.string().optional(),
  rejectionReason: z.string().optional(),
});

export const requestsQuery = z.object({
  status: z.string().optional(),
  dept: z.string().optional(),
  mine: z.string().optional(),
});

export const recordMismatchSchema = z.array(
  z.object({
    countedAt: z.string().min(1),
    itemId: z.string().min(1),
    itemName: z.string().default(''),
    category: z.string().default(''),
    systemStock: z.number(),
    physicalCount: z.number(),
    difference: z.number(),
    countedBy: z.string().default(''),
    status: z.enum(['open', 'investigated', 'resolved']).default('open'),
    remarks: z.string().optional(),
  }),
).min(1);

export const mismatchStatusSchema = z.object({
  status: z.enum(['open', 'investigated', 'resolved']),
  remarks: z.string().optional(),
});
