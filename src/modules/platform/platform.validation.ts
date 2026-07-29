import { z } from 'zod';

export const toggleSchema = z.object({
  enabled: z.boolean(),
});

export const keyParam = z.object({
  key: z.string().min(1),
});

export const settingsTypeParam = z.object({
  type: z.enum(['system', 'sms', 'whatsapp', 'payment', 'email']),
});

export const settingsBody = z.record(z.string(), z.unknown());

export const templateIdParam = z.object({
  id: z.string().min(1),
});

export const emailTemplatePatch = z.object({
  subject: z.string().min(1),
  body: z.string(),
});
