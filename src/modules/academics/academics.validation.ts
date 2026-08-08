import { z } from 'zod';

import { HOLIDAY_APPLICABILITY } from './academics.models';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });
export const classSectionParams = z.object({
  classId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid class id'),
  sectionId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid section id'),
});
export const classIdParam = z.object({
  classId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid class id'),
});

// Sessions
export const createSessionSchema = z.object({
  name: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  description: z.string().optional(),
  copyFromSessionId: z.string().optional(),
});
export const closeSessionSchema = z.object({ confirmation: z.string().optional() });

// Classes
export const createClassSchema = z.object({
  name: z.string().min(1),
  order: z.coerce.number().int().min(1),
});
export const updateClassSchema = z.object({
  name: z.string().min(1).optional(),
  order: z.coerce.number().int().min(1).optional(),
});
export const reorderSchema = z.array(z.string()).min(1);

// Sections
const sectionBody = {
  name: z.string().min(1),
  classTeacherId: z.string().nullable().optional(),
  classTeacherName: z.string().nullable().optional(),
  roomId: z.string().nullable().optional(),
  roomName: z.string().nullable().optional(),
  maxCapacity: z.coerce.number().optional(),
};
export const createSectionSchema = z.object(sectionBody);
export const updateSectionSchema = z.object({
  name: z.string().min(1).optional(),
  classTeacherId: z.string().nullable().optional(),
  classTeacherName: z.string().nullable().optional(),
  roomId: z.string().nullable().optional(),
  roomName: z.string().nullable().optional(),
  maxCapacity: z.coerce.number().optional(),
});

// Holidays
const holidayBody = {
  name: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  type: z.string().optional(),
  applicability: z.enum(HOLIDAY_APPLICABILITY).optional(),
  applicableClasses: z.array(z.string()).optional(),
  recurring: z.boolean().optional(),
  description: z.string().optional(),
};
export const createHolidaySchema = z.object(holidayBody);
export const updateHolidaySchema = z.object({
  name: z.string().min(1).optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  type: z.string().optional(),
  applicability: z.enum(HOLIDAY_APPLICABILITY).optional(),
  applicableClasses: z.array(z.string()).optional(),
  recurring: z.boolean().optional(),
  description: z.string().optional(),
});
