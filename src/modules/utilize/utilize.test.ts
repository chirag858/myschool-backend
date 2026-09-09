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

describe('Utilize API (receipt corrections + fee readjustments)', () => {
  let acc: string;
  let admin: string;
  let sa: string;
  let eng: string;

  beforeEach(async () => {
    await seedDemo();
    acc = await token('accountant');
    admin = await token('schooladmin');
    sa = await token('superadmin');
    eng = await token('support');
  });

  async function class1StudentId(): Promise<{ id: string; name: string }> {
    const res = await request(app).get('/api/students?classKey=Class 1').set(auth(admin));
    return { id: res.body.rows[0].id, name: res.body.rows[0].name };
  }
  async function anotherStudentId(excludeId: string): Promise<{ id: string; name: string }> {
    const res = await request(app).get('/api/students').set(auth(admin));
    const row = res.body.rows.find((r: { id: string }) => r.id !== excludeId);
    return { id: row.id, name: row.name };
  }
  /**
   * collect() recomputes the total server-side from the real fee structure
   * and rejects a mismatched netPayable (see fee.service.ts's
   * recomputeCollectionTotals) — a test can no longer hand it an arbitrary
   * amount. `correction.amount` in the tests below is a separate, unchecked
   * field the utilize service uses only to decide direct-apply vs
   * approval-queue (`canApplyDirectly`); it's never compared against the
   * receipt's real stored amount, so those literals stay meaningful on
   * their own. Every month reports the same monthlyTotal (no concessions in
   * the seed), so two receipts for the same student on different months
   * still land on the same amount — that's what the duplicate-finder test
   * below relies on.
   */
  async function makeReceipt(
    studentId: string,
    month = 'April',
  ): Promise<{ id: string; receiptNumber: string; amount: number }> {
    const context = await request(app).get(`/api/fee/pending/${studentId}`).set(auth(acc));
    const entry = context.body.months.find((m: { month: string }) => m.month === month);
    const amount = entry.amount;
    // context.previousDues (fetched before any month is picked) counts every
    // overdue-and-unpaid month, including `month` itself if it qualifies —
    // collect() excludes exactly the month(s) being paid from its own
    // previousDues recompute, so subtract this month's own unpaid share
    // before sending, or the strict server-side recompute in collect()
    // rejects a mismatched netPayable (see fee.service.ts recompute).
    const ownUnpaid = Math.max(0, entry.amount - entry.paid);
    const previousDues = Math.max(0, (context.body.previousDues ?? 0) - ownUnpaid);
    const netPayable = Math.max(
      0,
      Math.round(
        amount -
          (context.body.concessionAmount ?? 0) -
          (context.body.advanceBalance ?? 0) +
          previousDues +
          (context.body.fineAmount ?? 0),
      ),
    );
    const res = await request(app)
      .post('/api/fee/collect')
      .set(auth(acc))
      .send({
        studentId,
        months: [month],
        netPayable,
        payments: [{ mode: 'cash', amount: netPayable }],
        paymentDate: TODAY,
      });
    return { id: res.body.id, receiptNumber: res.body.receiptNumber, amount: netPayable };
  }

  it('requires auth (401) and forbids non-utilize roles (403)', async () => {
    expect((await request(app).get('/api/utilize/receipt/search')).status).toBe(401);
    const teacher = await token('teacher');
    expect((await request(app).get('/api/utilize/receipt/search').set(auth(teacher))).status).toBe(403);
  });

  it('searchReceipts + getDuplicates return real receipt data', async () => {
    const { id: sid } = await class1StudentId();
    await makeReceipt(sid);
    const search = await request(app).get('/api/utilize/receipt/search').query({ q: 'Class 1' }).set(auth(admin));
    expect(search.status).toBe(200);
    expect(Array.isArray(search.body)).toBe(true);
  });

  it('searchStudents works cross-tenant for support_engineer/super_admin, unlike the tenant-only /api/students list', async () => {
    const { id: sid, name } = await class1StudentId();
    // support_engineer and super_admin have no schoolId — /api/students 403s them.
    expect((await request(app).get('/api/students').set(auth(eng))).status).toBe(403);
    const asEng = await request(app).get('/api/utilize/students/search').query({ q: name.slice(0, 3) }).set(auth(eng));
    expect(asEng.status).toBe(200);
    expect(asEng.body.some((s: { id: string }) => s.id === sid)).toBe(true);
    const asSa = await request(app).get('/api/utilize/students/search').query({ q: name.slice(0, 3) }).set(auth(sa));
    expect(asSa.status).toBe(200);
    expect(asSa.body.some((s: { id: string }) => s.id === sid)).toBe(true);
  });

  it('cancel: submitCorrection actually cancels the real receipt (small amount → direct)', async () => {
    const { id: sid } = await class1StudentId();
    const receipt = await makeReceipt(sid);
    const res = await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'cancel',
        recordRef: receipt.receiptNumber,
        targetId: receipt.id,
        studentId: sid,
        studentName: 'x',
        oldValue: { status: 'active' },
        newValue: { status: 'cancelled' },
        reasonCode: 'other',
        reason: 'Duplicate payment cancelled during audit review',
        amount: 500,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('applied');
    const receiptGet = await request(app).get(`/api/fee/receipts/${receipt.id}`).set(auth(acc));
    expect(receiptGet.body.status).toBe('cancelled');
  });

  it('edit: updates the real receipt remarks field', async () => {
    const { id: sid } = await class1StudentId();
    const receipt = await makeReceipt(sid);
    const res = await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'edit',
        recordRef: receipt.receiptNumber,
        targetId: receipt.id,
        studentId: sid,
        studentName: 'x',
        oldValue: { version: 'v1', remarks: '' },
        newValue: { version: 'v2', remarks: 'Corrected month coverage per parent request' },
        reasonCode: 'other',
        reason: 'Parent flagged incorrect remarks on the receipt',
        amount: 0,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('applied');
    const receiptGet = await request(app).get(`/api/fee/receipts/${receipt.id}`).set(auth(acc));
    expect(receiptGet.body.remarks).toBe('Corrected month coverage per parent request');
  });

  it('reverse: creates a real offsetting negative receipt and marks the original reversed', async () => {
    const { id: sid } = await class1StudentId();
    const receipt = await makeReceipt(sid);
    const res = await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'reverse',
        recordRef: receipt.receiptNumber,
        targetId: receipt.id,
        studentId: sid,
        studentName: 'x',
        oldValue: { amount: receipt.amount, status: 'active' },
        newValue: { amount: -receipt.amount, status: 'reversed' },
        reasonCode: 'wrong_amount',
        reason: 'Payment amount was entered incorrectly, reversing entry',
        // `amount` only drives canApplyDirectly's threshold check (see the
        // makeReceipt doc comment) — it's never cross-checked against the
        // receipt's real stored amount, which can now include real arrears
        // and so exceed the approval threshold on its own. Keep this small
        // so the test exercises the direct-apply path it's named for.
        amount: 500,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('applied');
    const original = await request(app).get(`/api/fee/receipts/${receipt.id}`).set(auth(acc));
    expect(original.body.status).toBe('reversed');
    const list = await request(app).get('/api/fee/receipts').set(auth(acc)).query({ search: `${receipt.receiptNumber}-REV` });
    expect(list.body.rows.length).toBe(1);
    expect(list.body.rows[0].amount).toBe(-receipt.amount);
  });

  it('reverse: a second reversal is refused with a clear message, not a raw duplicate-key conflict', async () => {
    const { id: sid } = await class1StudentId();
    const receipt = await makeReceipt(sid);
    const body = {
      category: 'receipt',
      action: 'reverse',
      recordRef: receipt.receiptNumber,
      targetId: receipt.id,
      studentId: sid,
      studentName: 'x',
      oldValue: { amount: receipt.amount, status: 'active' },
      newValue: { amount: -receipt.amount, status: 'reversed' },
      reasonCode: 'wrong_amount',
      reason: 'Payment amount was entered incorrectly, reversing entry',
      // See the reverse test above — keep small so this stays a direct apply.
      amount: 500,
    };
    expect((await request(app).post('/api/utilize/corrections').set(auth(admin)).send(body)).status).toBe(201);
    const second = await request(app).post('/api/utilize/corrections').set(auth(admin)).send(body);
    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/already been reversed|active receipt/i);
    // Only one reversal receipt exists — the failed retry created nothing.
    const list = await request(app).get('/api/fee/receipts').set(auth(acc)).query({ search: `${receipt.receiptNumber}-REV` });
    expect(list.body.rows.length).toBe(1);
  });

  it('a reversed receipt drops out of the duplicate finder so it cannot be reversed again from the UI', async () => {
    const { id: sid } = await class1StudentId();
    // Same amount + same day is what the duplicate finder keys on (not
    // month). With real previousDues now in play, April's and May's natural
    // totals no longer match on their own (paying April first settles one
    // fewer month of arrears than paying May second sees) — so waive each
    // one down to the same fixed check amount instead of relying on the
    // months' raw totals lining up.
    const CHECK_AMOUNT = 500;
    async function makeCheckReceipt(month: string) {
      const context = await request(app).get(`/api/fee/pending/${sid}`).set(auth(acc));
      const entry = context.body.months.find((m: { month: string }) => m.month === month);
      const ownUnpaid = Math.max(0, entry.amount - entry.paid);
      const previousDues = Math.max(0, (context.body.previousDues ?? 0) - ownUnpaid);
      const preWaive =
        entry.amount - (context.body.concessionAmount ?? 0) - (context.body.advanceBalance ?? 0) + previousDues + (context.body.fineAmount ?? 0);
      const waiveOffAmount = Math.max(0, Math.round(preWaive) - CHECK_AMOUNT);
      const res = await request(app)
        .post('/api/fee/collect')
        .set(auth(acc))
        .send({
          studentId: sid,
          months: [month],
          netPayable: CHECK_AMOUNT,
          payments: [{ mode: 'cash', amount: CHECK_AMOUNT }],
          paymentDate: TODAY,
          waiveOffAmount,
          waiveOffReason: 'Test fixture — normalized to a fixed check amount',
        });
      return { id: res.body.id as string, receiptNumber: res.body.receiptNumber as string, amount: res.body.amount as number };
    }
    const first = await makeCheckReceipt('April');
    const second = await makeCheckReceipt('May');
    expect(first.amount).toBe(CHECK_AMOUNT);
    expect(second.amount).toBe(CHECK_AMOUNT);
    const before = await request(app).get('/api/utilize/duplicates').set(auth(admin));
    expect(before.body.length).toBe(1);
    await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'reverse',
        recordRef: first.receiptNumber,
        targetId: first.id,
        studentId: sid,
        studentName: 'x',
        oldValue: { amount: first.amount, status: 'active' },
        newValue: { amount: -first.amount, status: 'reversed' },
        reasonCode: 'duplicate',
        reason: 'Duplicate entry captured twice on the same day, reversing',
        amount: first.amount,
      });
    const after = await request(app).get('/api/utilize/duplicates').set(auth(admin));
    expect(after.body.length).toBe(0);
  });

  it('regenerate: reuses duplicateReceipt — original marked duplicate_issued, new active receipt created', async () => {
    const { id: sid } = await class1StudentId();
    const receipt = await makeReceipt(sid);
    const res = await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'regenerate',
        recordRef: receipt.receiptNumber,
        targetId: receipt.id,
        studentId: sid,
        studentName: 'x',
        oldValue: { reversedAgainst: receipt.receiptNumber },
        newValue: { correctedReceipt: `${receipt.receiptNumber}-C` },
        reasonCode: 'other',
        reason: 'Receipt needed correction so a fresh copy was regenerated',
        amount: 0,
      });
    expect(res.status).toBe(201);
    const original = await request(app).get(`/api/fee/receipts/${receipt.id}`).set(auth(acc));
    expect(original.body.status).toBe('duplicate_issued');
  });

  it('transfer: moves the real receipt to another student', async () => {
    const first = await class1StudentId();
    const second = await anotherStudentId(first.id);
    const receipt = await makeReceipt(first.id);
    const res = await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'transfer',
        recordRef: receipt.receiptNumber,
        targetId: receipt.id,
        studentId: first.id,
        studentName: first.name,
        oldValue: { student: first.name },
        newValue: { student: second.name, studentId: second.id },
        reasonCode: 'wrong_student',
        reason: 'Receipt was recorded against the wrong sibling by mistake',
        amount: 400,
      });
    expect(res.status).toBe(201);
    const receiptGet = await request(app).get(`/api/fee/receipts/${receipt.id}`).set(auth(acc));
    expect(receiptGet.body.studentId).toBe(second.id);
  });

  it('sensitive/over-threshold corrections queue for approval instead of applying immediately', async () => {
    const { id: sid } = await class1StudentId();
    const receipt = await makeReceipt(sid);
    const res = await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'cancel',
        recordRef: receipt.receiptNumber,
        targetId: receipt.id,
        studentId: sid,
        studentName: 'x',
        oldValue: { status: 'active' },
        newValue: { status: 'cancelled' },
        reasonCode: 'other',
        reason: 'Large cancellation needs independent review before applying',
        amount: 9000,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending_approval');
    // Not actually applied yet — receipt is still active.
    const receiptGet = await request(app).get(`/api/fee/receipts/${receipt.id}`).set(auth(acc));
    expect(receiptGet.body.status).toBe('active');
  });

  it('only super_admin can approve/reject — school_admin and support_engineer are forbidden even though they can submit', async () => {
    const { id: sid } = await class1StudentId();
    const receipt = await makeReceipt(sid);
    const submit = await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'cancel',
        recordRef: receipt.receiptNumber,
        targetId: receipt.id,
        studentId: sid,
        studentName: 'x',
        oldValue: { status: 'active' },
        newValue: { status: 'cancelled' },
        reasonCode: 'other',
        reason: 'Large cancellation needs independent review before applying',
        amount: 9000,
      });
    const id = submit.body.id;

    expect(
      (await request(app).patch(`/api/utilize/approval/${id}/approve`).set(auth(admin)).send({ remarks: '' })).status,
    ).toBe(403);
    expect(
      (await request(app).patch(`/api/utilize/approval/${id}/approve`).set(auth(eng)).send({ remarks: '' })).status,
    ).toBe(403);

    const approved = await request(app)
      .patch(`/api/utilize/approval/${id}/approve`)
      .set(auth(sa))
      .send({ remarks: 'Reviewed and confirmed' });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('applied');

    // Mutation only actually applied now, at approval time.
    const receiptGet = await request(app).get(`/api/fee/receipts/${receipt.id}`).set(auth(acc));
    expect(receiptGet.body.status).toBe('cancelled');
  });

  it('rejecting a queued correction never applies the underlying mutation', async () => {
    const { id: sid } = await class1StudentId();
    const receipt = await makeReceipt(sid);
    const submit = await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'cancel',
        recordRef: receipt.receiptNumber,
        targetId: receipt.id,
        studentId: sid,
        studentName: 'x',
        oldValue: { status: 'active' },
        newValue: { status: 'cancelled' },
        reasonCode: 'other',
        reason: 'Large cancellation needs independent review before applying',
        amount: 9000,
      });
    const id = submit.body.id;

    const rejected = await request(app)
      .patch(`/api/utilize/approval/${id}/reject`)
      .set(auth(sa))
      .send({ reason: 'Not a valid correction — receipt is legitimate' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('rejected');

    const receiptGet = await request(app).get(`/api/fee/receipts/${receipt.id}`).set(auth(acc));
    expect(receiptGet.body.status).toBe('active');
  });

  it('cannot approve/reject an already-decided correction twice', async () => {
    const { id: sid } = await class1StudentId();
    const receipt = await makeReceipt(sid);
    const submit = await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'cancel',
        recordRef: receipt.receiptNumber,
        targetId: receipt.id,
        studentId: sid,
        studentName: 'x',
        oldValue: { status: 'active' },
        newValue: { status: 'cancelled' },
        reasonCode: 'other',
        reason: 'Large cancellation needs independent review before applying',
        amount: 9000,
      });
    const id = submit.body.id;
    await request(app).patch(`/api/utilize/approval/${id}/approve`).set(auth(sa)).send({ remarks: '' });

    const again = await request(app).patch(`/api/utilize/approval/${id}/approve`).set(auth(sa)).send({ remarks: '' });
    expect(again.status).toBe(400);
  });

  it('readjustment: fine (small amount, direct) writes a real ReadjustmentModel entry visible in fee-adjust history', async () => {
    const { id: sid, name } = await class1StudentId();
    const res = await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'readjustment',
        action: 'fine',
        recordRef: `LED-${sid}`,
        studentId: sid,
        studentName: name,
        oldValue: { value: '100' },
        newValue: { value: '150' },
        reasonCode: 'wrong_fine',
        reason: 'Fine amount recalculated after late-fee waiver review',
        amount: 50,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('applied');

    const history = await request(app).get('/api/fee/readjustments/history').set(auth(admin));
    expect(history.status).toBe(200);
    const row = history.body.find((h: { studentName: string; type: string }) => h.studentName === name && h.type === 'fine');
    expect(row).toBeTruthy();
    expect(row.oldValue).toBe('100');
    expect(row.newValue).toBe('150');
    expect(row.difference).toBe('50');
  });

  it('readjustment: concession (sensitive type) always queues for approval, and applies to the real ReadjustmentModel only once approved', async () => {
    const { id: sid, name } = await class1StudentId();
    const submit = await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'readjustment',
        action: 'concession',
        recordRef: `LED-${sid}`,
        studentId: sid,
        studentName: name,
        oldValue: { value: '0' },
        newValue: { value: '2000' },
        reasonCode: 'wrong_concession',
        reason: 'Sibling concession was missed during original fee setup',
        amount: 2000,
      });
    expect(submit.status).toBe(201);
    expect(submit.body.status).toBe('pending_approval');

    const historyBefore = await request(app).get('/api/fee/readjustments/history').set(auth(admin));
    expect(
      historyBefore.body.some((h: { studentName: string; type: string }) => h.studentName === name && h.type === 'concession'),
    ).toBe(false);

    await request(app)
      .patch(`/api/utilize/approval/${submit.body.id}/approve`)
      .set(auth(sa))
      .send({ remarks: 'Confirmed sibling concession policy applies' });

    const historyAfter = await request(app).get('/api/fee/readjustments/history').set(auth(admin));
    expect(
      historyAfter.body.some((h: { studentName: string; type: string }) => h.studentName === name && h.type === 'concession'),
    ).toBe(true);
  });

  it('audit log lists submitted corrections', async () => {
    const { id: sid } = await class1StudentId();
    const receipt = await makeReceipt(sid);
    await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'cancel',
        recordRef: receipt.receiptNumber,
        targetId: receipt.id,
        studentId: sid,
        studentName: 'x',
        oldValue: { status: 'active' },
        newValue: { status: 'cancelled' },
        reasonCode: 'other',
        reason: 'Duplicate payment cancelled during audit review',
        amount: 300,
      });
    const log = await request(app).get('/api/utilize/audit-log').set(auth(admin));
    expect(log.status).toBe(200);
    expect(log.body.some((e: { recordRef: string }) => e.recordRef === receipt.receiptNumber)).toBe(true);
  });

  it('audit log Excel/PDF export produces real downloadable files, not a stub', async () => {
    const { id: sid } = await class1StudentId();
    const receipt = await makeReceipt(sid);
    await request(app)
      .post('/api/utilize/corrections')
      .set(auth(admin))
      .send({
        category: 'receipt',
        action: 'cancel',
        recordRef: receipt.receiptNumber,
        targetId: receipt.id,
        studentId: sid,
        studentName: 'x',
        oldValue: { status: 'active' },
        newValue: { status: 'cancelled' },
        reasonCode: 'other',
        reason: 'Duplicate payment cancelled during audit review',
        amount: 300,
      });

    const excel = await request(app).get('/api/utilize/audit-log/export').query({ format: 'excel' }).set(auth(admin));
    expect(excel.status).toBe(200);
    expect(excel.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const pdf = await request(app).get('/api/utilize/audit-log/export').query({ format: 'pdf' }).set(auth(admin));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });
});
