import { z } from 'zod';

import { APPOINTMENT_STATUSES, CALL_PURPOSES, VISITOR_PURPOSES } from './reception.models';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const appointmentSchema = z
  .object({
    visitorName: z.string().min(1),
    purpose: z.enum(VISITOR_PURPOSES).optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
  })
  .passthrough();
export const statusSchema = z.object({ status: z.enum(APPOINTMENT_STATUSES) });
export const callLogSchema = z
  .object({
    callerName: z.string().min(1),
    purpose: z.enum(CALL_PURPOSES).optional(),
  })
  .passthrough();
