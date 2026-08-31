import { randomInt } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { env } from '../../config/env';
import { ApiError } from '../../lib/api-error';
import { signTokens, verifyRefresh, type TokenPair } from '../../lib/jwt';
import { logger } from '../../lib/logger';
import { isMailConfigured, sendMail } from '../../lib/mailer';
import { isSmsConfigured, sendOtpSms } from '../../lib/sms-provider';
import { OtpModel } from './otp.model';
import { UserModel, type UserDoc } from '../user/user.model';
import { SchoolModel } from '../school/school.model';
import type { HydratedDocument } from 'mongoose';

const OTP_TTL_MS = 5 * 60 * 1000;

interface AuthResult {
  user: unknown; // toJSON() → frontend `User` shape
  tokens: TokenPair;
}

interface UserLike {
  _id: unknown;
  role: string;
  schoolId?: unknown;
}

function tokensFor(user: UserLike): TokenPair {
  return signTokens({
    sub: String(user._id),
    role: user.role,
    schoolId: user.schoolId ? String(user.schoolId) : undefined,
  });
}

function generateOtp(): string {
  return String(randomInt(100000, 1000000));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s-]{10,15}$/;

/**
 * Sends an OTP by SMS via Fast2SMS. Shared by the login and phone-based
 * password-reset flows. A send failure surfaces as a 502 in production (SMS is
 * the only channel for these); in dev it's logged and swallowed, since the OTP
 * is also returned in the response there. No-op when SMS is unconfigured.
 */
async function deliverOtpSms(mobile: string, code: string): Promise<void> {
  if (!isSmsConfigured()) return;
  try {
    await sendOtpSms(mobile, code);
  } catch (err) {
    logger.error('otp sms failed', err);
    if (env.NODE_ENV === 'production') {
      throw new ApiError(502, 'SMS_FAILED', 'Could not send the OTP by SMS. Try again shortly.');
    }
  }
}

/**
 * Delivers a password-reset OTP over whichever channel `contact` names: email
 * (SMTP) for an address, SMS (Fast2SMS) for a phone number. A send failure
 * surfaces as a 502 in production (the user has no other way to receive the
 * code); in dev it's logged and swallowed, since the OTP is also returned in
 * the response there.
 */
async function deliverForgotOtp(contact: string, code: string): Promise<void> {
  if (EMAIL_RE.test(contact)) {
    if (!isMailConfigured()) return;
    try {
      await sendMail({
        to: contact,
        subject: 'Your MySmartCampus password reset code',
        text: `Your password reset code is ${code}. It expires in 5 minutes. If you did not request this, ignore this email.`,
      });
    } catch (err) {
      logger.error('forgot-otp email failed', err);
      if (env.NODE_ENV === 'production') {
        throw new ApiError(502, 'EMAIL_FAILED', 'Could not send the reset code email. Try again shortly.');
      }
    }
    return;
  }
  if (PHONE_RE.test(contact)) {
    await deliverOtpSms(contact, code);
  }
}

/**
 * Resolves username/email to a user, scoped by school code. `School.code` is
 * the tenant boundary: with a code, only that school's users are candidates;
 * without one, only platform-level accounts (no schoolId at all — super_admin
 * / support_engineer) are — a school-scoped account can't be found code-less
 * since usernames are only unique per-school, not globally.
 */
async function resolveTenantUser(
  username: string,
  schoolCode?: string,
): Promise<HydratedDocument<UserDoc> | null> {
  const key = username.toLowerCase();
  if (schoolCode) {
    const school = await SchoolModel.findOne({ code: schoolCode.toUpperCase() });
    if (!school) throw ApiError.unauthorized('Invalid school code');
    if (school.status !== 'active' && school.status !== 'trial') {
      throw ApiError.forbidden("This school's account is not active. Contact support.");
    }
    return UserModel.findOne({
      schoolId: school._id,
      $or: [{ username: key }, { email: key }],
    }).select('+passwordHash');
  }
  const user = await UserModel.findOne({
    $or: [{ username: key }, { email: key }],
    schoolId: { $exists: false },
  }).select('+passwordHash');
  if (!user) {
    const scoped = await UserModel.exists({
      $or: [{ username: key }, { email: key }],
      schoolId: { $exists: true },
    });
    if (scoped) throw ApiError.badRequest('Enter your school code to sign in');
  }
  return user;
}

