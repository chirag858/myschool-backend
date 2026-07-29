import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Parent App API (mobile)', () => {
  let parent: string;
  let childId: string;
  beforeEach(async () => {
    await seedDemo();
    parent = await token('parent');
    childId = (await request(app).get('/api/parent/app-children').set(auth(parent))).body[0].id;
  });

  it('requires auth (401) and forbids non-parent roles (403)', async () => {
    expect((await request(app).get('/api/parent/app-children')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/parent/app-children').set(auth(acc))).status).toBe(403);
  });

  it('children + dashboard-summary + profile (own child)', async () => {
    const kids = await request(app).get('/api/parent/app-children').set(auth(parent));
    expect(kids.body.length).toBe(2);
    expect(kids.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), className: expect.any(String) });
    const summary = await request(app).get(`/api/parent/dashboard-summary?childId=${childId}`).set(auth(parent));
    expect(summary.body).toMatchObject({ childId, badges: expect.any(Object) });
    const profile = await request(app).get(`/api/parent/profile?childId=${childId}`).set(auth(parent));
    expect(profile.body).toMatchObject({ id: childId, identity: expect.any(Array), guardian: expect.any(Array) });
    // ownership gate
    expect((await request(app).get('/api/parent/profile?childId=000000000000000000000000').set(auth(parent))).status).toBe(404);
  });

  it('attendance returns a month summary + days', async () => {
    const res = await request(app).get(`/api/parent/app-attendance?childId=${childId}`).set(auth(parent));
    expect(res.body).toMatchObject({ summary: expect.objectContaining({ percentage: expect.any(Number), counts: expect.any(Object) }), month: expect.any(String), days: expect.any(Array) });
  });

  it('exams: schedules + marks + timetable stub', async () => {
    expect((await request(app).get(`/api/parent/exam/schedules?childId=${childId}`).set(auth(parent))).body).toMatchObject({ exams: expect.any(Array), schedules: expect.any(Array) });
    expect((await request(app).get(`/api/parent/exam/marks?childId=${childId}`).set(auth(parent))).body).toMatchObject({ assessments: expect.any(Array), results: expect.any(Array) });
    expect((await request(app).get(`/api/parent/exam/timetable?childId=${childId}`).set(auth(parent))).body).toMatchObject({ days: expect.any(Array), today: null });
  });

  it('fees: dues + receipts + ledger', async () => {
    expect((await request(app).get(`/api/parent/fees/dues?childId=${childId}`).set(auth(parent))).body).toMatchObject({ totalOutstanding: expect.any(Number), items: expect.any(Array) });
    expect(Array.isArray((await request(app).get(`/api/parent/fees/receipts?childId=${childId}`).set(auth(parent))).body)).toBe(true);
    expect(Array.isArray((await request(app).get(`/api/parent/fees/ledger?childId=${childId}`).set(auth(parent))).body)).toBe(true);
  });

  it('notifications: list + mark read + read-all', async () => {
    const list = await request(app).get(`/api/parent/notifications?childId=${childId}`).set(auth(parent));
    expect(Array.isArray(list.body)).toBe(true);
    await request(app).post('/api/parent/notifications/read-all').set(auth(parent)).send({ childId });
    const after = await request(app).get(`/api/parent/notifications?childId=${childId}`).set(auth(parent));
    expect(after.body.every((n: { read: boolean }) => n.read)).toBe(true);
  });

  it('complaints: seeded list + submit', async () => {
    const list = await request(app).get(`/api/parent/app-complaints?childId=${childId}`).set(auth(parent));
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    const submit = await request(app).post('/api/parent/app-complaints').set(auth(parent)).send({ childId, values: { subject: 'Canteen', category: 'other', description: 'Food quality' } });
    expect(submit.status).toBe(201);
    expect(submit.body).toMatchObject({ subject: 'Canteen', status: 'submitted' });
  });

  it('requests: seeded + submit + cancel', async () => {
    const list = await request(app).get(`/api/parent/requests?childId=${childId}`).set(auth(parent));
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    const submit = await request(app).post('/api/parent/requests').set(auth(parent)).send({ childId, type: 'appointment', values: { title: 'Meet teacher', reason: 'Discuss progress' } });
    expect(submit.status).toBe(201);
    const cancel = await request(app).post('/api/parent/requests/cancel').set(auth(parent)).send({ childId, id: submit.body.id });
    expect(cancel.body.status).toBe('cancelled');
  });

  it('outpass: seeded awaiting → otp → approve (wrong otp 401)', async () => {
    const list = await request(app).get(`/api/parent/outpass?childId=${childId}`).set(auth(parent));
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    const op = list.body[0];
    const otpRes = await request(app).post('/api/parent/outpass/otp').set(auth(parent)).send({ childId, id: op.id });
    expect(otpRes.body).toMatchObject({ cooldownSeconds: expect.any(Number), maskedContact: expect.any(String) });
    const wrong = await request(app).post('/api/parent/outpass/approve').set(auth(parent)).send({ childId, id: op.id, otp: '000000' });
    expect(wrong.status).toBe(401);
    const approve = await request(app).post('/api/parent/outpass/approve').set(auth(parent)).send({ childId, id: op.id, otp: otpRes.body.otp });
    expect(approve.body.status).toBe('approved');
  });

  it('messenger: conversations + thread + send + read', async () => {
    const convs = await request(app).get(`/api/parent/messenger/conversations?childId=${childId}`).set(auth(parent));
    expect(convs.body.length).toBeGreaterThanOrEqual(1);
    const cId = convs.body[0].id;
    const thread = await request(app).get(`/api/parent/messenger/thread?conversationId=${cId}&childId=${childId}`).set(auth(parent));
    expect(thread.body).toMatchObject({ conversation: expect.any(Object), messages: expect.any(Array) });
    const sent = await request(app).post('/api/parent/messenger/send').set(auth(parent)).send({ childId, conversationId: cId, body: 'Thank you' });
    expect(sent.body).toMatchObject({ body: 'Thank you', own: true });
    expect((await request(app).post('/api/parent/messenger/read').set(auth(parent)).send({ childId, conversationId: cId })).status).toBe(200);
  });

  it('utility: bag + rewards + class-incharge + online-classes', async () => {
    expect((await request(app).get(`/api/parent/bag?childId=${childId}`).set(auth(parent))).body).toMatchObject({ days: expect.any(Array) });
    const rewards = await request(app).get(`/api/parent/rewards?childId=${childId}`).set(auth(parent));
    expect(rewards.body).toMatchObject({ totalPoints: expect.any(Number), entries: expect.any(Array) });
    expect(rewards.body.entries.length).toBeGreaterThanOrEqual(1);
    expect((await request(app).get(`/api/parent/class-incharge?childId=${childId}`).set(auth(parent))).body).toMatchObject({ name: expect.any(String), role: expect.any(String) });
    expect(Array.isArray((await request(app).get(`/api/parent/online-classes?childId=${childId}`).set(auth(parent))).body)).toBe(true);
  });

  it('transport + payment stubs return valid shapes', async () => {
    expect((await request(app).get(`/api/parent/transport/live?childId=${childId}`).set(auth(parent))).body).toMatchObject({ tripStatus: expect.any(String), stops: expect.any(Array) });
    const order = await request(app).post('/api/parent/fees/payment/order').set(auth(parent)).send({ childId, amount: 5000, selectedDueIds: ['tuition'] });
    expect(order.body).toMatchObject({ orderId: expect.any(String), amount: 5000 });
  });
});
