import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Force the mailer "configured" and capture every send. Covers all three
// flows that were wired to send email: password-reset OTP, staff-login
// creation, staff password reset.
const sendMail = vi.fn().mockResolvedValue({ messageId: 'test-msg' });
vi.mock('../../lib/mailer', () => ({
  isMailConfigured: () => true,
  sendMail: (...args: unknown[]) => sendMail(...args),
}));

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function staffToken(): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'schooladmin', password: 'demo1234', captcha: 'abcde', schoolCode: 'MSC' });
  return res.body.tokens.accessToken as string;
}

describe('credential emails', () => {
  beforeEach(async () => {
    await seedDemo();
    sendMail.mockClear();
  });

  it('forgot-password: emails the OTP when the contact is an email address', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password/send-otp')
      .send({ username: 'coordinator', contact: 'coordinator@msc.test', schoolCode: 'MSC' });
    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = sendMail.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(arg.to).toBe('coordinator@msc.test');
    expect(arg.text).toMatch(new RegExp(res.body.otp));
  });

  it('forgot-password: does NOT email when the contact is a phone number', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password/send-otp')
      .send({ username: 'coordinator', contact: '9876500000', schoolCode: 'MSC' });
    expect(res.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('staff createCredentials: emails the generated login', async () => {
    const token = await staffToken();
    const list = await request(app).get('/api/staff').set('Authorization', `Bearer ${token}`);
    const staffId = list.body.rows[0].id as string;

    const res = await request(app)
      .post(`/api/staff/${staffId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'teacher', email: 'newhire@example.com' });
    expect(res.status).toBe(201);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = sendMail.mock.calls[0][0] as { to: string; text: string };
    expect(arg.to).toBe('newhire@example.com');
    expect(arg.text).toMatch(new RegExp(res.body.tempPassword));
  });

  it('staff createCredentials: does NOT email when an explicit password is supplied', async () => {
    const token = await staffToken();
    const list = await request(app).get('/api/staff').set('Authorization', `Bearer ${token}`);
    const staffId = list.body.rows[0].id as string;

    const res = await request(app)
      .post(`/api/staff/${staffId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'teacher', email: 'chosen@example.com', username: 'chosen', password: 'chosenpw1' });
    expect(res.status).toBe(201);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('staff resetPassword: emails the new generated password', async () => {
    const token = await staffToken();
    const list = await request(app).get('/api/staff').set('Authorization', `Bearer ${token}`);
    const staffId = list.body.rows[0].id as string;
    await request(app)
      .post(`/api/staff/${staffId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'teacher', email: 'resetme@example.com', password: 'initpw123' });
    sendMail.mockClear();

    const res = await request(app)
      .post(`/api/staff/${staffId}/credentials/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = sendMail.mock.calls[0][0] as { to: string; text: string };
    expect(arg.to).toBe('resetme@example.com');
    expect(arg.text).toMatch(new RegExp(res.body.tempPassword));
  });
});
