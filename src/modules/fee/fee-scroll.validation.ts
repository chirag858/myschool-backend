import { z } from 'zod';

export const openDaySchema = z.object({
  date: z.string().min(1),
  openingBalance: z.coerce.number(),
  reason: z.string().optional(),
});

const denominationLineSchema = z.object({
  value: z.number().nonnegative(),
  kind: z.enum(['note', 'coin']),
  count: z.number().int().nonnegative(),
});

export const closeDaySchema = z.object({
  date: z.string().min(1),
  denominations: z.array(denominationLineSchema),
  countedCash: z.coerce.number().nonnegative(),
  variance: z.coerce.number(),
  varianceReason: z.string().optional(),
  deposit: z.object({ amount: z.number().nonnegative(), bankName: z.string(), slipNo: z.string() }).optional(),
  handover: z.object({ to: z.string(), amount: z.number().nonnegative() }).optional(),
  retained: z.coerce.number().nonnegative(),
});

export const reopenDaySchema = z.object({
  collectorId: z.string().min(1),
  date: z.string().min(1),
  reason: z.string().min(1),
});

export const scrollExpenseSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(1),
  amount: z.coerce.number().positive(),
  mode: z.enum(['cash', 'upi', 'online', 'bank', 'cheque', 'card', 'dd']),
});
