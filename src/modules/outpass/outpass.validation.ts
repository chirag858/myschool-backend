import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const issueOutPassSchema = z.object({
  studentId: z.string().min(1),
  purpose: z.string().min(1),
  destination: z.string().min(1),
  expectedReturn: z.string().min(1),
  parentApprovalRequired: z.boolean().default(false),
  otpVerified: z.boolean().default(false),
  remarks: z.string().optional(),
});

export const addVisitorSchema = z.object({
  visitorName: z.string().min(1),
  mobile: z.string().optional().default(''),
  idProofType: z.enum(['aadhaar', 'voter_id', 'driving_license', 'passport']).default('aadhaar'),
  idProofNumber: z.string().optional().default(''),
  personToMeet: z.string().min(1),
  purpose: z.string().min(1),
  department: z.string().optional(),
  roomNumber: z.string().optional(),
  vehicleNumber: z.string().optional(),
  photoUrl: z.string().optional(),
});
