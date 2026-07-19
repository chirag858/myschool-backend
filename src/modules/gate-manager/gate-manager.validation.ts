import { z } from 'zod';

export const idParam = z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') });

export const releaseSchema = z
  .object({
    studentId: z.string().min(1),
    pickupByName: z.string().min(1),
    pickupByMobile: z.string().min(1),
    relation: z.string().min(1),
    reason: z.string().min(1),
    verificationMethod: z.string().min(1),
  })
  .passthrough();

export const otpSchema = z.object({ mobile: z.string().min(1) });

export const visitorSchema = z
  .object({
    name: z.string().min(1),
    mobile: z.string().min(1),
  })
  .passthrough();

export const teacherPassSchema = z
  .object({
    teacherName: z.string().min(1),
    duration: z.string().min(1),
  })
  .passthrough();
