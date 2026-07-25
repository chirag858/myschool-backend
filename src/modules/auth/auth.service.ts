import { randomInt } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { env } from '../../config/env';
import { ApiError } from '../../lib/api-error';
import { signTokens, verifyRefresh, type TokenPair } from '../../lib/jwt';
import { OtpModel } from './otp.model';
import { UserModel } from '../user/user.model';

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

  /** Web staff login (username/email + password). Returns { user, tokens }. */
  async staffLogin(username: string, password: string, ip = ''): Promise<AuthResult> {
    const key = username.toLowerCase();
    const user = await UserModel.findOne({
      $or: [{ username: key }, { email: key }],
    }).select('+passwordHash');
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
    await user.save();
    return { ok: true };
  },

  async forgotSendOtp(username: string, contact: string): Promise<{ expiresAt: number; otp?: string }> {
    const key = username.toLowerCase();
    const user = await UserModel.findOne({ $or: [{ username: key }, { email: key }] });
    if (!user) throw ApiError.notFound('No account found');
    const code = generateOtp();
    const expires = new Date(Date.now() + OTP_TTL_MS);
    await OtpModel.create({ channel: contact, purpose: 'forgot', code, expiresAt: expires });
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
  ): Promise<{ success: true }> {
    const record = await OtpModel.findOne({
      channel: contact,
      purpose: 'forgot',
      consumed: false,
    }).sort({ createdAt: -1 });
    if (!record || record.code !== otp) throw ApiError.unauthorized('Invalid OTP');
    if (record.expiresAt.getTime() < Date.now()) throw ApiError.unauthorized('OTP expired');

    const key = username.toLowerCase();
    const user = await UserModel.findOne({ $or: [{ username: key }, { email: key }] }).select(
      '+passwordHash',
    );
    if (!user) throw ApiError.notFound('No account found');

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();
    record.consumed = true;
    await record.save();
    return { success: true };
  },
};
