import { z } from 'zod';

export const markReadSchema = z.object({ id: z.string().min(1) }).passthrough();

export const submitSchema = z
  .object({
    assignmentId: z.string().min(1),
    files: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          kind: z.string(),
          sizeLabel: z.string().optional(),
        }),
      )
      .default([]),
    text: z.string().optional(),
  })
  .passthrough();
