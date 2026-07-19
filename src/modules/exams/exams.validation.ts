import { z } from 'zod';

import { EXAM_TYPES } from './exams.models';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });
export const examStudentParams = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid exam id'),
  studentId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid student id'),
});

export const createExamSchema = z.object({
  name: z.string().min(1),
  type: z.enum(EXAM_TYPES),
  session: z.string().optional(),
  classes: z.array(z.string()).default([]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  resultDate: z.string().optional(),
  description: z.string().optional(),
  patternByClass: z.record(z.string(), z.unknown()).optional(),
  dateSheet: z.array(z.unknown()).optional(),
});

export const marksQuery = z.object({
  classKey: z.string().min(1),
  subjectId: z.string().min(1),
});

const markRow = z.object({
  studentId: z.string().min(1),
  theory: z.number().nullable().optional(),
  practical: z.number().nullable().optional(),
  internal: z.number().nullable().optional(),
  isAbsent: z.boolean().optional(),
  remarks: z.string().optional(),
});

export const saveMarksSchema = z.object({
  classKey: z.string().min(1),
  subjectId: z.string().min(1),
  rows: z.array(markRow),
});

export const resultsQuery = z.object({ classKey: z.string().min(1) });
export const classKeyBody = z.object({ classKey: z.string().min(1) });
