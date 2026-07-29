import { z } from 'zod';

import { MESSAGE_CHANNELS, MESSAGE_TEMPLATE_CATEGORIES } from './messaging.models';

export const idParam = z.object({ id: z.string().min(1) });

export const sendMessageSchema = z.object({
  channel: z.enum(MESSAGE_CHANNELS),
  recipientCount: z.number().int().positive(),
  body: z.string().min(1),
  scheduleAt: z.string().optional(),
});

export const upsertTemplateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  type: z.enum(MESSAGE_CHANNELS),
  category: z.enum(MESSAGE_TEMPLATE_CATEGORIES),
  body: z.string().min(1),
});
