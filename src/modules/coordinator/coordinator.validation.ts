import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const applyLeaveSchema = z.object({
  studentId: z.string().optional(),
  studentName: z.string().min(1),
  className: z.string().optional(),
  fatherName: z.string().optional(),
  fatherMobile: z.string().optional(),
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  days: z.number().int().min(1).optional(),
  type: z.string().optional(),
  reason: z.string().optional(),
});

export const remarksSchema = z.object({ remarks: z.string().optional() });
export const reasonSchema = z.object({ reason: z.string().min(1) });
export const userIdParam = z.object({ userId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });
export const assignedClassesSchema = z.object({ classKeys: z.array(z.string().min(1)) });
export const staffIdParam = z.object({ staffId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });
export const messageBodySchema = z.object({ body: z.string().min(5) });

export const teacherAssignmentSchema = z.object({
  teacherUserId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid teacher id'),
  className: z.string().min(1),
  section: z.string().min(1),
  subjects: z.array(z.string().min(1)).default([]),
  periodsPerWeek: z.number().int().min(0).max(60).default(6),
});
