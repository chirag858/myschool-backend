import { z } from 'zod';
import { DAY_OF_WEEK, PERIOD_TYPES, ROOM_FACILITIES, ROOM_STATUS, ROOM_TYPES, SUBJECT_TYPES } from './timetable.models';

export const idParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID'),
});

export const classSectionParams = z.object({
  classId: z.string().min(1, 'Class ID is required'),
  section: z.string().min(1, 'Section is required'),
});

const periodSchema = z.object({
  order: z.number().int().min(0),
  name: z.string().min(1),
  startTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)'),
  endTime: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)'),
  type: z.enum([...PERIOD_TYPES] as [string, ...string[]]),
  applicableDays: z.union([z.literal('all'), z.array(z.enum([...DAY_OF_WEEK] as [string, ...string[]]))]),
});

export const savePeriodsSchema = z.object({
  periods: z.array(periodSchema),
});

export const createSubjectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  code: z.string().min(1, 'Code is required'),
  type: z.enum([...SUBJECT_TYPES] as [string, ...string[]]),
  applicableClasses: z.union([z.literal('all'), z.array(z.string())]),
  maxWeeklyPeriods: z.number().int().min(1).max(20),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color format'),
});

export const updateSubjectSchema = createSubjectSchema.partial();

export const createRoomSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum([...ROOM_TYPES] as [string, ...string[]]),
  capacity: z.number().int().min(1).max(500),
  floor: z.string().min(1),
  facilities: z.array(z.enum([...ROOM_FACILITIES] as [string, ...string[]])),
  status: z.enum([...ROOM_STATUS] as [string, ...string[]]),
});

export const updateRoomSchema = createRoomSchema.partial();

export const slotCheckSchema = z.object({
  classId: z.string().min(1),
  section: z.string().min(1),
  day: z.enum([...DAY_OF_WEEK] as [string, ...string[]]),
  periodId: z.string().min(1),
  teacherId: z.string().min(1),
  roomId: z.string().min(1),
  subjectId: z.string().min(1),
});

export const saveSlotSchema = slotCheckSchema.extend({
  subjectName: z.string().min(1),
  subjectColor: z.string().min(1),
  teacherName: z.string().min(1),
  roomName: z.string().min(1),
});

export const clearSlotSchema = z.object({
  section: z.string().min(1, 'Section is required'),
  day: z.enum([...DAY_OF_WEEK] as [string, ...string[]]),
  periodId: z.string().min(1),
});

export const togglePublishSchema = z.object({
  section: z.string().min(1, 'Section is required'),
  publish: z.boolean(),
});

export const copyDaySchema = z.object({
  fromDay: z.enum([...DAY_OF_WEEK] as [string, ...string[]]),
  toDays: z.array(z.enum([...DAY_OF_WEEK] as [string, ...string[]])).min(1),
});
