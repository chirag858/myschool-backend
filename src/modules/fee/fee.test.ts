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

describe('Fee API', () => {
  let acc: string;
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    acc = await token('accountant');
    admin = await token('schooladmin');
  });

  async function class1StudentId(): Promise<string> {
    // Student roster is academic-admin scoped; fetch the id with an admin token.
    const res = await request(app).get('/api/students?classKey=Class 1').set(auth(admin));
    return res.body.rows[0].id;
  }
  async function headId(): Promise<string> {
    const res = await request(app).get('/api/fee/heads').set(auth(acc));
    return res.body[0].id;
  }
  /**
   * collect() now recomputes the total server-side from the real fee
   * structure and rejects a mismatched netPayable (money can no longer be
   * taken from the client — see fee.service.ts's recomputeCollectionTotals).
   * For a single unpaid month on a fresh student, the due amount is just
   * that month's `amount` from GET /fee/pending — fetch it instead of
   * inventing a number.
   */
  async function collectOneMonth(studentId: string, month: string) {
    const context = await request(app).get(`/api/fee/pending/${studentId}`).set(auth(acc));
    const entry = context.body.months.find((m: { month: string }) => m.month === month);
    // See utilize.test.ts's makeReceipt for why previousDues excludes this
    // month's own unpaid share — collect() does the same exclusion.
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
    return request(app)
      .post('/api/fee/collect')
      .set(auth(acc))
      .send({
        studentId,
        months: [month],
        netPayable,
        payments: [{ mode: 'cash', amount: netPayable }],
        paymentDate: TODAY,
      });
  }

  it('requires auth (401) and forbids non-finance roles (403)', async () => {
    expect((await request(app).get('/api/fee/heads')).status).toBe(401);
    const teacher = await token('teacher');
    expect((await request(app).get('/api/fee/heads').set(auth(teacher))).status).toBe(403);
  });

  it('fee heads: list seeded + create/update/delete', async () => {
    const list = await request(app).get('/api/fee/heads').set(auth(acc));
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(3);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), order: expect.any(Number) });

    const create = await request(app).post('/api/fee/heads').set(auth(acc)).send({ name: 'Library Fee', type: 'library', order: 4 });
    expect(create.status).toBe(201);
    const id = create.body.id;
    const upd = await request(app).put(`/api/fee/heads/${id}`).set(auth(acc)).send({ name: 'Library Charges' });
    expect(upd.body.name).toBe('Library Charges');
    const del = await request(app).delete(`/api/fee/heads/${id}`).set(auth(acc));
    expect(del.body.success).toBe(true);
  });

  it('structure: get returns rows/classes/session; save persists', async () => {
    const get = await request(app).get('/api/fee/structure').set(auth(acc));
    expect(get.status).toBe(200);
    expect(get.body).toMatchObject({ session: expect.any(String), classes: expect.any(Array) });
    expect(get.body.rows.length).toBe(3);

    const hid = await headId();
    const save = await request(app)
      .post('/api/fee/structure/save')
      .set(auth(acc))
      .send([{ feeHeadId: hid, frequency: 'monthly', amounts: { 'Class 1': 1500 } }]);
    expect(save.status).toBe(200);
    const row = save.body.rows.find((r: { feeHeadId: string }) => r.feeHeadId === hid);
    expect(row.amounts['Class 1']).toBe(1500);
  });

  it('GET /fee/pending/:studentId returns the student fee context', async () => {
    const sid = await class1StudentId();
    const res = await request(app).get(`/api/fee/pending/${sid}`).set(auth(acc));
    expect(res.status).toBe(200);

    // Principal uses this exact endpoint via the Fee Collection page — must not 403.
    const principal = await token('principal');
    expect((await request(app).get(`/api/fee/pending/${sid}`).set(auth(principal))).status).toBe(200);

    expect(res.body).toMatchObject({
      studentId: sid,
      studentName: expect.any(String),
      className: 'Class 1',
      outstandingBalance: expect.any(Number),
      feeHeads: expect.any(Array),
      months: expect.any(Array),
    });
    expect(res.body.months.length).toBe(12);
    expect(res.body.feeHeads.length).toBeGreaterThan(0);
  });

  it('per-month figures respect fee-head frequency, not just the raw configured amount', async () => {
    // A half-yearly (or quarterly/yearly) head must contribute its share
    // divided across all 12 months — previously the raw `amounts[cls]` was
    // used as-is regardless of frequency, so a half-yearly head configured
    // at, say, 2000 was billed as 2000 EVERY month (24000/year) instead of
    // its true 2000×2/12 ≈ 333/month share (4000/year total contribution).
    const sid = await class1StudentId();
    const res = await request(app).get(`/api/fee/pending/${sid}`).set(auth(acc));
    const sumOfMonthlyHeads = res.body.feeHeads.reduce((s: number, h: { monthlyAmount: number }) => s + h.monthlyAmount, 0);
    // months[].amount is the same monthlyTotal for every month — must equal
    // the annual total (outstandingBalance + already paid) divided by 12,
    // within rounding, for every one of the 12 rows.
    const perMonth = res.body.months[0].amount;
    expect(res.body.months.every((m: { amount: number }) => m.amount === perMonth)).toBe(true);
    expect(perMonth).toBe(sumOfMonthlyHeads);

    // Cross-check against the independently-computed annual total (same
    // annualByClass() helper the parent portal and fee ledger use) — the
    // 12 monthly figures must sum to within a rounding tolerance of it.
    // The old bug (summing raw configured amounts regardless of frequency)
    // would overstate this whenever any head isn't 'monthly' frequency.
    const structureRes = await request(app).get('/api/fee/structure').set(auth(acc));
    const cls1Rows = structureRes.body.rows.filter((r: { amounts: Record<string, number> }) => r.amounts['Class 1'] != null);
    const hasNonMonthlyHead = structureRes.body.rows.some(
      (r: { frequency: string; amounts: Record<string, number> }) => r.amounts['Class 1'] != null && r.frequency !== 'monthly',
    );
    expect(hasNonMonthlyHead).toBe(true); // sanity: this test only proves anything if the seed actually has a mixed-frequency head

    const trueAnnual = cls1Rows.reduce((sum: number, r: { frequency: string; amounts: Record<string, number> }) => {
      const mult = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1, one_time: 1 }[r.frequency] ?? 1;
      return sum + r.amounts['Class 1'] * mult;
    }, 0);
    expect(Math.abs(perMonth * 12 - trueAnnual)).toBeLessThanOrEqual(12); // rounding slack across 12 months

    // And it must NOT equal the old-bug figure: raw configured amounts summed as-is.
    const buggyMonthlyFigure = cls1Rows.reduce((sum: number, r: { amounts: Record<string, number> }) => sum + r.amounts['Class 1'], 0);
    if (buggyMonthlyFigure !== Math.round(trueAnnual / 12)) {
      expect(perMonth).not.toBe(buggyMonthlyFigure);
    }
  });

  it('collect → receipt → list/get/duplicate/cancel, and stats reflect today', async () => {
    const sid = await class1StudentId();
    const collect = await collectOneMonth(sid, 'April');
    expect(collect.status).toBe(201);
    const amount = collect.body.amount;
    expect(amount).toBeGreaterThan(0);
    expect(collect.body).toMatchObject({
      id: expect.any(String),
      receiptNumber: expect.stringMatching(/^RCP-/),
      amount,
      status: 'active',
      paymentMode: 'cash',
    });
    const rid = collect.body.id;

    const list = await request(app).get('/api/fee/receipts').set(auth(acc));
    // 1 just-collected + 1 historical receipt in the demo seed (a parent's paid child).
    expect(list.body.total).toBe(2);

    const get = await request(app).get(`/api/fee/receipts/${rid}`).set(auth(acc));
    expect(get.body.receiptNumber).toBe(collect.body.receiptNumber);

    const dup = await request(app).post(`/api/fee/receipts/${rid}/duplicate`).set(auth(acc));
    expect(dup.body.receiptNumber).toMatch(/-DUP$/);

    const cancel = await request(app).patch(`/api/fee/receipts/${rid}/cancel`).set(auth(acc)).send({ reason: 'Wrong entry' });
    expect(cancel.body).toMatchObject({ status: 'cancelled', cancelledReason: 'Wrong entry' });

    const stats = await request(app).get('/api/fee/stats/today').set(auth(acc));
    // The active duplicate counts for today; the cancelled original does not.
    expect(stats.body.todayCount).toBe(1);
    expect(stats.body.todayCollection).toBe(amount);
  });

  it('GET /fee/ledger computes per-student totals from structure + receipts', async () => {
    const sid = await class1StudentId();
    const collect = await collectOneMonth(sid, 'April');
    expect(collect.status).toBe(201);
    const amount = collect.body.amount as number;

    const res = await request(app).get('/api/fee/ledger').set(auth(acc));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(15);
    const row = res.body.find((r: { studentId: string }) => r.studentId === sid);
    expect(row).toMatchObject({ totalFee: expect.any(Number), paid: amount, status: expect.any(String) });
    expect(row.totalFee).toBeGreaterThan(0);
    expect(row.balance).toBe(Math.max(0, row.totalFee - amount));

    // Month filter: April (the paid month) shows a small monthly due with
    // paid=amount; a different month shows the same monthly due but paid=0 —
    // proving `month` actually changes the numbers, not just annual totals.
    const april = await request(app).get('/api/fee/ledger?month=Apr').set(auth(acc));
    const aprilRow = april.body.find((r: { studentId: string }) => r.studentId === sid);
    expect(aprilRow.totalFee).toBe(Math.round(row.totalFee / 12));
    expect(aprilRow.paid).toBe(amount);
    expect(aprilRow.status).toBe(aprilRow.balance <= 0 ? 'paid' : 'partial');

    const july = await request(app).get('/api/fee/ledger?month=Jul').set(auth(acc));
    const julyRow = july.body.find((r: { studentId: string }) => r.studentId === sid);
    expect(julyRow.totalFee).toBe(aprilRow.totalFee);
    expect(julyRow.paid).toBe(0);
    expect(julyRow.status).toBe('pending');
  });

  it('rejects invalid collect payload (400)', async () => {
    expect((await request(app).post('/api/fee/collect').set(auth(acc)).send({ studentId: 'x' })).status).toBe(400);
  });

  it('GET /fee/student-ledger/:studentId is reachable by principal and coordinator, not just admin/accountant', async () => {
    const studentId = await class1StudentId();
    const principal = await token('principal');
    const coordinator = await token('coordinator');

    const asPrincipal = await request(app).get(`/api/fee/student-ledger/${studentId}`).set(auth(principal));
    expect(asPrincipal.status).toBe(200);
    expect(asPrincipal.body).toMatchObject({ totalFees: expect.any(Number), paid: expect.any(Number), balance: expect.any(Number) });

    const asCoordinator = await request(app).get(`/api/fee/student-ledger/${studentId}`).set(auth(coordinator));
    expect(asCoordinator.status).toBe(200);

    // Every /api/fee/* route now also allows principal — matches every fee
    // screen's frontend ProtectedRoute — but roles outside admin/accountant/
    // principal/coordinator still get 403.
    expect((await request(app).get('/api/fee/heads').set(auth(principal))).status).toBe(200);
    const teacher = await token('teacher');
    expect((await request(app).get(`/api/fee/student-ledger/${studentId}`).set(auth(teacher))).status).toBe(403);
    expect((await request(app).get('/api/fee/heads').set(auth(teacher))).status).toBe(403);
  });
});
