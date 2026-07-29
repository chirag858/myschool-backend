import { z } from 'zod';

import { SCHOOL_REPORT_KEYS } from './school-reports.service';

export const reportKeyParam = z.object({
  key: z.enum(SCHOOL_REPORT_KEYS as unknown as [string, ...string[]]),
});

export const exportQuery = z.object({
  format: z.enum(['excel', 'pdf']),
});
