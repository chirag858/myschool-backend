import { z } from 'zod';

const mobile = z.string().regex(/^[6-9]\d{9}$/, 'Invalid mobile number');
const identifierOrMobile = z.object({
  identifier: z.string().min(1).optional(),
  mobile: z.string().min(1).optional(),
});

/** Login accepts `username` (web) or `identifier` (mobile), + optional device. */
export const loginSchema = z
  .object({
    username: z.string().min(1).optional(),
    identifier: z.string().min(1).optional(),
    password: z.string().min(1),
    captcha: z.string().optional(),
    device: z.any().optional(),
  })
  .refine((d) => Boolean(d.username || d.identifier), {
    message: 'username or identifier is required',
  });

/** Parent password fallback — identifier (mobile/username) + password. */
export const parentLoginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
  device: z.any().optional(),
});

export const detectSchema = z.object({
  identifier: z.string().min(1),
});

/** OTP request/resend/send — mobile sends `identifier`, web sends `mobile`. */
export const otpRequestSchema = identifierOrMobile.refine(
  (d) => Boolean(d.identifier || d.mobile),
  { message: 'identifier or mobile is required' },
);

export const verifyOtpSchema = z
  .object({
    identifier: z.string().min(1).optional(),
    mobile: z.string().min(1).optional(),
    otp: z.string().length(6),
    device: z.any().optional(),
  })
  .refine((d) => Boolean(d.identifier || d.mobile), {
    message: 'identifier or mobile is required',
  });

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

/** Forgot flow — mobile sends only `contact`; web may also send `username`. */
export const forgotSendSchema = z.object({
  contact: z.string().min(1),
  username: z.string().min(1).optional(),
});

export const forgotResetSchema = z.object({
  contact: z.string().min(1),
  username: z.string().min(1).optional(),
  otp: z.string().length(6),
  password: z.string().min(6),
});

// Retained for callers importing the strict mobile-number schema.
export const sendOtpSchema = z.object({ mobile });
