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

export const assignmentPatchSchema = z
  .object({
    title: z.string().min(1).optional(),
    classKey: z.string().min(1).optional(),
    subject: z.string().min(1).optional(),
    description: z.string().optional(),
    instructions: z.string().optional(),
    maxMarks: z.number().optional(),
    dueDate: z.string().min(1).optional(),
    submissionType: z.enum(['document', 'text', 'both']).optional(),
    status: z.enum(['draft', 'active', 'closed']).optional(),
  })
  .passthrough();

export const gradeSchema = z.object({
  marks: z.number(),
  feedback: z.string().optional().default(''),
});

/** Teacher records a hand-in. `submitted` is normalised to `late` server-side
 * when the due date has already passed — the client never picks `late`. */
export const receiveSubmissionSchema = z.object({
  status: z.enum(['pending', 'submitted']),
  textContent: z.string().optional(),
  fileName: z.string().optional(),
});

export const homeworkSubmissionSchema = z.object({
  status: z.enum(['pending', 'submitted', 'late', 'graded']),
  marks: z.number().optional(),
  remark: z.string().optional(),
  attachment: z.string().optional(),
});

export const circularSchema = z
  .object({
    title: z.string().min(1),
    body: z.string().min(1),
  })
  .passthrough();

export const circularPatchSchema = z.object({
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  priority: z.enum(['normal', 'urgent', 'emergency']).optional(),
  dateOfIssue: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  audienceClasses: z.array(z.string()).optional(),
});

export const applyLeaveSchema = z
  .object({
    type: z.enum(['casual', 'sick', 'earned', 'special']),
    fromDate: z.string().min(1),
    toDate: z.string().min(1),
    reason: z.string().min(1),
    days: z.number().optional(),
  })
  .passthrough();
