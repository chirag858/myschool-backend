import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password: 'demo1234', captcha: 'x' });
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

  it('collect → receipt → list/get/duplicate/cancel, and stats reflect today', async () => {
    const sid = await class1StudentId();
    const hid = await headId();
    const collect = await request(app)
      .post('/api/fee/collect')
      .set(auth(acc))
      .send({
        studentId: sid,
        months: ['April'],
        feeHeads: [{ id: hid, amount: 1300 }],
        netPayable: 1300,
        payments: [{ mode: 'cash', amount: 1300 }],
        paymentDate: TODAY,
      });
    expect(collect.status).toBe(201);
    expect(collect.body).toMatchObject({
      id: expect.any(String),
      receiptNumber: expect.stringMatching(/^RCP-/),
      amount: 1300,
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
    // The active duplicate (1300) counts for today; the cancelled original does not.
    expect(stats.body.todayCount).toBe(1);
    expect(stats.body.todayCollection).toBe(1300);
  });

  it('GET /fee/ledger computes per-student totals from structure + receipts', async () => {
    const sid = await class1StudentId();
    const hid = await headId();
    await request(app)
      .post('/api/fee/collect')
      .set(auth(acc))
      .send({ studentId: sid, months: ['April'], feeHeads: [{ id: hid, amount: 5000 }], netPayable: 5000, payments: [{ mode: 'cash', amount: 5000 }], paymentDate: TODAY });

    const res = await request(app).get('/api/fee/ledger').set(auth(acc));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(15);
    const row = res.body.find((r: { studentId: string }) => r.studentId === sid);
    expect(row).toMatchObject({ totalFee: expect.any(Number), paid: 5000, status: expect.any(String) });
    expect(row.totalFee).toBeGreaterThan(0);
    expect(row.balance).toBe(Math.max(0, row.totalFee - 5000));
  });

  it('rejects invalid collect payload (400)', async () => {
    expect((await request(app).post('/api/fee/collect').set(auth(acc)).send({ studentId: 'x' })).status).toBe(400);
  });
});
