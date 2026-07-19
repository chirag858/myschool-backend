import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const appointmentSchema = z.object({ visitorName: z.string().min(1) }).passthrough();
export const statusSchema = z.object({ status: z.string().min(1) });
export const callLogSchema = z.object({ callerName: z.string().min(1) }).passthrough();
