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

describe('Super Admin extras API', () => {
  let sa: string;
  let schoolId: string;
  beforeEach(async () => {
    await seedDemo();
    sa = await token('superadmin');
    // The seed creates several schools; the demo data (users/subs/audit) all
    // live under MSC, so resolve that one specifically.
    const list = await request(app).get('/api/super-admin/schools').set(auth(sa));
    schoolId = (list.body.rows.find((r: { code: string }) => r.code === 'MSC')?.id ?? list.body.rows[0].id) as string;
  });

  it('requires auth (401) and forbids non-super-admin roles (403)', async () => {
    expect((await request(app).get('/api/super-admin/tickets/stats')).status).toBe(401);
    const admin = await token('schooladmin');
    expect((await request(app).get('/api/super-admin/tickets/stats').set(auth(admin))).status).toBe(403);
  });

  it('infrastructure + revenue chart', async () => {
    const infra = await request(app).get('/api/super-admin/dashboard/infrastructure').set(auth(sa));
    expect(infra.body).toMatchObject({ cpuPercent: expect.any(Number), ram: { totalGb: expect.any(Number) }, ssd: { totalGb: expect.any(Number) } });
    const rev = await request(app).get('/api/super-admin/dashboard/revenue-chart').set(auth(sa));
    expect(Array.isArray(rev.body)).toBe(true);
    expect(rev.body.length).toBeGreaterThan(0);
    expect(rev.body[0]).toMatchObject({ label: expect.any(String), value: expect.any(Number) });
  });

  it('subscriptions: list seeded, renew updates history + school state', async () => {
    const list = await request(app).get(`/api/super-admin/schools/${schoolId}/subscriptions`).set(auth(sa));
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), plan: expect.any(String), amountPaid: expect.any(Number) });

    const renew = await request(app)
      .post(`/api/super-admin/schools/${schoolId}/subscriptions`)
      .set(auth(sa))
      .send({ plan: 'yearly', startDate: '2026-04-01', endDate: '2027-03-31', graceDays: 15, paymentMethod: 'bank_transfer', paymentReference: 'TXN-9', amountPaid: 50000 });
    expect(renew.status).toBe(201);
    expect(renew.body).toMatchObject({ plan: 'yearly', amountPaid: 50000, status: 'active', addedBy: 'Super Admin' });

    const after = await request(app).get(`/api/super-admin/schools/${schoolId}/subscriptions`).set(auth(sa));
    expect(after.body.length).toBe(list.body.length + 1);
    const detail = await request(app).get(`/api/super-admin/schools/${schoolId}`).set(auth(sa));
    expect(detail.body).toMatchObject({ plan: 'yearly', status: 'active', expiryDate: '2027-03-31' });

    // Unknown school → 404
    expect((await request(app).get('/api/super-admin/schools/000000000000000000000000/subscriptions').set(auth(sa))).status).toBe(404);
  });

  it('school users returns admins + principals', async () => {
    const res = await request(app).get(`/api/super-admin/schools/${schoolId}/users`).set(auth(sa));
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.every((u: { role: string }) => u.role === 'school_admin' || u.role === 'principal')).toBe(true);
    expect(res.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), status: expect.any(String) });
  });

  it('audit logs (school-scoped + platform) and recent activity', async () => {
    const schoolLogs = await request(app).get(`/api/super-admin/schools/${schoolId}/audit-logs`).set(auth(sa));
    expect(schoolLogs.body.length).toBeGreaterThanOrEqual(1);
    expect(schoolLogs.body[0]).toMatchObject({ actorName: expect.any(String), action: expect.any(String), status: expect.any(String) });

    const platform = await request(app).get('/api/super-admin/audit-logs?limit=5').set(auth(sa));
    expect(platform.body.length).toBeGreaterThanOrEqual(1);
    expect(platform.body.length).toBeLessThanOrEqual(5);

    const activity = await request(app).get(`/api/super-admin/schools/${schoolId}/activity`).set(auth(sa));
    expect(activity.body[0]).toMatchObject({ actor: expect.any(String), action: expect.any(String), module: expect.any(String) });
  });

  it('impersonate mints a working school-admin token', async () => {
    const res = await request(app).post(`/api/super-admin/schools/${schoolId}/impersonate`).set(auth(sa));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token: expect.any(String), schoolId, schoolName: expect.any(String), expiresAt: expect.any(Number) });
    expect(res.body.adminUser).toMatchObject({ role: 'school_admin', name: expect.any(String) });
    // The minted token actually authenticates as that school's admin.
    const whoami = await request(app).get('/api/students').set(auth(res.body.token));
    expect(whoami.status).toBe(200);
  });

  it('ticket stats aggregate by status', async () => {
    const res = await request(app).get('/api/super-admin/tickets/stats').set(auth(sa));
    expect(res.body).toMatchObject({ open: expect.any(Number), in_progress: expect.any(Number), testing: expect.any(Number), resolved: expect.any(Number) });
    const total = res.body.open + res.body.in_progress + res.body.testing + res.body.resolved;
    expect(total).toBeGreaterThanOrEqual(1);
  });
});
