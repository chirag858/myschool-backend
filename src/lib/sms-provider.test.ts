import { describe, expect, it } from 'vitest';

import { isSmsConfigured, normalizeIndianMobile, sendOtpSms } from './sms-provider';

// vitest.config blanks FAST2SMS_API_KEY for the suite, so the provider is inert
// here — this locks in the "unconfigured" contract the auth OTP flows rely on
// (deliverOtpSms skips the send instead of failing the request).
describe('sms-provider', () => {
  it('reports not configured when FAST2SMS_API_KEY is absent', () => {
    expect(isSmsConfigured()).toBe(false);
  });

  it('throws a clear error if a send is attempted while unconfigured', async () => {
    await expect(sendOtpSms('9876543210', '123456')).rejects.toThrow(/SMS is not configured/);
  });

  describe('normalizeIndianMobile', () => {
    it.each([
      ['9876543210', '9876543210'],
      ['+919876543210', '9876543210'],
      ['919876543210', '9876543210'],
      ['09876543210', '9876543210'],
      ['+91 98765 43210', '9876543210'],
    ])('normalizes %s -> %s', (input, expected) => {
      expect(normalizeIndianMobile(input)).toBe(expected);
    });

    it.each(['12345', '1234567890', '98765', '', 'abcdefghij'])('rejects %s', (input) => {
      expect(normalizeIndianMobile(input)).toBeNull();
    });
  });
});
