import { z } from 'zod';

export const depositSchema = z.object({
  depositDate: z.string().min(1),
  depositTime: z.string().optional(),
  recipientType: z.string().min(1),
  bankAccountId: z.string().optional(),
  amount: z.coerce.number(),
  slipNumber: z.string().optional(),
  remarks: z.string().optional(),
});

export const incomeSchema = z.object({
  source: z.string().min(1),
  description: z.string().min(1),
  amount: z.coerce.number(),
  mode: z.string().min(1),
  reference: z.string().optional(),
});

export const vendorPaymentSchema = z.object({
  vendorId: z.string().min(1),
  vendorName: z.string().min(1),
  amount: z.coerce.number(),
  mode: z.string().min(1),
  reference: z.string(),
  billRef: z.string().optional(),
  note: z.string().optional(),
});
