import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const classKeysQuery = z.object({ classKeys: z.string().min(1) });

export const picnicPayloadSchema = z.object({
  title: z.string().min(1),
  destination: z.string().min(1),
  date: z.string().min(1),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  description: z.string().optional(),
  instructions: z.string().optional(),
  classKeys: z.array(z.string().min(1)).min(1, 'Select at least one class'),
  studentIds: z.array(z.string().min(1)).min(1, 'Select at least one student'),
  pricePerStudent: z.number().positive('Price per student must be greater than 0'),
});

export const decidePicnicSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    reason: z.string().optional(),
  })
  .refine((v) => v.status !== 'rejected' || Boolean(v.reason?.trim()), {
    message: 'A reason is required when rejecting a picnic',
    path: ['reason'],
  });
