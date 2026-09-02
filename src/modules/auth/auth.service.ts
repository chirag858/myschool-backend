import { randomInt } from 'node:crypto';

import bcrypt from 'bcryptjs';
import type { HydratedDocument } from 'mongoose';

import { env } from '../../config/env';
import { ApiError } from '../../lib/api-error';
import { signTokens, verifyRefresh, type TokenPair } from '../../lib/jwt';
import { SessionModel } from '../academics/academics.models';
import { SchoolModel } from '../school/school.model';
import { logger } from '../../lib/logger';
import { isMailConfigured, sendMail } from '../../lib/mailer';
import { isSmsConfigured, sendOtpSms } from '../../lib/sms-provider';
import { OtpModel } from './otp.model';
import { UserModel, type UserDoc } from '../user/user.model';

const OTP_TTL_MS = 5 * 60 * 1000;

/** Module keys the mobile app gates tiles on. */
const MOBILE_MODULE_KEYS = [
  'transport', 'fee', 'onlinePayment', 'homework', 'exam', 'result', 'library', 'timetable',
  'attendance', 'lessonPlan', 'assignment', 'syllabus', 'classwork', 'circular', 'ptm', 'leave',
  'outpass', 'appointment', 'activities', 'video', 'onlineClass', 'complaint', 'rewards', 'bag',
] as const;
/** Mobile module → the backend school-module that gates it (others default on). */
const MODULE_ALIAS: Record<string, string> = { circular: 'communication', result: 'exam' };
/** Only these are gated by the school's module list; the rest are always-on sub-features. */
const GATED_MOBILE_MODULES = new Set([
  'transport', 'fee', 'onlinePayment', 'library', 'timetable', 'exam', 'attendance', 'circular', 'result', 'gate',
]);

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

/** "9990000001" → "•••••• 0001" for OTP destination display. */
function maskContact(contact: string): string {
  const tail = contact.slice(-4);
  return `•••••• ${tail}`;
}

const RESEND_COOLDOWN = 60;

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
  // No school code: a platform account first; else fall back to a UNIQUE tenant
  // match so single-tenant / globally-unique usernames sign in code-less
  // (backward-compatible with clients that don't send a code). Only a username
  // that exists in MORE than one school still requires a code to disambiguate.
  const platform = await UserModel.findOne({
    $or: [{ username: key }, { email: key }],
    schoolId: { $exists: false },
  }).select('+passwordHash');
  if (platform) return platform;
  const scoped = await UserModel.find({
    $or: [{ username: key }, { email: key }],
    schoolId: { $exists: true },
  })
    .select('+passwordHash')
    .limit(2);
  if (scoped.length > 1) throw ApiError.badRequest('Enter your school code to sign in');
  return scoped[0] ?? null;
}

