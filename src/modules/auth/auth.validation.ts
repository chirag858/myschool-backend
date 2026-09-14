import { z } from 'zod';

const mobile = z.string().regex(/^[6-9]\d{9}$/, 'Invalid mobile number');
const identifierOrMobile = z.object({
  identifier: z.string().min(1).optional(),
  mobile: z.string().min(1).optional(),
});

const schoolCode = z.string().trim().min(1).max(20).optional();

/** Login accepts `username` (web staff, + school code) or `identifier` (mobile). */
export const loginSchema = z
  .object({
    username: z.string().min(1).optional(),
    identifier: z.string().min(1).optional(),
    password: z.string().min(1),
    captcha: z.string().optional(),
    schoolCode,
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
  schoolCode,
});

export const forgotResetSchema = z.object({
  contact: z.string().min(1),
  username: z.string().min(1).optional(),
  otp: z.string().length(6),
  password: z.string().min(6),
  schoolCode,
});

// Retained for callers importing the strict mobile-number schema.
export const sendOtpSchema = z.object({ mobile });

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
