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

describe('Fee Adjustments API (readjustments + waive-offs + reports)', () => {
  let acc: string;
  let studentId: string;
  beforeEach(async () => {
    await seedDemo();
    acc = await token('accountant');
    const queue = await request(app).get('/api/fee/waive-off/queue').set(auth(acc));
    studentId = queue.body[0].studentId as string;
  });

  it('requires auth (401) and forbids non-finance roles (403)', async () => {
    expect((await request(app).get('/api/fee/readjustments/history')).status).toBe(401);
    const teacher = await token('teacher');
    expect((await request(app).get('/api/fee/readjustments/history').set(auth(teacher))).status).toBe(403);
  });

  it('readjustments: create audits the actor; history lists seeded + created', async () => {
    const history = await request(app).get('/api/fee/readjustments/history').set(auth(acc));
    expect(history.body.length).toBe(1);

    const create = await request(app)
      .post('/api/fee/readjustments/refund')
      .set(auth(acc))
      .send({ studentName: 'Test Kid', className: 'Class 1', oldValue: '3000', newValue: '2500', difference: '-500', reason: 'Overcharge refund' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ type: 'refund', reason: 'Overcharge refund', performedBy: expect.any(String), date: expect.any(String) });
    expect((await request(app).get('/api/fee/readjustments/history').set(auth(acc))).body.length).toBe(2);
  });

  it('waive-off: seeded queue, request (self-apply + queued), approve, reject, history', async () => {
    const queue = await request(app).get('/api/fee/waive-off/queue').set(auth(acc));
    expect(queue.body.length).toBe(2);
    const pending = await request(app).get('/api/fee/waive-off/queue?status=pending_approval').set(auth(acc));
    expect(pending.body.length).toBe(1);
    const pendingId = pending.body[0].id;

    const selfApplied = await request(app)
      .post('/api/fee/waive-off/request')
      .set(auth(acc))
      .send({ studentId, studentName: 'X', className: 'Class 1', type: 'partial', amount: 500, reasonCode: 'other', reason: 'small', selfApprove: true });
    expect(selfApplied.body).toMatchObject({ status: 'applied', approvedBy: expect.any(String), appliedAt: expect.any(String) });

    const queued = await request(app)
      .post('/api/fee/waive-off/request')
      .set(auth(acc))
      .send({ studentId, studentName: 'Y', className: 'Class 1', type: 'partial', amount: 900, reasonCode: 'other', reason: 'needs approval', selfApprove: false });
    expect(queued.body).toMatchObject({ status: 'pending_approval' });

    const approve = await request(app).patch(`/api/fee/waive-off/${queued.body.id}/approve`).set(auth(acc)).send({ remarks: 'ok' });
    expect(approve.body).toMatchObject({ status: 'applied', approvedBy: expect.any(String) });

    const reject = await request(app).patch(`/api/fee/waive-off/${pendingId}/reject`).set(auth(acc)).send({ reason: 'insufficient grounds' });
    expect(reject.body).toMatchObject({ status: 'rejected', rejectedReason: 'insufficient grounds' });

    const hist = await request(app).get('/api/fee/waive-off/history').set(auth(acc));
    // seeded-applied (1) + self-applied (1) + approved (1) = 3 applied
    expect(hist.body.length).toBe(3);
    expect(hist.body.every((w: { status: string }) => w.status === 'applied')).toBe(true);
  });

  it('reports: daily, defaulters, monthly, waive-off, scroll, ledger return tabular shapes', async () => {
    for (const type of ['daily', 'defaulters', 'monthly', 'waive-off', 'cancellations', 'collection-summary', 'ledger']) {
      const res = await request(app).get(`/api/fee/reports/${type}`).set(auth(acc));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ title: expect.any(String), columns: expect.any(Array), rows: expect.any(Array) });
    }
    const waive = await request(app).get('/api/fee/reports/waive-off').set(auth(acc));
    // one applied waive-off seeded → at least one row + totals
    expect(waive.body.rows.length).toBeGreaterThanOrEqual(1);
    expect(waive.body.totals).toBeTruthy();
  });
});
