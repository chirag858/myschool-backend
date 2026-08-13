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

describe('Communication API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get('/api/circulars')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/circulars').set(auth(acc))).status).toBe(403);
  });

  it('KPI reflects seeded circulars', async () => {
    const kpi = await request(app).get('/api/communication/kpi').set(auth(admin));
    expect(kpi.status).toBe(200);
    expect(kpi.body).toMatchObject({ messagesToday: 0, pendingDelivery: 1, circularsThisMonth: expect.any(Number) });
  });

  it('circulars: list/filter, create (auto number), publish, archive, delete', async () => {
    const list = await request(app).get('/api/circulars').set(auth(admin));
    expect(list.body.length).toBe(2);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), number: expect.any(String), status: expect.any(String) });

    const drafts = await request(app).get('/api/circulars?status=draft').set(auth(admin));
    expect(drafts.body.length).toBe(1);

    const create = await request(app)
      .post('/api/circulars')
      .set(auth(admin))
      .send({ title: 'Sports Day', body: 'Next week', audience: ['all'], priority: 'normal', dateOfIssue: '2025-09-20' });
    expect(create.status).toBe(201);
    expect(create.body.number).toMatch(/^CIR\/\d{4}\/003$/);
    const id = create.body.id;

    expect((await request(app).patch(`/api/circulars/${id}/publish`).set(auth(admin))).body.status).toBe('published');
    expect((await request(app).patch(`/api/circulars/${id}/archive`).set(auth(admin))).body.status).toBe('archived');
    expect((await request(app).delete(`/api/circulars/${id}`).set(auth(admin))).body.success).toBe(true);
  });

  it('announcements: list/create/delete', async () => {
    const list = await request(app).get('/api/announcements').set(auth(admin));
    expect(list.body.length).toBe(1);
    expect(list.body[0]).toMatchObject({ title: 'Holiday Notice', pinned: true });

    const create = await request(app)
      .post('/api/announcements')
      .set(auth(admin))
      .send({ title: 'PTM Notice', body: 'Saturday PTM', audience: ['parents'], priority: 'normal' });
    expect(create.status).toBe(201);
    expect(create.body.postedAt).toEqual(expect.any(String));
    expect((await request(app).delete(`/api/announcements/${create.body.id}`).set(auth(admin))).body.success).toBe(true);
  });

  it('notifications: list/unread filter, mark read, mark-all, clear, preferences', async () => {
    const list = await request(app).get('/api/notifications').set(auth(admin));
    expect(list.body.length).toBe(3);
    const unread = await request(app).get('/api/notifications?unread=true').set(auth(admin));
    expect(unread.body.length).toBe(2);

    await request(app).patch(`/api/notifications/${unread.body[0].id}/read`).set(auth(admin));
    expect((await request(app).get('/api/notifications?unread=true').set(auth(admin))).body.length).toBe(1);

    await request(app).patch('/api/notifications/mark-all-read').set(auth(admin));
    expect((await request(app).get('/api/notifications?unread=true').set(auth(admin))).body.length).toBe(0);

    await request(app).delete('/api/notifications/read').set(auth(admin));
    expect((await request(app).get('/api/notifications').set(auth(admin))).body.length).toBe(0);

    const prefs = await request(app).get('/api/notifications/preferences').set(auth(admin));
    expect(prefs.body.feePaymentReceived).toBe(true);
    const save = await request(app).put('/api/notifications/preferences').set(auth(admin)).send({ feePaymentReceived: false });
    expect(save.body.feePaymentReceived).toBe(false);
    expect((await request(app).get('/api/notifications/preferences').set(auth(admin))).body.feePaymentReceived).toBe(false);
  });

  it('rejects invalid circular payload (400)', async () => {
    expect((await request(app).post('/api/circulars').set(auth(admin)).send({ body: 'no title' })).status).toBe(400);
  });
});
