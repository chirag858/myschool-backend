import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

/** Pass `schoolCode: null` for platform accounts (super_admin/support) that log in code-less. */
async function login(username: string, password = 'demo1234', schoolCode: string | null = 'MSC') {
  const body: Record<string, unknown> = { username, password, captcha: 'abcde' };
  if (schoolCode) body.schoolCode = schoolCode;
  return request(app).post('/api/auth/login').send(body);
}

describe('Auth API', () => {
  beforeEach(async () => {
    await seedDemo();
  });

  it('GET /api/auth/config returns the captcha policy', async () => {
    const res = await request(app).get('/api/auth/config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ captchaPolicy: 'always', otpLength: 6 });
  });

  it('POST /api/auth/login returns { user, tokens } matching the frontend types', async () => {
    const res = await login('schooladmin');
    expect(res.status).toBe(200);
    // user shape
    expect(res.body.user).toMatchObject({
      _id: expect.any(String),
      name: expect.any(String),
      email: expect.any(String),
      role: 'school_admin',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    // tokens shape
    expect(res.body.tokens).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresAt: expect.any(Number),
    });
  });

  it('rejects an invalid password with 401', async () => {
    const res = await login('schooladmin', 'wrong-password');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects a missing field with 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'schooladmin' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('GET /api/auth/profile requires a token (401 without one)', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/profile returns the current user with a valid token', async () => {
    const token = (await login('accountant')).body.tokens.accessToken;
    const res = await request(app).get('/api/auth/profile').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('accountant');
    expect(res.body._id).toEqual(expect.any(String));
  });

  it('POST /api/auth/detect: mobile → otp, username → password', async () => {
    const otp = await request(app).post('/api/auth/detect').send({ identifier: '9990000001' });
    expect(otp.body.method).toBe('otp');
    const pw = await request(app).post('/api/auth/detect').send({ identifier: 'schooladmin' });
    expect(pw.body.method).toBe('password');
  });

  it('OTP login flow: send → verify → { user, tokens }', async () => {
    const send = await request(app).post('/api/auth/otp/send').send({ mobile: '9990000001' });
    expect(send.status).toBe(200);
    expect(send.body.expiresAt).toEqual(expect.any(Number));
    const otp = send.body.otp as string; // returned in non-prod
    expect(otp).toMatch(/^\d{6}$/);

    const verify = await request(app).post('/api/auth/otp/verify').send({ mobile: '9990000001', otp });
    expect(verify.status).toBe(200);
    expect(verify.body.user.role).toBe('parent');
    expect(verify.body.tokens.accessToken).toEqual(expect.any(String));
  });

  it('rejects a wrong OTP with 401', async () => {
    await request(app).post('/api/auth/otp/send').send({ mobile: '9990000001' });
    const res = await request(app).post('/api/auth/otp/verify').send({ mobile: '9990000001', otp: '000000' });
    expect(res.status).toBe(401);
  });

  it('POST /api/auth/refresh returns a fresh token pair', async () => {
    const tokens = (await login('teacher')).body.tokens;
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: tokens.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresAt: expect.any(Number),
    });
  });

  it('forgot-password: send OTP → reset → login with the new password', async () => {
    const contact = 'coordinator@msc.test';
    const send = await request(app)
      .post('/api/auth/forgot-password/send-otp')
      .send({ username: 'coordinator', contact, schoolCode: 'MSC' });
    expect(send.status).toBe(200);
    const otp = send.body.otp as string;

    const reset = await request(app)
      .post('/api/auth/forgot-password/reset')
      .send({ username: 'coordinator', contact, otp, password: 'newpass123', schoolCode: 'MSC' });
    expect(reset.status).toBe(200);
    expect(reset.body.success).toBe(true);

    const relogin = await login('coordinator', 'newpass123');
    expect(relogin.status).toBe(200);
  });

  it('tenant scoping: super_admin has no schoolId, staff has one', async () => {
    const sa = await login('superadmin', 'demo1234', null);
    expect(sa.status).toBe(200);
    expect(sa.body.user.schoolId).toBeUndefined();
    const admin = await login('schooladmin');
    expect(admin.body.user.schoolId).toEqual(expect.any(String));
  });

  it('school code: platform accounts (super_admin) log in without one', async () => {
    const res = await login('superadmin', 'demo1234', null);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('super_admin');
  });

  it('school code: wrong code returns 401 "Invalid school code"', async () => {
    const res = await login('accountant', 'demo1234', 'NOPE');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Invalid school code/);
  });

  it('school code: tenant account without a code hints at needing one (400)', async () => {
    const res = await login('accountant', 'demo1234', null);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/school code/i);
  });

  it('school code: right code, right school scopes users to that tenant', async () => {
    const gvn = await login('gvn_admin', 'demo1234', 'GVN');
    expect(gvn.status).toBe(200);
    expect(gvn.body.user.role).toBe('school_admin');
    // Same username under the wrong school code doesn't resolve.
    const wrongSchool = await login('gvn_admin', 'demo1234', 'MSC');
    expect(wrongSchool.status).toBe(401);
  });

  it('unknown route returns 404 NOT_FOUND', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
