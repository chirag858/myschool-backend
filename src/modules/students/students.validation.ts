import { z } from 'zod';

import { PROFILE_STATUSES } from './student.model';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const studentsQuerySchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  classKey: z.string().optional(),
  section: z.string().optional(),
  admissionType: z.enum(['new', 'old', 'all']).optional(),
  profileStatus: z.enum([...PROFILE_STATUSES, 'all']).optional(),
  feeStatus: z.enum(['paid', 'partial', 'pending', 'all']).optional(),
  search: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});

export const bulkStatusSchema = z.object({
  studentIds: z.array(z.string()).min(1),
  status: z.enum(PROFILE_STATUSES),
  reason: z.string().optional(),
});

export const bulkTransferSchema = z.object({
  studentIds: z.array(z.string()).min(1),
  toClassName: z.string().min(1),
  toSection: z.string().min(1),
});

export const bulkPromoteSchema = z.object({
  fromClassKey: z.string().min(1),
  toClassName: z.string().min(1),
  toSection: z.string().min(1),
  toSession: z.string().min(1),
});

export const docIdParam = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
  docId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid document id'),
});

export const documentSchema = z
  .object({
    type: z.string().min(1),
    fileName: z.string().min(1),
    sizeBytes: z.number().nonnegative(),
    customLabel: z.string().optional(),
  })
  .passthrough();
