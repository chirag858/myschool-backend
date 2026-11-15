import { z } from 'zod';

export const idParam = z.object({ id: z.string().min(1) });

export const createSyllabusSchema = z.object({
  title: z.string().trim().min(1).max(160),
  classKey: z.string().trim().min(1),
  subject: z.string().trim().max(80).optional(),
  term: z.string().trim().max(40).optional(),
  fileUrl: z.string().url(),
  fileName: z.string().trim().max(200).optional(),
  fileKey: z.string().optional(),
});

export const updateSyllabusSchema = createSyllabusSchema.partial();

export type CreateSyllabusInput = z.infer<typeof createSyllabusSchema>;
export type UpdateSyllabusInput = z.infer<typeof updateSyllabusSchema>;