/** Shared login tail: validate password + active state, record login, issue tokens. */
async function completeLogin(
  user: HydratedDocument<UserDoc> | null,
  password: string,
  ip: string,
): Promise<AuthResult> {
  if (!user || !user.passwordHash) throw ApiError.unauthorized('Invalid credentials');
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    throw ApiError.unauthorized('Invalid credentials');
  }
  if (!user.active) throw ApiError.forbidden('Account disabled');
  user.lastLoginAt = new Date();
  user.lastLoginIp = ip;
  await user.save();
  return { user: user.toJSON(), tokens: tokensFor(user) };
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
    return completeLogin(user, password, ip);
  },

  /**
   * Password login by identifier — resolves username, email, OR mobile. Serves
   * the mobile app (`identifier`, incl. a parent password fallback by mobile),
   * which is single-tenant per install so it carries no school code. Records
   * last-login. Returns { user, tokens }.
   */
  async passwordLogin(identifier: string, password: string, ip = ''): Promise<AuthResult> {
    const key = identifier.toLowerCase();
    const user = await UserModel.findOne({
      $or: [{ username: key }, { email: key }, { mobile: identifier }],
    }).select('+passwordHash');
    return completeLogin(user, password, ip);
  },

  /** Identifier-first detection for mobile: mobile number → OTP, else password. */
  async detect(identifier: string): Promise<{
    method: 'otp' | 'password';
    passwordFallback: boolean;
    maskedContact?: string;
    identifierType: 'mobile' | 'username';
  }> {
    if (/^[6-9]\d{9}$/.test(identifier)) {
      const user = await UserModel.findOne({ mobile: identifier }).select('+passwordHash');
      return {
        method: 'otp',
        passwordFallback: Boolean(user?.passwordHash),
        maskedContact: maskContact(identifier),
        identifierType: 'mobile',
      };
    }
    return { method: 'password', passwordFallback: false, identifierType: 'username' };
  },

  /** Generate + store a login OTP for a mobile. Returns OtpDispatch (+ code in non-prod). */
  async sendLoginOtp(mobile: string): Promise<{
    expiresAt: number;
    cooldownSeconds: number;
    maskedContact: string;
    otp?: string;
  }> {
    const user = await UserModel.findOne({ mobile });
    if (!user) throw ApiError.notFound('No account for this number');
    const code = generateOtp();
    const expires = new Date(Date.now() + OTP_TTL_MS);
    await OtpModel.create({ channel: mobile, purpose: 'login', code, expiresAt: expires });
    await deliverOtpSms(mobile, code);
    return {
      expiresAt: expires.getTime(),
      cooldownSeconds: RESEND_COOLDOWN,
      maskedContact: maskContact(mobile),
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

  /**
   * The logged-in user's tenant context for the mobile app — real school,
   * active session, per-module flags, app availability and operational config.
   * Replaces the mobile app's hardcoded school/session/module stubs.
   */
  async getContext(userId: string) {
    const user = await UserModel.findById(userId).lean();
    const school = user?.schoolId ? await SchoolModel.findById(user.schoolId).lean() : null;

    const schoolDto = school
      ? { id: String(school._id), name: (school.name as string) ?? 'School', shortName: (school.code as string) ?? '' }
      : { id: '', name: 'MySmartCampus', shortName: 'MSC' };

    const sessionDocs = school ? await SessionModel.find({ schoolId: school._id }).sort({ startDate: -1 }).lean() : [];
    const sessionDto = (s: Record<string, unknown>) => {
      const start = String(s.startDate ?? '').slice(0, 4);
      const end = String(s.endDate ?? '').slice(0, 4);
      return { id: String(s._id), name: (s.name as string) ?? '', financialYear: start && end ? `${start}-${end}` : (s.name as string) ?? '' };
    };
    const activeSession = sessionDocs.find((s) => s.status === 'active') ?? sessionDocs[0];

    const schoolMods = new Set<string>((school?.modules as string[]) ?? []);
    const modules: Record<string, boolean> = {};
    for (const key of MOBILE_MODULE_KEYS) {
      if (!GATED_MOBILE_MODULES.has(key)) {
        modules[key] = true; // granular sub-feature the backend doesn't gate
      } else {
        const backendKey = MODULE_ALIAS[key] ?? key;
        modules[key] = schoolMods.has(backendKey) || schoolMods.has(key);
      }
    }

    return {
      school: schoolDto,
      schools: [schoolDto],
      session: activeSession ? sessionDto(activeSession) : { id: '', name: '', financialYear: '' },
      sessions: sessionDocs.map(sessionDto),
      modules,
      availability: { parent: true, student: true, teacher: true, driver: true, admin: true },
      config: { attendanceLockTime: '11:00', locationCadenceSeconds: 5, locationDistanceFilterM: 25 },
    };
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

  /**
   * Resolve a user for the forgot-password flow. Web sends an explicit
   * username (+ optional school code) → tenant-scoped lookup; mobile sends only
   * a contact (mobile/email) → resolve by that contact directly.
   */
  async _findForForgot(username: string | undefined, contact: string, schoolCode?: string) {
    if (username) return resolveTenantUser(username, schoolCode);
    return UserModel.findOne({
      $or: [{ mobile: contact }, { email: contact.toLowerCase() }],
    }).select('+passwordHash');
  },

  async forgotSendOtp(
    username: string | undefined,
    contact: string,
    schoolCode?: string,
  ): Promise<{ expiresAt: number; cooldownSeconds: number; maskedContact: string; otp?: string }> {
    const user = await this._findForForgot(username, contact, schoolCode);
    if (!user) throw ApiError.notFound('No account found');
    const code = generateOtp();
    const expires = new Date(Date.now() + OTP_TTL_MS);
    await OtpModel.create({ channel: contact, purpose: 'forgot', code, expiresAt: expires });
    await deliverForgotOtp(contact, code);
    return {
      expiresAt: expires.getTime(),
      cooldownSeconds: RESEND_COOLDOWN,
      maskedContact: maskContact(contact),
      ...(env.NODE_ENV !== 'production' ? { otp: code } : {}),
    };
  },

  async forgotReset(
    username: string | undefined,
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

    const user = await this._findForForgot(username, contact, schoolCode);
    if (!user) throw ApiError.notFound('No account found');

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();
    record.consumed = true;
    await record.save();
    return { success: true };
  },
};
