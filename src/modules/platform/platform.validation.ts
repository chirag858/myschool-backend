import { z } from 'zod';

export const toggleSchema = z.object({
  enabled: z.boolean(),
});

export const keyParam = z.object({
  key: z.string().min(1),
});
