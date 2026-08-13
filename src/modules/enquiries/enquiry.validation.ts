import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

const personName = z.string().trim().min(2).max(100).regex(/^[A-Za-z.' -]+$/, "Only letters, spaces, and . ' - allowed");
const mobile = z.string().regex(/^\+?\d{10,12}$/, 'Invalid mobile number');

export const createEnquirySchema = z.object({
  studentName: personName,
  fatherName: personName.optional(),
  mobile,
  interestedClass: z.string().min(1).max(30).optional(),
  source: z.enum(['walk_in', 'phone', 'website', 'referral']).optional(),
  notes: z.string().max(500).optional(),
  followUpDate: z.string().optional(),
});

export const updateStatusSchema = z.object({
  status: z.enum(['new', 'contacted', 'follow_up', 'admitted', 'not_interested']),
});
