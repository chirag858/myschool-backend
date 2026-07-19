import { z } from 'zod';

const mobile = z.string().regex(/^[6-9]\d{9}$/, 'Invalid mobile number');

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  captcha: z.string().optional(),
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
});

export const forgotResetSchema = z.object({
  username: z.string().min(1),
  contact: z.string().min(1),
  otp: z.string().length(6),
  password: z.string().min(6),
});
