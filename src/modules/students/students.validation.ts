import { z } from 'zod';

import { ADMISSION_TYPES, GENDERS, PROFILE_STATUSES } from './student.model';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

const mobile = z
  .string()
  .optional()
  .refine((v) => !v || /^\+?\d{10,12}$/.test(v), 'Invalid mobile number');
const aadhaar = z
  .string()
  .optional()
  .refine((v) => !v || /^\d{12}$/.test(v), 'Aadhaar must be 12 digits');
const email = z.string().email('Enter a valid email').optional().or(z.literal(''));
const personName = z.string().trim().min(2).max(100).regex(/^[A-Za-z.' -]+$/, "Only letters, spaces, and . ' - allowed");
const bloodGroup = z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const religion = z.enum(['hindu', 'muslim', 'sikh', 'christian', 'jain', 'buddhist', 'other']);
const category = z.enum(['general', 'obc', 'sc', 'st', 'ews']);
const documentType = z.enum([
  'birth_certificate', 'transfer_certificate', 'previous_marksheet',
  'aadhaar', 'caste_certificate', 'migration_certificate', 'other',
]);

const addressInput = z.object({
  line1: z.string().max(150).optional(),
  line2: z.string().max(150).optional(),
  city: z.string().max(50).optional(),
  state: z.string().max(50).optional(),
  pinCode: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{6}$/.test(v), 'PIN code must be 6 digits'),
});

const parentsInput = z.object({
  fatherName: z.string().max(100).optional(),
  fatherMobile: mobile,
  fatherOccupation: z.string().max(100).optional(),
  fatherEmail: email,
  fatherAadhaar: aadhaar,
  motherName: z.string().max(100).optional(),
  motherMobile: mobile,
  motherOccupation: z.string().max(100).optional(),
  motherEmail: email,
  guardianName: z.string().max(100).optional(),
  guardianMobile: mobile,
  guardianRelation: z.string().max(100).optional(),
});

export const createStudentSchema = z.object({
  admissionNumber: z.string().regex(/^ADM-\d{4}-\d{3}$/, 'Expected format ADM-2026-001'),
  admissionType: z.enum(ADMISSION_TYPES),
  admittedAt: z.string().min(1),
  sessionLabel: z.string().max(20).optional(),
  className: z.string().min(1).max(30),
  section: z.string().min(1).max(30),
  rollNumber: z.string().max(30).optional(),
  name: personName,
  photoUrl: z.string().optional(),
  dateOfBirth: z.string().optional(),
  gender: z.enum(GENDERS),
  bloodGroup: bloodGroup.optional(),
  religion: religion.optional(),
  caste: z.string().max(50).optional(),
  category: category.optional(),
  nationality: z.string().min(2).max(50).optional(),
  aadhaar,
  parents: parentsInput.optional(),
  currentAddress: addressInput.optional(),
  permanentAddress: addressInput.optional(),
  permanentSameAsCurrent: z.boolean().optional(),
  previousAcademic: z
    .object({
      schoolName: z.string().max(150).optional(),
      className: z.string().max(30).optional(),
      board: z.string().max(50).optional(),
      tcNumber: z.string().max(50).optional(),
      reasonForLeaving: z.string().max(200).optional(),
    })
    .optional(),
  documents: z
    .array(
      z.object({
        type: documentType,
        customLabel: z.string().max(50).optional(),
        fileName: z.string().min(1),
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
