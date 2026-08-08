import { z } from 'zod';

const mobile = z.string().regex(/^[6-9]\d{9}$/, 'Invalid mobile number');

const schoolCode = z.string().trim().min(1).max(20).optional();

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  captcha: z.string().optional(),
  schoolCode,
});

export const detectSchema = z.object({
  identifier: z.string().min(1),
});

export const sendOtpSchema = z.object({ mobile });

export const verifyOtpSchema = z.object({
  mobile,
  otp: z.string().length(6),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotSendSchema = z.object({
  username: z.string().min(1),
  contact: z.string().min(1),
  schoolCode,
});

export const forgotResetSchema = z.object({
  username: z.string().min(1),
  contact: z.string().min(1),
  otp: z.string().length(6),
  password: z.string().min(6),
  schoolCode,
});

export const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  mobile: z.string().optional(),
  dateOfBirth: z.string().optional(),
  address: z.string().optional(),
  photoUrl: z.string().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});
