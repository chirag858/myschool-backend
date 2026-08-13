import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      username,
      password: 'demo1234',
      captcha: 'x',
      ...(['superadmin', 'support'].includes(username) ? {} : { schoolCode: 'MSC' }),
    });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('School reports API (cross-school, super_admin + support_engineer)', () => {
  let schoolId: string;

  beforeEach(async () => {
    await seedDemo();
    const admin = await token('schooladmin');
    const profile = await request(app).get('/api/auth/profile').set(auth(admin));
    schoolId = profile.body.schoolId as string;
  });

  it('requires auth (401) and forbids tenant roles entirely (403)', async () => {
    expect((await request(app).get(`/api/super-admin/school-reports/${schoolId}/academic`)).status).toBe(401);
    const admin = await token('schooladmin');
    expect(
      (await request(app).get(`/api/super-admin/school-reports/${schoolId}/academic`).set(auth(admin))).status,
    ).toBe(403);
  });

  it('allows super_admin (matches sidebar + frontend ProtectedRoute)', async () => {
    const sa = await token('superadmin');
    const res = await request(app).get(`/api/super-admin/school-reports/${schoolId}/academic`).set(auth(sa));
    expect(res.status).toBe(200);
  });

  it('allows support_engineer (the fix — frontend/sidebar already granted this, backend previously 403d it)', async () => {
    const eng = await token('support');
    const res = await request(app).get(`/api/super-admin/school-reports/${schoolId}/fee`).set(auth(eng));
    expect(res.status).toBe(200);
  });

  it('every report key returns real seeded rows for the demo school, not mock/empty data', async () => {
    const sa = await token('superadmin');
    const academic = await request(app).get(`/api/super-admin/school-reports/${schoolId}/academic`).set(auth(sa));
    expect(academic.body.rows.length).toBeGreaterThan(0);

    const fee = await request(app).get(`/api/super-admin/school-reports/${schoolId}/fee`).set(auth(sa));
    expect(fee.body.rows.length).toBeGreaterThan(0);

    const hr = await request(app).get(`/api/super-admin/school-reports/${schoolId}/hr`).set(auth(sa));
    expect(hr.body.rows.length).toBeGreaterThan(0);

    const transport = await request(app).get(`/api/super-admin/school-reports/${schoolId}/transport`).set(auth(sa));
    expect(transport.body.rows.length).toBeGreaterThan(0);

    const custom = await request(app).get(`/api/super-admin/school-reports/${schoolId}/custom`).set(auth(sa));
    expect(custom.body.rows.length).toBeGreaterThan(0);
  });

  it('attendance report follows the school\'s own most recent attendance month, not the server\'s real wall-clock month (seed data predates "today")', async () => {
    const sa = await token('superadmin');
    const res = await request(app).get(`/api/super-admin/school-reports/${schoolId}/attendance`).set(auth(sa));
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.subtitle).toContain('2025-04');
  });
});
