import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const upsertCircularSchema = z.object({ title: z.string().min(1) }).passthrough();
export const upsertAnnouncementSchema = z.object({ title: z.string().min(1) }).passthrough();

export const preferencesSchema = z
  .object({
    feePaymentReceived: z.boolean().optional(),
    newAbsentStudent: z.boolean().optional(),
    leaveApplicationSubmitted: z.boolean().optional(),
    newSupportTicket: z.boolean().optional(),
    subscriptionExpiring: z.boolean().optional(),
    lowAttendanceWarning: z.boolean().optional(),
    examResultPublished: z.boolean().optional(),
  })
  .passthrough();
