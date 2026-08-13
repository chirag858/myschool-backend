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

describe('Fee Refund Requests API', () => {
  let acc: string;
  let director: string;
  let studentId: string;
  beforeEach(async () => {
    await seedDemo();
    acc = await token('accountant');
    // Approve/reject is director-level by design ("accountant raises but never decides").
    director = await token('schooladmin');
    const q = await request(app).get('/api/fee/refund-requests').set(auth(acc));
    studentId = q.body[0].studentId as string;
  });

  it('requires auth (401) and forbids non-finance roles (403)', async () => {
    expect((await request(app).get('/api/fee/refund-requests')).status).toBe(401);
    const teacher = await token('teacher');
    expect((await request(app).get('/api/fee/refund-requests').set(auth(teacher))).status).toBe(403);
  });

  it('lists seeded requests (raisedByMe for the requester), filter raisedBy=me', async () => {
    const all = await request(app).get('/api/fee/refund-requests').set(auth(acc));
    expect(all.body.length).toBe(2);
    expect(all.body[0]).toMatchObject({ id: expect.any(String), amount: expect.any(Number), raisedByMe: true, status: expect.any(String) });
    const mine = await request(app).get('/api/fee/refund-requests?raisedBy=me').set(auth(acc));
    expect(mine.body.length).toBe(2);
  });

  it('creates a request, approves/rejects, and cancels', async () => {
    const create = await request(app)
      .post('/api/fee/refund-requests')
      .set(auth(acc))
      .send({ studentId, studentName: 'Test Kid', className: 'Class 1', amount: 500, refundMode: 'online', reference: 'NEFT-9', reason: 'Overpaid' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ status: 'pending_approval', amount: 500, raisedByMe: true, requestedBy: expect.any(String) });

    const approve = await request(app).patch(`/api/fee/refund-requests/${create.body.id}/decide`).set(auth(director)).send({ action: 'approve' });
    expect(approve.body).toMatchObject({ status: 'approved', approvedBy: expect.any(String), approvedAt: expect.any(String) });

    const list2 = await request(app).get('/api/fee/refund-requests').set(auth(acc));
    expect(list2.body.length).toBe(3);

    expect((await request(app).delete(`/api/fee/refund-requests/${create.body.id}`).set(auth(acc))).status).toBe(204);
    expect((await request(app).get('/api/fee/refund-requests').set(auth(acc))).body.length).toBe(2);
    // Cancelling a non-existent / not-owned request → 404
    expect((await request(app).delete('/api/fee/refund-requests/000000000000000000000000').set(auth(acc))).status).toBe(404);
  });

  it('rejects a request with a reason', async () => {
    const pending = (await request(app).get('/api/fee/refund-requests').set(auth(acc))).body.find((r: { status: string }) => r.status === 'pending_approval');
    const reject = await request(app).patch(`/api/fee/refund-requests/${pending.id}/decide`).set(auth(director)).send({ action: 'reject', reason: 'Not eligible' });
    expect(reject.body).toMatchObject({ status: 'rejected', rejectionReason: 'Not eligible', rejectedAt: expect.any(String) });
  });
});
