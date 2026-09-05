import { z } from 'zod';

import { FEE_FREQUENCIES } from './fee.models';

export const idParam = z.object({ id: z.string().min(1) });

export const createHeadSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  description: z.string().optional(),
  isRefundable: z.boolean().optional(),
  isMandatory: z.boolean().optional(),
  order: z.coerce.number().optional(),
});
export const updateHeadSchema = createHeadSchema.partial();
export const reorderSchema = z.array(z.string()).min(1);

export const structureRow = z.object({
  feeHeadId: z.string().min(1),
  frequency: z.enum(FEE_FREQUENCIES),
  amounts: z.record(z.string(), z.number()),
});
export const saveStructureSchema = z.array(structureRow);

const paymentDetail = z.object({ mode: z.string(), amount: z.number() }).passthrough();

export const collectSchema = z.object({
  studentId: z.string().min(1),
  months: z.array(z.string()).default([]),
  feeHeads: z.array(z.object({ id: z.string(), amount: z.number().nonnegative() })).default([]),
  grossTotal: z.number().nonnegative().optional(),
  concessionApplied: z.number().nonnegative().optional(),
  advanceAdjusted: z.number().nonnegative().optional(),
  previousDues: z.number().nonnegative().optional(),
  fineAmount: z.number().nonnegative().optional(),
  waiveOffAmount: z.number().nonnegative().optional(),
  waiveOffReason: z.string().optional(),
  netPayable: z.number().nonnegative(),
  payments: z.array(paymentDetail).min(1),
  paymentDate: z.string().min(1),
  remarks: z.string().optional(),
  combinedSiblingIds: z.array(z.string()).optional(),
});

export const cancelSchema = z.object({ reason: z.string().min(1) });

export const receiptsQuery = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  status: z.string().optional(),
  mode: z.string().optional(),
  className: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
});

export const ledgerQuery = z.object({
  className: z.string().optional(),
  section: z.string().optional(),
  status: z.string().optional(),
  month: z.string().optional(),
});
