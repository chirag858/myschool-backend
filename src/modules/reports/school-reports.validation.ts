import { z } from 'zod';

import { SCHOOL_REPORT_KEYS } from './school-reports.service';

export const schoolReportParams = z.object({
  schoolId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid schoolId'),
  key: z.enum(SCHOOL_REPORT_KEYS as unknown as [string, ...string[]]),
});

export const exportQuery = z.object({
  format: z.enum(['excel', 'pdf']),
});
