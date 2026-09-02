import { describe, expect, it } from 'vitest';

import { isMailConfigured, sendMail } from './mailer';

// vitest.config blanks SMTP_* for the suite, so the mailer is inert here —
// this locks in the "unconfigured" contract that auth's forgot-password flow
// relies on (deliverForgotOtp skips the send instead of failing the request).
describe('mailer', () => {
  it('reports not configured when SMTP env is absent', () => {
    expect(isMailConfigured()).toBe(false);
  });

  it('throws a clear error if a send is attempted while unconfigured', async () => {
    await expect(
      sendMail({ to: 'a@b.test', subject: 'x', text: 'y' }),
    ).rejects.toThrow(/SMTP is not configured/);
  });
});
