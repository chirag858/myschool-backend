import { z } from 'zod';

import {
  INSTALLMENT_FREQUENCIES,
  REMINDER_AUDIENCES,
  REMINDER_CHANNELS,
  REMINDER_TRIGGER_KINDS,
} from './fee-recovery.models';

export const idParam = z.object({ id: z.string().min(1) });

export const scheduleEntrySchema = z.object({
  index: z.number(),
  dueDate: z.string(),
  amount: z.number(),
  status: z.enum(['paid', 'due', 'upcoming']),
  receiptNumber: z.string().optional(),
  paidOn: z.string().optional(),
});

export const createPlanSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  installmentsCount: z.number().int().positive(),
  frequency: z.enum(INSTALLMENT_FREQUENCIES),
  customDates: z.array(z.string()).optional(),
  applicableFeeHeads: z.array(z.string()).default([]),
  processingFee: z.number().default(0),
  latePaymentFinePerDay: z.number().default(0),
  active: z.boolean().default(true),
  studentsAssigned: z.number().optional(),
});
export const updatePlanSchema = createPlanSchema.partial();

export const assignInstallmentSchema = z.object({
  id: z.string().optional(),
  studentId: z.string().min(1),
  studentName: z.string().default(''),
  className: z.string().default(''),
  planId: z.string().min(1),
  planName: z.string().default(''),
  totalAmount: z.number(),
  paidAmount: z.number().default(0),
  remainingAmount: z.number(),
  nextDueDate: z.string().optional(),
  nextInstallmentAmount: z.number().optional(),
  status: z.enum(['on_track', 'due_soon', 'overdue', 'completed']),
  schedule: z.array(scheduleEntrySchema).default([]),
});

export const createRuleSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  trigger: z.object({
    kind: z.enum(REMINDER_TRIGGER_KINDS),
    days: z.number().optional(),
  }),
  channel: z.enum(REMINDER_CHANNELS),
  templateId: z.string().min(1),
  audience: z.enum(REMINDER_AUDIENCES),
  audienceClassKeys: z.array(z.string()).optional(),
  audienceMinAmount: z.number().optional(),
  active: z.boolean().default(true),
  lastRunAt: z.string().optional(),
});

export const toggleRuleSchema = z.object({ active: z.boolean() });

export const defaultersQuery = z.object({
  classKey: z.string().optional(),
  minDaysOverdue: z.coerce.number().optional(),
  minAmount: z.coerce.number().optional(),
});

export const sendReminderSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1),
  channel: z.enum(REMINDER_CHANNELS),
});
