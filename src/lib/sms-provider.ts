import { env } from '../config/env';
import { logger } from './logger';

/**
 * Fast2SMS OTP delivery. Uses the `q` (quick transactional) route: no DLT
 * template registration and no Fast2SMS "website verification" step (which the
 * dedicated `otp` route requires). We send our own message text so the OTP
 * copy is under our control.
 *
 * Bulk/transactional SMS (fee reminders, announcements) still goes through the
 * stub in `messaging-provider.ts` until a DLT sender-id + templates are approved.
 *
 * Optional: `isSmsConfigured()` is false when `FAST2SMS_API_KEY` is unset, and
 * callers skip the send (dev/test). `sendOtpSms` throws a clear error if
 * invoked while unconfigured.
 */
const FAST2SMS_ENDPOINT = 'https://www.fast2sms.com/dev/bulkV2';

export function isSmsConfigured(): boolean {
  return Boolean(env.FAST2SMS_API_KEY);
}

/**
 * Reduces a stored mobile to the bare 10-digit form Fast2SMS expects.
 * Handles `+91`, `91`, and a leading `0`. Returns null if what's left is not a
 * valid Indian mobile (10 digits starting 6-9).
 */
export function normalizeIndianMobile(raw: string): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

interface Fast2SmsResponse {
  return?: boolean;
  request_id?: string;
  message?: string[] | string;
  status_code?: number;
}

/**
 * Sends a numeric OTP to one mobile via Fast2SMS. Throws on a missing key, an
 * unnormalisable number, or a non-2xx / `return:false` response — callers
 * decide whether that failure should surface to the user.
 */
export async function sendOtpSms(mobile: string, code: string): Promise<{ requestId: string }> {
  if (!isSmsConfigured()) {
    throw new Error('SMS is not configured (FAST2SMS_API_KEY missing)');
  }
  const number = normalizeIndianMobile(mobile);
  if (!number) throw new Error(`Not a valid Indian mobile number: ${mobile}`);

  const message = `${code} is your MySmartCampus verification code. Valid for 5 minutes. Do not share it with anyone.`;
  const res = await fetch(FAST2SMS_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: env.FAST2SMS_API_KEY as string,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ route: 'q', message, numbers: number, flash: 0 }),
  });

  const body = (await res.json().catch(() => ({}))) as Fast2SmsResponse;
  if (!res.ok || body.return !== true) {
    const detail = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    throw new Error(`Fast2SMS send failed (${res.status}): ${detail ?? 'unknown error'}`);
  }

  logger.info('otp sms sent', { to: number, requestId: body.request_id });
  return { requestId: String(body.request_id ?? '') };
}
