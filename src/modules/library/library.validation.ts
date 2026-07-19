import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const upsertBookSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  publisher: z.string().optional(),
  edition: z.string().optional(),
  isbn: z.string().optional(),
  publicationYear: z.coerce.number().optional(),
  category: z.string().optional(),
  subject: z.string().optional(),
  classLevels: z.array(z.string()).optional(),
  language: z.string().optional(),
  totalCopies: z.coerce.number().optional(),
  location: z.string().optional(),
  pricePerCopy: z.coerce.number().optional(),
  description: z.string().optional(),
  coverUrl: z.string().optional(),
});

export const issueSchema = z.object({
  memberId: z.string().min(1),
  bookId: z.string().min(1),
  copyId: z.string().min(1),
  dueDate: z.string().min(1),
  remarks: z.string().optional(),
});

export const returnSchema = z.object({
  issueId: z.string().min(1),
  condition: z.string().min(1),
  fineAmount: z.coerce.number().default(0),
  waived: z.boolean().default(false),
  waiveReason: z.string().optional(),
  remarks: z.string().optional(),
});

export const waiveSchema = z.object({ reason: z.string().min(1) });
