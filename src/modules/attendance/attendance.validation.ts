import { z } from 'zod';

import { ATTENDANCE_STATUSES } from './attendance.models';

export const markQuerySchema = z.object({
  date: z.string().min(1),
  class: z.string().min(1),
  section: z.string().min(1),
});

const attendanceEntry = z.object({
  studentId: z.string().min(1),
  status: z.enum(ATTENDANCE_STATUSES),
  time: z.string().optional(),
  remarks: z.string().optional(),
});

export const savePayloadSchema = z.object({
  date: z.string().min(1),
  classKey: z.string().min(1),
  attendance: z.array(attendanceEntry).min(1),
});

export const overridePayloadSchema = z.object({
  date: z.string().min(1),
  classKey: z.string().min(1),
  attendance: z.array(attendanceEntry).min(1),
  reason: z.string().min(1),
  originalAttendance: z.array(z.object({ studentId: z.string(), status: z.string() })),
});

export const studentAttendanceQuery = z.object({
  year: z.coerce.number(),
  month: z.coerce.number(),
});

export const studentIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
});