export const authService = {
  getConfig() {
    return {
      captchaPolicy: 'always' as const,
      maxFailedAttempts: 5,
      attemptsWarnAfter: 3,
      otpLength: 6,
      resendCountdownSeconds: 60,
      captchaLength: 5,
    };
  },

  /** Web staff login (school code + username/email + password). Returns { user, tokens }. */
  async staffLogin(
    username: string,
    password: string,
    ip = '',
    schoolCode?: string,
  ): Promise<AuthResult> {
    const user = await resolveTenantUser(username, schoolCode);
    if (!user || !user.passwordHash) throw ApiError.unauthorized('Invalid credentials');
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw ApiError.unauthorized('Invalid credentials');
    }
    if (!user.active) throw ApiError.forbidden('Account disabled');
    user.lastLoginAt = new Date();
    user.lastLoginIp = ip;
    await user.save();
    return { user: user.toJSON(), tokens: tokensFor(user) };
  },

  /** Identifier-first detection for mobile: mobile number → OTP, else password. */
  async detect(identifier: string): Promise<{ method: 'otp' | 'password'; passwordFallback?: boolean }> {
    if (/^[6-9]\d{9}$/.test(identifier)) {
      const user = await UserModel.findOne({ mobile: identifier }).select('+passwordHash');
      return { method: 'otp', passwordFallback: Boolean(user?.passwordHash) };
    }
    return { method: 'password' };
  },

  /** Generate + store a login OTP for a mobile. Returns code in non-prod. */
  async sendLoginOtp(mobile: string): Promise<{ expiresAt: number; otp?: string }> {
    const user = await UserModel.findOne({ mobile });
    if (!user) throw ApiError.notFound('No account for this number');
    const code = generateOtp();
    const expires = new Date(Date.now() + OTP_TTL_MS);
    await OtpModel.create({ channel: mobile, purpose: 'login', code, expiresAt: expires });
    await deliverOtpSms(mobile, code);
    return {
      expiresAt: expires.getTime(),
      ...(env.NODE_ENV !== 'production' ? { otp: code } : {}),
    };
  },

  /** Verify a login OTP → { user, tokens }. */
  async verifyLoginOtp(mobile: string, otp: string): Promise<AuthResult> {
    const record = await OtpModel.findOne({
      channel: mobile,
      purpose: 'login',
      consumed: false,
    }).sort({ createdAt: -1 });
    if (!record || record.code !== otp) throw ApiError.unauthorized('Invalid OTP');
    if (record.expiresAt.getTime() < Date.now()) throw ApiError.unauthorized('OTP expired');
    record.consumed = true;
    await record.save();

    const user = await UserModel.findOne({ mobile });
    if (!user) throw ApiError.notFound('No account for this number');
    return { user: user.toJSON(), tokens: tokensFor(user) };
  },

  /** Exchange a refresh token for a fresh token pair (frontend `Tokens`). */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload;
    try {
      payload = verifyRefresh(refreshToken);
    } catch {
      throw ApiError.unauthorized('Invalid refresh token');
    }
    const user = await UserModel.findById(payload.sub);
    if (!user || !user.active) throw ApiError.unauthorized('Account not available');
    return tokensFor(user);
  },

  async getProfile(userId: string): Promise<unknown> {
    const user = await UserModel.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    return user.toJSON();
  },

  async updateProfile(
    userId: string,
    patch: {
      name?: string;
      email?: string;
      mobile?: string;
      dateOfBirth?: string;
      address?: string;
      photoUrl?: string;
    },
  ): Promise<unknown> {
    const user = await UserModel.findByIdAndUpdate(userId, patch, { new: true });
    if (!user) throw ApiError.notFound('User not found');
    return user.toJSON();
  },

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: boolean; reason?: 'wrong_current' }> {
    const user = await UserModel.findById(userId).select('+passwordHash');
    if (!user || !user.passwordHash) throw ApiError.notFound('User not found');
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return { ok: false, reason: 'wrong_current' };
    }
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.mustChangePassword = false;
    await user.save();
    return { ok: true };
  },

  async forgotSendOtp(
    username: string,
    contact: string,
    schoolCode?: string,
  ): Promise<{ expiresAt: number; otp?: string }> {
    const user = await resolveTenantUser(username, schoolCode);
    if (!user) throw ApiError.notFound('No account found');
    const code = generateOtp();
    const expires = new Date(Date.now() + OTP_TTL_MS);
    await OtpModel.create({ channel: contact, purpose: 'forgot', code, expiresAt: expires });
    await deliverForgotOtp(contact, code);
    return {
      expiresAt: expires.getTime(),
      ...(env.NODE_ENV !== 'production' ? { otp: code } : {}),
    };
  },

  async forgotReset(
    username: string,
    contact: string,
    otp: string,
    password: string,
    schoolCode?: string,
  ): Promise<{ success: true }> {
    const record = await OtpModel.findOne({
      channel: contact,
      purpose: 'forgot',
      consumed: false,
    }).sort({ createdAt: -1 });
    if (!record || record.code !== otp) throw ApiError.unauthorized('Invalid OTP');
    if (record.expiresAt.getTime() < Date.now()) throw ApiError.unauthorized('OTP expired');

    const user = await resolveTenantUser(username, schoolCode);
    if (!user) throw ApiError.notFound('No account found');

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();
    record.consumed = true;
    await record.save();
    return { success: true };
  },
};
