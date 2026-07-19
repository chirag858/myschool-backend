import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });
export const gradeParams = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
  studentId: z.string().min(1),
});

export const homeworkSchema = z
  .object({
    classKey: z.string().min(1),
    subject: z.string().min(1),
    title: z.string().min(1),
    dueDate: z.string().min(1),
  })
  .passthrough();

export const homeworkPatchSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    dueDate: z.string().optional(),
    homeworkType: z.string().optional(),
    subject: z.string().optional(),
  })
  .passthrough();

export const assignmentSchema = z
  .object({
    title: z.string().min(1),
    classKey: z.string().min(1),
    subject: z.string().min(1),
    maxMarks: z.number(),
    dueDate: z.string().min(1),
  })
  .passthrough();

export const gradeSchema = z.object({
  marks: z.number(),
  feedback: z.string().optional().default(''),
});

export const circularSchema = z
  .object({
    title: z.string().min(1),
    body: z.string().min(1),
  })
  .passthrough();

export const applyLeaveSchema = z
  .object({
    type: z.enum(['casual', 'sick', 'earned', 'special']),
    fromDate: z.string().min(1),
    toDate: z.string().min(1),
    reason: z.string().min(1),
    days: z.number().optional(),
  })
  .passthrough();
