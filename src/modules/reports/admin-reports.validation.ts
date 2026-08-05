import { z } from 'zod';

import { CUSTOM_REPORT_SOURCES } from './custom-report.service';
import { SCHOOL_REPORT_KEYS } from './school-reports.service';

export const reportKeyParam = z.object({
  key: z.enum(SCHOOL_REPORT_KEYS as unknown as [string, ...string[]]),
});

export const exportQuery = z.object({
  format: z.enum(['excel', 'pdf']),
});

export const customReportFilterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(['equals', 'contains', 'gt', 'lt', 'between']),
  value: z.string(),
});

export const customReportSchema = z.object({
  source: z.enum(CUSTOM_REPORT_SOURCES as unknown as [string, ...string[]]),
  fields: z.array(z.string()).min(1),
  filters: z.array(customReportFilterSchema).optional(),
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  groupBy: z.string().optional(),
  maxRows: z.union([z.number(), z.literal('all')]).optional(),
  title: z.string().optional(),
  showTotals: z.boolean().optional(),
});
