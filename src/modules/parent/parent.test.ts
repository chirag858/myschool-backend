import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Parent Web API', () => {
  let parent: string;
  let childId: string;
  beforeEach(async () => {
    await seedDemo();
    parent = await token('parent');
    const kids = await request(app).get('/api/parent/children').set(auth(parent));
    childId = kids.body[0].id as string;
  });

  it('requires auth (401) and forbids non-parent roles (403)', async () => {
    expect((await request(app).get('/api/parent/children')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/parent/children').set(auth(acc))).status).toBe(403);
  });

  it('lists the two linked children with today attendance', async () => {
    const res = await request(app).get('/api/parent/children').set(auth(parent));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      className: expect.any(String),
      admissionNumber: expect.any(String),
      todayAttendance: expect.any(String),
    });
  });

  it('fee summary reflects the seeded receipt', async () => {
    const res = await request(app).get(`/api/parent/fee-summary?childId=${childId}`).set(auth(parent));
    expect(res.status).toBe(200);
    expect(res.body.paid).toBe(5000);
    expect(res.body.totalThisSession).toBeGreaterThan(0);
    expect(res.body.balanceDue).toBe(res.body.totalThisSession - 5000);
    expect(res.body.lastPayment).toMatchObject({ amount: 5000, date: '2025-05-10' });
  });

  it('fee monthly returns 12 rows with covered months paid down', async () => {
    const res = await request(app).get(`/api/parent/fee-monthly?childId=${childId}`).set(auth(parent));
    expect(res.body.length).toBe(12);
    const apr = res.body.find((r: { month: string }) => r.month === 'Apr 2025');
    expect(apr.amountPaid).toBeGreaterThan(0);
    expect(apr.receiptNumber).toBe('RCPT-PARENT-001');
  });

  it('attendance returns the child history', async () => {
    const res = await request(app).get(`/api/parent/attendance?childId=${childId}`).set(auth(parent));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length) expect(res.body[0]).toMatchObject({ date: expect.any(String), status: expect.any(String) });
  });

  it('circulars returns published parent-visible notices', async () => {
    const res = await request(app).get('/api/parent/circulars').set(auth(parent));
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.some((c: { title: string }) => c.title === 'Annual Day Notice')).toBe(true);
  });

  it('complaints: lists seeded, submits a new one scoped to the child', async () => {
    const seeded = await request(app).get(`/api/parent/complaints?childId=${childId}`).set(auth(parent));
    expect(seeded.body.length).toBe(1);
    expect(seeded.body[0]).toMatchObject({ subject: 'Bus running late', status: 'in_review' });

    const submit = await request(app)
      .post('/api/parent/complaints')
      .set(auth(parent))
      .send({ childId, subject: 'Lunch quality', category: 'other', description: 'Food was cold today.' });
    expect(submit.status).toBe(201);
    expect(submit.body).toMatchObject({ subject: 'Lunch quality', status: 'submitted', submittedAt: expect.any(String) });

    const after = await request(app).get(`/api/parent/complaints?childId=${childId}`).set(auth(parent));
    expect(after.body.length).toBe(2);
  });

  it('blocks access to a child that is not the parent’s (404)', async () => {
    const notMine = '000000000000000000000000';
    expect((await request(app).get(`/api/parent/fee-summary?childId=${notMine}`).set(auth(parent))).status).toBe(404);
    expect(
      (await request(app).post('/api/parent/complaints').set(auth(parent)).send({ childId: notMine, subject: 'x', category: 'other', description: 'y' })).status,
    ).toBe(404);
  });
});
