import { z } from 'zod';

import { STAFF_ROLES } from '../user/roles';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

const staffRole = z.enum(STAFF_ROLES as [string, ...string[]]);
export const createCredentialsSchema = z.object({
  role: staffRole,
  email: z.string().email('Enter a valid email'),
  username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._-]+$/i, 'Only letters, numbers, dots, underscores, hyphens').optional(),
  password: z.string().min(6).optional(),
});
export const updateCredentialsSchema = z.object({
  role: staffRole.optional(),
  active: z.boolean().optional(),
  coordinatorTitle: z.string().trim().max(60).optional(),
});
export const resetPasswordSchema = z.object({ password: z.string().min(6).optional() });
export const setInchargeSchema = z.object({ sectionId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid section id') });

const mobile = z.string().regex(/^[6-9]\d{9}$/, 'Invalid mobile number');
const aadhaar = z
  .string()
  .optional()
  .refine((v) => !v || /^\d{12}$/.test(v), 'Aadhaar must be 12 digits');
const pan = z
  .string()
  .optional()
  .refine((v) => !v || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.toUpperCase()), 'PAN must be in format AAAAA9999A');
const pinCode = z.string().regex(/^\d{4,6}$/, 'Invalid PIN code');
const addressBlock = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pinCode,
});
const weekday = z.enum(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const personName = z.string().trim().min(2).max(100).regex(/^[A-Za-z.' -]+$/, 'Only letters, spaces, and . \' - allowed');
const bloodGroup = z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const religion = z.enum(['hindu', 'muslim', 'sikh', 'christian', 'jain', 'buddhist', 'other']);
const department = z.enum(['teaching', 'administration', 'accounts', 'transport', 'hostel', 'library', 'support', 'custom']);
const designation = z.enum([
  'principal', 'vice_principal', 'coordinator', 'senior_teacher', 'teacher', 'lab_assistant',
  'librarian', 'accountant', 'clerk', 'receptionist', 'hr_manager', 'storekeeper', 'driver',
  'conductor', 'helper', 'peon', 'security_guard', 'custom',
]);
const ifsc = z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC code').optional();
const bankAccountNumber = z.string().regex(/^\d{9,18}$/, 'Bank account number must be 9-18 digits').optional();
const allowanceType = z.enum(['hra', 'da', 'ta', 'medical', 'special', 'lab_supervision', 'exam_duty', 'performance', 'custom']);
const deductionType = z.enum(['pf', 'esi', 'professional_tax', 'tds', 'salary_advance', 'loan', 'penalty', 'custom']);

export const staffQuery = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  department: z.string().optional(),
  employmentType: z.string().optional(),
  status: z.string().optional(),
  designation: z.string().optional(),
  search: z.string().optional(),
});

const allowanceAdjustment = z.object({
  id: z.string().optional(),
  type: allowanceType,
  customLabel: z.string().max(50).optional(),
  amount: z.coerce.number().min(0),
  taxable: z.boolean().optional(),
});
const deductionAdjustment = z.object({
  id: z.string().optional(),
  type: deductionType,
  customLabel: z.string().max(50).optional(),
  amount: z.coerce.number().min(0),
  recurring: z.boolean().optional(),
});

const qualificationItem = z.object({
  id: z.string(),
  degree: z.string().min(1).max(150),
  institution: z.string().min(1).max(150),
  yearOfPassing: z.coerce.number().int().min(1950).max(2100),
  grade: z.string().min(1).max(20),
  certificateFileName: z.string().optional(),
});

const experienceItem = z.object({
  id: z.string(),
  organization: z.string().min(1).max(150),
  designation: z.string().min(1).max(150),
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  reasonForLeaving: z.string().max(200).optional(),
  letterFileName: z.string().optional(),
});

export const createStaffSchema = z
  .object({
    name: personName,
    mobile: mobile.optional(),
    joiningDate: z.string().optional(),
    designation: designation.optional(),
    designationLabel: z.string().max(100).optional(),
    department: department.optional(),
    departmentLabel: z.string().max(100).optional(),
    employmentType: z.enum(['full_time', 'probation', 'contract', 'part_time']).optional(),
    basic: z.coerce.number().min(0).optional(),
    allowances: z.array(allowanceAdjustment).optional(),
    deductions: z.array(deductionAdjustment).optional(),
    paymentMode: z.enum(['cash', 'bank', 'cheque']).optional(),
    bankAccountNumber,
    bankName: z.string().max(100).optional(),
    branch: z.string().max(100).optional(),
    ifsc,

    // Personal
    dateOfBirth: z.string().optional(),
    gender: z.enum(['male', 'female', 'other']).optional(),
    bloodGroup: bloodGroup.optional(),
    religion: religion.optional(),
    caste: z.string().max(50).optional(),
    nationality: z.string().max(50).optional(),
    aadhaar,
    pan,
    personalEmail: z.string().email('Enter a valid email').optional().or(z.literal('')),
    emergencyContactName: personName.optional(),
    emergencyContactMobile: mobile.optional(),
    photoUrl: z.string().optional(),
    currentAddress: addressBlock.optional(),
    permanentSameAsCurrent: z.boolean().optional(),
    permanentAddress: addressBlock.optional(),

    // Employment extras
    probationEndDate: z.string().optional(),
    reportingToId: z.string().optional(),
    reportingToName: z.string().max(100).optional(),
    workingHoursPerDay: z.coerce.number().int().min(1).max(24).optional(),
    weeklyOffDays: z.array(weekday).optional(),

    // Qualification
    qualifications: z.array(qualificationItem).optional(),
    experience: z.array(experienceItem).optional(),
    teachingSubjects: z.array(z.string().max(50)).optional(),
    teachingClasses: z.array(z.string().max(50)).optional(),
    teachingExperienceYears: z.coerce.number().min(0).optional(),
  })
  .passthrough();

export const statusSchema = z.object({ status: z.string().min(1) });

const attendanceEntry = z.object({
  staffId: z.string().min(1),
  status: z.enum(['present', 'absent', 'leave', 'half_day', 'late']),
  timeIn: z.string().optional(),
  timeOut: z.string().optional(),
  remarks: z.string().optional(),
});
export const saveAttendanceSchema = z.object({
  date: z.string().min(1),
  attendance: z.array(attendanceEntry),
});
export const lockSchema = z.object({ date: z.string().min(1) });

export const attendanceMonthQuery = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number(),
});
