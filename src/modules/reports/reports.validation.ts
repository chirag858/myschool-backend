import { z } from 'zod';

import { REPORT_KEYS } from './reports.service';

export const reportKeyParam = z.object({
  key: z.enum(REPORT_KEYS as [string, ...string[]]),
});

export const exportQuery = z.object({
  format: z.enum(['excel', 'pdf']),
});
