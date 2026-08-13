import { z } from 'zod';

import { CERTIFICATE_TYPES } from './certificates.models';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const generateCertificateSchema = z.object({
  studentId: z.string().min(1),
  studentName: z.string().min(1),
  classLabel: z.string().min(1),
  type: z.enum(CERTIFICATE_TYPES),
  details: z.record(z.string(), z.unknown()).default({}),
});
