import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier: username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Admin App API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids non-management roles (403)', async () => {
    expect((await request(app).get('/api/admin/dashboard')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/admin/dashboard').set(auth(acc))).status).toBe(403);
  });

  it('dashboard: collections by channel + vitals + approval badges', async () => {
    const res = await request(app).get('/api/admin/dashboard').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.collections).toMatchObject({ cash: expect.any(Number), online: expect.any(Number), bank: expect.any(Number), total: expect.any(Number) });
    expect(res.body.vitals).toMatchObject({ enrollmentTotal: expect.any(Number), studentAttendancePct: expect.any(Number) });
    expect(res.body.badges.approvals).toBe(3);
  });

  it('fee-summary + attendance-summary aggregate by class', async () => {
    const fee = await request(app).get('/api/admin/fee-summary').set(auth(admin));
    expect(fee.body).toMatchObject({ totalOutstanding: expect.any(Number), byClass: expect.any(Array), collections: expect.any(Object) });
    const att = await request(app).get('/api/admin/attendance-summary').set(auth(admin));
    expect(att.body).toMatchObject({ studentPct: expect.any(Number), staffPct: expect.any(Number), byClass: expect.any(Array) });
  });

  it('reports returns server-computed report items', async () => {
    const res = await request(app).get('/api/admin/reports').set(auth(admin));
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toMatchObject({ id: expect.any(String), title: expect.any(String), rows: expect.any(Array) });
  });

  it('approvals: list, filter by type, detail', async () => {
    const all = await request(app).get('/api/admin/approvals').set(auth(admin));
    expect(all.body.length).toBe(3);
    const concessions = await request(app).get('/api/admin/approvals?type=concession').set(auth(admin));
    expect(concessions.body.length).toBe(1);
    const detail = await request(app).get(`/api/admin/approvals/detail?id=${all.body[0].id}`).set(auth(admin));
    expect(detail.body).toMatchObject({ id: all.body[0].id, trail: expect.any(Array) });
  });

  it('act: endorse advances level, authorize approves, stale expectedLevel → 409', async () => {
    const list = await request(app).get('/api/admin/approvals?type=concession').set(auth(admin));
    const item = list.body[0];
    expect(item.currentLevel).toBe(1);

    // endorse level 1 → moves to level 2
    const endorsed = await request(app).post('/api/admin/approvals/act').set(auth(admin))
      .send({ id: item.id, action: 'endorse', reason: 'Looks valid', expectedLevel: 1 });
    expect(endorsed.body.currentLevel).toBe(2);
    expect(endorsed.body.trail.length).toBe(2);

    // stale level → 409
    const stale = await request(app).post('/api/admin/approvals/act').set(auth(admin))
      .send({ id: item.id, action: 'authorize', reason: 'x', expectedLevel: 1 });
    expect(stale.status).toBe(409);

    // authorize at correct level → approved
    const authd = await request(app).post('/api/admin/approvals/act').set(auth(admin))
      .send({ id: item.id, action: 'authorize', reason: 'Approved', expectedLevel: 2 });
    expect(authd.body.status).toBe('approved');

    // already actioned → 409
    const again = await request(app).post('/api/admin/approvals/act').set(auth(admin))
      .send({ id: item.id, action: 'authorize', reason: 'x', expectedLevel: 2 });
    expect(again.status).toBe(409);

    // and it drops out of the pending list
    expect((await request(app).get('/api/admin/approvals?type=concession').set(auth(admin))).body.length).toBe(0);
  });
});
