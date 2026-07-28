import { z } from 'zod';

import { ADMISSION_TYPES, GENDERS, PROFILE_STATUSES } from './student.model';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

const addressInput = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pinCode: z.string().optional(),
});

const parentsInput = z.object({
  fatherName: z.string().optional(),
  fatherMobile: z.string().optional(),
  fatherOccupation: z.string().optional(),
  fatherEmail: z.string().optional(),
  fatherAadhaar: z.string().optional(),
  motherName: z.string().optional(),
  motherMobile: z.string().optional(),
  motherOccupation: z.string().optional(),
  motherEmail: z.string().optional(),
  guardianName: z.string().optional(),
  guardianMobile: z.string().optional(),
  guardianRelation: z.string().optional(),
});

export const createStudentSchema = z.object({
  admissionNumber: z.string().min(1),
  admissionType: z.enum(ADMISSION_TYPES),
  admittedAt: z.string().min(1),
  sessionLabel: z.string().optional(),
  className: z.string().min(1),
  section: z.string().min(1),
  rollNumber: z.string().optional(),
  name: z.string().min(1),
  dateOfBirth: z.string().optional(),
  gender: z.enum(GENDERS),
  bloodGroup: z.string().optional(),
  religion: z.string().optional(),
  caste: z.string().optional(),
  category: z.string().optional(),
  nationality: z.string().optional(),
  aadhaar: z.string().optional(),
  parents: parentsInput.optional(),
  currentAddress: addressInput.optional(),
  permanentAddress: addressInput.optional(),
  permanentSameAsCurrent: z.boolean().optional(),
  previousAcademic: z
    .object({
      schoolName: z.string().optional(),
      className: z.string().optional(),
      board: z.string().optional(),
      tcNumber: z.string().optional(),
      reasonForLeaving: z.string().optional(),
    })
    .optional(),
  documents: z
    .array(
      z.object({
        type: z.string(),
        customLabel: z.string().optional(),
        fileName: z.string(),
        sizeBytes: z.number().nonnegative(),
      }),
    )
    .optional(),
});

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
