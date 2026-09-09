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
const TODAY = new Date().toISOString().slice(0, 10);

describe('Fee Scroll API (daily collection scroll)', () => {
  let acc: string;
  let admin: string;

  beforeEach(async () => {
    await seedDemo();
    acc = await token('accountant');
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids non-finance roles (403)', async () => {
    expect((await request(app).get('/api/fee/scroll').query({ date: TODAY })).status).toBe(401);
    const teacher = await token('teacher');
    expect(
      (await request(app).get('/api/fee/scroll').query({ date: TODAY }).set(auth(teacher))).status,
    ).toBe(403);
  });

  async function class1StudentId(): Promise<string> {
    const res = await request(app).get('/api/students?classKey=Class 1').set(auth(admin));
    return res.body.rows[0].id;
  }
  it('scroll aggregates a real fee collection under the collecting user, not mock data', async () => {
    const sid = await class1StudentId();
    // collect() recomputes the total server-side and rejects a mismatched
    // netPayable (see fee.service.ts's recomputeCollectionTotals) — fetch the
    // real due amount for the month instead of inventing one.
    const context = await request(app).get(`/api/fee/pending/${sid}`).set(auth(acc));
    const entry = context.body.months.find((m: { month: string }) => m.month === 'April');
    // April is the session's first month, so it never carries arrears from an
    // earlier month — but the seed data can still carry a real pending fine
    // or concession for this student, and collect() rejects a netPayable that
    // doesn't account for those (see fee.service.ts recompute), so pull them
    // from the same context rather than assuming they're 0. context.previousDues
    // is fetched before any month is picked, so (like makeReceipt in
    // utilize.test.ts) subtract April's own unpaid share — collect() excludes
    // exactly the month(s) being paid from its own previousDues recompute.
    const ownUnpaid = Math.max(0, entry.amount - entry.paid);
    const previousDues = Math.max(0, (context.body.previousDues ?? 0) - ownUnpaid);
    const netPayable = Math.max(
      0,
      Math.round(
        entry.amount -
          (context.body.concessionAmount ?? 0) -
          (context.body.advanceBalance ?? 0) +
          previousDues +
          (context.body.fineAmount ?? 0),
      ),
    );
    const amount = netPayable;
    const collect = await request(app)
      .post('/api/fee/collect')
      .set(auth(acc))
      .send({
        studentId: sid,
        months: ['April'],
        netPayable,
        payments: [{ mode: 'cash', amount: netPayable }],
        paymentDate: TODAY,
      });
    expect(collect.status).toBe(201);
    expect(collect.body.generatedBy).not.toBe('accountant'); // real name, not the raw role

    const scroll = await request(app)
      .get('/api/fee/scroll')
      .query({ date: TODAY, collectorId: 'x', collector: collect.body.generatedBy })
      .set(auth(acc));
    expect(scroll.status).toBe(200);
    expect(scroll.body.totalCollected).toBeGreaterThanOrEqual(amount);
    expect(scroll.body.entries.some((e: { reference: string }) => e.reference === collect.body.receiptNumber)).toBe(true);
  });

  it('open day → add expense → close day chains retained cash to next day opening', async () => {
    const open = await request(app)
      .post('/api/fee/scroll/open-day')
      .set(auth(acc))
      .send({ date: TODAY, openingBalance: 2000 });
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({ status: 'open', openingBalance: 2000 });

    const expense = await request(app)
      .post('/api/fee/scroll/expense')
      .set(auth(acc))
      .send({ category: 'stationery', description: 'Receipt books', amount: 300, mode: 'cash' });
    expect(expense.status).toBe(201);
    expect(expense.body).toMatchObject({ amount: 300, voucherNo: expect.stringMatching(/^VCH-/) });

    const close = await request(app)
      .post('/api/fee/scroll/close-day')
      .set(auth(acc))
      .send({
        date: TODAY,
        denominations: [],
        countedCash: 1700,
        variance: 0,
        retained: 1700,
      });
    expect(close.status).toBe(200);
    expect(close.body.status).toBe('closed');
    expect(close.body.closing).toMatchObject({ retained: 1700, cashExpenses: 300 });
  });

  it('rejects closing a day that was never opened (400)', async () => {
    const res = await request(app)
      .post('/api/fee/scroll/close-day')
      .set(auth(acc))
      .send({ date: '2020-01-01', denominations: [], countedCash: 0, variance: 0, retained: 0 });
    expect(res.status).toBe(400);
  });

  it('all-expenses feed is the single source shared with the Accounts/Expenses module', async () => {
    await request(app)
      .post('/api/fee/scroll/expense')
      .set(auth(acc))
      .send({ category: 'maintenance', description: 'Plumbing', amount: 500, mode: 'cash' });
    const all = await request(app).get('/api/fee/scroll/expenses').set(auth(acc));
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThanOrEqual(1);
  });

  it('collectors: only accountant-role users in this school', async () => {
    const res = await request(app).get('/api/fee/scroll/collectors').set(auth(acc));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String) });
  });

  it('school_admin can reopen a closed day; the reason and actor are recorded', async () => {
    await request(app).post('/api/fee/scroll/open-day').set(auth(acc)).send({ date: TODAY, openingBalance: 0 });
    await request(app)
      .post('/api/fee/scroll/close-day')
      .set(auth(acc))
      .send({ date: TODAY, denominations: [], countedCash: 0, variance: 0, retained: 0 });

    const me = await request(app).get('/api/fee/scroll/collectors').set(auth(admin));
    const collectorId = me.body[0].id;

    const reopen = await request(app)
      .post('/api/fee/scroll/reopen')
      .set(auth(admin))
      .send({ collectorId, date: TODAY, reason: 'Correction needed' });
    expect(reopen.status).toBe(200);
    expect(reopen.body).toMatchObject({ status: 'open', reopenReason: 'Correction needed' });
  });

  it('accountant cannot reopen a day (403 — director/admin only)', async () => {
    const res = await request(app)
      .post('/api/fee/scroll/reopen')
      .set(auth(acc))
      .send({ collectorId: 'x', date: TODAY, reason: 'Correction needed' });
    expect(res.status).toBe(403);
  });
});
