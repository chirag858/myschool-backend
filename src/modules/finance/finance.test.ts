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

describe('Finance API (bank deposits + income + vendor payments)', () => {
  let acc: string;
  beforeEach(async () => {
    await seedDemo();
    acc = await token('accountant');
  });

  it('requires auth (401) and forbids non-finance roles (403)', async () => {
    expect((await request(app).get('/api/bank/accounts')).status).toBe(401);
    const teacher = await token('teacher');
    expect((await request(app).get('/api/bank/accounts').set(auth(teacher))).status).toBe(403);
  });

  it('bank accounts + deposits: list seeded, record (snapshots bank), stats', async () => {
    const accounts = await request(app).get('/api/bank/accounts').set(auth(acc));
    expect(accounts.body.length).toBe(2);
    expect(accounts.body[0]).toMatchObject({ id: expect.any(String), bankName: expect.any(String), accountLast4: expect.any(String) });

    const before = await request(app).get('/api/bank/deposits').set(auth(acc));
    expect(before.body.length).toBe(1);

    const sbi = accounts.body.find((a: { bankName: string }) => a.bankName === 'SBI');
    const record = await request(app)
      .post('/api/bank/deposits')
      .set(auth(acc))
      .send({ depositDate: '2026-07-10', recipientType: 'bank', bankAccountId: sbi.id, amount: 30000, slipNumber: 'SLP-NEW' });
    expect(record.status).toBe(201);
    expect(record.body).toMatchObject({ amount: 30000, bankName: 'SBI', depositedBy: expect.any(String), createdAt: expect.any(String) });

    const after = await request(app).get('/api/bank/deposits').set(auth(acc));
    expect(after.body.length).toBe(2);

    const stats = await request(app).get('/api/bank/deposits/stats').set(auth(acc));
    expect(stats.body).toMatchObject({ allTimeTotal: 80000, count: 2 });
  });

  it('rejects a bank deposit with an unknown account (400)', async () => {
    const res = await request(app)
      .post('/api/bank/deposits')
      .set(auth(acc))
      .send({ depositDate: '2026-07-10', recipientType: 'bank', bankAccountId: '000000000000000000000000', amount: 1000 });
    expect(res.status).toBe(400);
  });

  it('income: list seeded + add', async () => {
    const list = await request(app).get('/api/expenses/income').set(auth(acc));
    expect(list.body.length).toBe(1);
    expect(list.body[0]).toMatchObject({ source: 'donation', amount: 25000 });
    const add = await request(app)
      .post('/api/expenses/income')
      .set(auth(acc))
      .send({ source: 'rent', description: 'Hall rent', amount: 8000, mode: 'cash' });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ source: 'rent', amount: 8000, date: expect.any(String), createdBy: expect.any(String) });
  });

  it('vendor payments: list seeded + record', async () => {
    const list = await request(app).get('/api/expenses/vendor-payments').set(auth(acc));
    expect(list.body.length).toBe(1);
    const rec = await request(app)
      .post('/api/expenses/vendor-payments')
      .set(auth(acc))
      .send({ vendorId: 'v1', vendorName: 'ABC Supplies', amount: 12000, mode: 'online', reference: 'TXN123' });
    expect(rec.status).toBe(201);
    expect(rec.body).toMatchObject({ vendorName: 'ABC Supplies', amount: 12000, reference: 'TXN123' });
  });

  it('rejects invalid income payload (400)', async () => {
    expect((await request(app).post('/api/expenses/income').set(auth(acc)).send({ amount: 100 })).status).toBe(400);
  });

  it('principal (not just school_admin/accountant) can reach income + vendor-payments', async () => {
    const principal = await token('principal');
    const income = await request(app).get('/api/expenses/income').set(auth(principal));
    expect(income.status).toBe(200);
    expect(income.body.length).toBeGreaterThan(0);

    const vendorPayments = await request(app).get('/api/expenses/vendor-payments').set(auth(principal));
    expect(vendorPayments.status).toBe(200);
    expect(vendorPayments.body.length).toBeGreaterThan(0);
  });
});
