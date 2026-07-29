import { z } from 'zod';

export const openDaySchema = z.object({
  date: z.string().min(1),
  openingBalance: z.coerce.number(),
  reason: z.string().optional(),
});

const denominationLineSchema = z.object({
  value: z.number(),
  kind: z.enum(['note', 'coin']),
  count: z.number(),
});

export const closeDaySchema = z.object({
  date: z.string().min(1),
  denominations: z.array(denominationLineSchema),
  countedCash: z.coerce.number(),
  variance: z.coerce.number(),
  varianceReason: z.string().optional(),
  deposit: z.object({ amount: z.number(), bankName: z.string(), slipNo: z.string() }).optional(),
  handover: z.object({ to: z.string(), amount: z.number() }).optional(),
  retained: z.coerce.number(),
});

export const reopenDaySchema = z.object({
  collectorId: z.string().min(1),
  date: z.string().min(1),
  reason: z.string().min(1),
});

export const scrollExpenseSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(1),
  amount: z.coerce.number(),
  mode: z.string().min(1),
});
