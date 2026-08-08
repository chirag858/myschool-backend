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

const validPayload = {
  identity: {
    name: 'New Test School',
    code: 'NTS',
    type: 'k12',
    board: 'cbse',
    addressLine1: '1 Road',
    city: 'Delhi',
    state: 'Delhi',
    pinCode: '110001',
    contactMobile: '9990000000',
    contactEmail: 'nts@test.com',
    principalName: 'P Head',
    establishedYear: 2010,
  },
  branding: { primaryColor: '#123456' },
  subscription: {
    plan: 'yearly',
    startDate: '2026-01-01',
    endDate: '2027-01-01',
    graceDays: 7,
    paymentMethod: 'online',
    paymentReference: 'REF1',
    amountPaid: 44999,
  },
};

describe('Super-Admin Schools API', () => {
  let sa: string;
  beforeEach(async () => {
    await seedDemo();
    sa = await token('superadmin');
  });

  it('requires authentication (401)', async () => {
    const res = await request(app).get('/api/super-admin/schools');
    expect(res.status).toBe(401);
  });

  it('forbids a non-super-admin (403)', async () => {
    const teacher = await token('teacher');
    const res = await request(app).get('/api/super-admin/schools').set(auth(teacher));
    expect(res.status).toBe(403);
  });

  it('allows support_engineer to read the school pickers (GPS Devices / School Reports dependency) but not to create/delete/toggle modules', async () => {
    const eng = await token('support');
    expect((await request(app).get('/api/super-admin/schools').set(auth(eng))).status).toBe(200);
    expect((await request(app).get('/api/super-admin/schools/list').set(auth(eng))).status).toBe(200);
    expect(
      (await request(app).post('/api/super-admin/schools').set(auth(eng)).send(validPayload)).status,
    ).toBe(403);
    expect((await request(app).get('/api/super-admin/dashboard/stats').set(auth(eng))).status).toBe(403);
  });

  it('GET /schools returns SchoolsListResponse with SchoolRow shape', async () => {
    const res = await request(app).get('/api/super-admin/schools').set(auth(sa));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: expect.any(Number), page: 1, pageSize: expect.any(Number) });
    expect(res.body.total).toBeGreaterThanOrEqual(4);
    const row = res.body.rows[0];
    expect(row).toMatchObject({
      id: expect.any(String),
      code: expect.any(String),
      name: expect.any(String),
      plan: expect.any(String),
      status: expect.any(String),
      studentCount: expect.any(Number),
    });
    expect(row).toHaveProperty('lastLoginAt');
  });

  it('filters by status and search', async () => {
    const expired = await request(app).get('/api/super-admin/schools?status=expired').set(auth(sa));
    expect(expired.body.rows.every((r: { status: string }) => r.status === 'expired')).toBe(true);
    const search = await request(app).get('/api/super-admin/schools?search=green').set(auth(sa));
    expect(search.body.rows.some((r: { name: string }) => /green/i.test(r.name))).toBe(true);
  });

  it('GET /schools/list returns id+name entries', async () => {
    const res = await request(app).get('/api/super-admin/schools/list').set(auth(sa));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String) });
  });

  it('GET /schools/:id returns a full SchoolDetail', async () => {
    const list = await request(app).get('/api/super-admin/schools/list').set(auth(sa));
    const id = list.body[0].id;
    const res = await request(app).get(`/api/super-admin/schools/${id}`).set(auth(sa));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      code: expect.any(String),
      type: expect.any(String),
      board: expect.any(String),
      status: expect.any(String),
      studentCount: expect.any(Number),
      staffCount: expect.any(Number),
      branding: expect.any(Object),
      currentSubscription: expect.objectContaining({ plan: expect.any(String) }),
    });
  });

  it('404 for a missing school, 400 for an invalid id', async () => {
    expect(
      (await request(app).get('/api/super-admin/schools/000000000000000000000000').set(auth(sa))).status,
    ).toBe(404);
    expect((await request(app).get('/api/super-admin/schools/not-an-id').set(auth(sa))).status).toBe(400);
  });

  it('GET /schools/generate-code derives a memorable code from the name', async () => {
    const gen = await request(app).get('/api/super-admin/schools/generate-code?name=Vibgyor School').set(auth(sa));
    expect(gen.status).toBe(200);
    expect(gen.body.code).toBe('VIBGYOR');
  });

  it('GET /schools/generate-code falls back to a numbered suffix on collision', async () => {
    const first = await request(app).get('/api/super-admin/schools/generate-code?name=Sunrise Academy').set(auth(sa));
    expect(first.body.code).toBe('SUNRISE');
    await request(app)
      .post('/api/super-admin/schools')
      .set(auth(sa))
      .send({ ...validPayload, identity: { ...validPayload.identity, name: 'Sunrise Academy', code: first.body.code } });
    const second = await request(app).get('/api/super-admin/schools/generate-code?name=Sunrise Academy').set(auth(sa));
    expect(second.body.code).toBe('SUNRISE2');
  });

  it('GET /schools/code-check reports taken vs. free codes', async () => {
    const taken = await request(app).get('/api/super-admin/schools/code-check?code=MSC').set(auth(sa));
    expect(taken.body).toEqual({ taken: true });
    const free = await request(app).get('/api/super-admin/schools/code-check?code=ZZZ999').set(auth(sa));
    expect(free.body).toEqual({ taken: false });
  });

  it('POST /schools creates a tenant and detail reflects it', async () => {
    const res = await request(app).post('/api/super-admin/schools').set(auth(sa)).send(validPayload);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: expect.any(String), code: 'NTS' });
    const detail = await request(app).get(`/api/super-admin/schools/${res.body.id}`).set(auth(sa));
    expect(detail.body.name).toBe('New Test School');
    expect(detail.body.currentSubscription.amountPaid).toBe(44999);
  });

  it('409 on duplicate code, 400 on invalid payload', async () => {
    const dup = { ...validPayload, identity: { ...validPayload.identity, code: 'MSC' } };
    expect((await request(app).post('/api/super-admin/schools').set(auth(sa)).send(dup)).status).toBe(409);
    expect(
      (await request(app).post('/api/super-admin/schools').set(auth(sa)).send({ identity: { name: 'x' } })).status,
    ).toBe(400);
  });

  it('PATCH /schools/:id/status updates the status', async () => {
    const list = await request(app).get('/api/super-admin/schools/list').set(auth(sa));
    const id = list.body.find((s: { name: string }) => s.name.includes('MySmartCampus')).id;
    const res = await request(app)
      .patch(`/api/super-admin/schools/${id}/status`)
      .set(auth(sa))
      .send({ status: 'suspended' });
    expect(res.status).toBe(200);
    const detail = await request(app).get(`/api/super-admin/schools/${id}`).set(auth(sa));
    expect(detail.body.status).toBe('suspended');
  });

  it('GET/PUT /schools/:id/modules returns a full 19-key record and persists changes', async () => {
    const list = await request(app).get('/api/super-admin/schools/list').set(auth(sa));
    const id = list.body[0].id;
    const get = await request(app).get(`/api/super-admin/schools/${id}/modules`).set(auth(sa));
    expect(get.status).toBe(200);
    expect(Object.keys(get.body).length).toBe(19);
    expect(get.body).toMatchObject({ fee_mgmt: expect.any(Boolean), transport: expect.any(Boolean) });

    const put = await request(app)
      .put(`/api/super-admin/schools/${id}/modules`)
      .set(auth(sa))
      .send({ ...get.body, hostel: false });
    expect(put.status).toBe(200);
    expect(put.body.hostel).toBe(false);
    const get2 = await request(app).get(`/api/super-admin/schools/${id}/modules`).set(auth(sa));
    expect(get2.body.hostel).toBe(false);
  });

  it('GET /dashboard/stats computes tenant aggregates', async () => {
    const res = await request(app).get('/api/super-admin/dashboard/stats').set(auth(sa));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalSchools: expect.any(Number),
      activeSchools: expect.any(Number),
      expiredSchools: expect.any(Number),
      planBreakdown: expect.any(Object),
      monthlyRevenue: expect.any(Number),
    });
    expect(res.body.totalSchools).toBeGreaterThanOrEqual(4);
    expect(res.body.expiredSchools).toBeGreaterThanOrEqual(1);
  });
});
