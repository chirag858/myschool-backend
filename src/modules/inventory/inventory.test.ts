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

describe('Inventory API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });
  const itemByName = async (name: string) => {
    const list = await request(app).get('/api/inventory/items').set(auth(admin));
    return list.body.find((i: { name: string }) => i.name === name);
  };

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get('/api/inventory/items')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/inventory/items').set(auth(acc))).status).toBe(403);
  });

  it('dashboard KPI computes categories/low-stock/asset value', async () => {
    const kpi = await request(app).get('/api/inventory/dashboard').set(auth(admin));
    expect(kpi.status).toBe(200);
    expect(kpi.body).toMatchObject({ totalCategories: 1, totalItems: 3, lowStockAlerts: 2, totalAssetsValue: 30000 });
  });

  it('items: list seeded, get, create + edit, status derived from stock', async () => {
    const list = await request(app).get('/api/inventory/items').set(auth(admin));
    expect(list.body.length).toBe(3);
    const chalk = list.body.find((i: { name: string }) => i.name === 'Chalk Box');
    expect(chalk.status).toBe('out_of_stock');

    const create = await request(app)
      .post('/api/inventory/items')
      .set(auth(admin))
      .send({ name: 'Stapler', category: 'stationery', unit: 'piece', currentStock: 3, minStockLevel: 5, unitPrice: 120 });
    expect(create.status).toBe(201);
    expect(create.body.status).toBe('low_stock');

    const edit = await request(app).post('/api/inventory/items').set(auth(admin)).send({ id: create.body.id, name: 'Stapler', currentStock: 30, minStockLevel: 5 });
    expect(edit.body.status).toBe('in_stock');
  });

  it('purchase increases stock and records a movement', async () => {
    const item = await itemByName('A4 Paper Ream');
    const purchase = await request(app)
      .post('/api/inventory/purchase')
      .set(auth(admin))
      .send({
        vendorName: 'Sharma Stationers',
        invoiceNumber: 'INV-100',
        items: [{ itemId: item.id, itemName: item.name, quantity: 20, unitPrice: 250 }],
        subtotal: 5000,
        total: 5000,
      });
    expect(purchase.status).toBe(201);
    expect(purchase.body.stockUpdates[0]).toMatchObject({ itemId: item.id, added: 20, newTotal: 70 });

    const after = await request(app).get(`/api/inventory/items/${item.id}`).set(auth(admin));
    expect(after.body.currentStock).toBe(70);

    const movements = await request(app).get(`/api/inventory/items/${item.id}/movements`).set(auth(admin));
    expect(movements.body[0]).toMatchObject({ type: 'purchase', quantity: 20, balanceAfter: 70 });
  });

  it('issue decreases stock and records a movement', async () => {
    const item = await itemByName('A4 Paper Ream');
    const issue = await request(app)
      .post('/api/inventory/issue')
      .set(auth(admin))
      .send({ issuedTo: 'Mr. Teacher', department: 'Science', purpose: 'Class use', items: [{ itemId: item.id, itemName: item.name, quantity: 10 }] });
    expect(issue.status).toBe(201);
    expect(issue.body).toMatchObject({ status: 'open', itemsCount: 1 });

    const after = await request(app).get(`/api/inventory/items/${item.id}`).set(auth(admin));
    expect(after.body.currentStock).toBe(40);
    const movements = await request(app).get(`/api/inventory/items/${item.id}/movements`).set(auth(admin));
    expect(movements.body[0]).toMatchObject({ type: 'issue', quantity: 10, balanceAfter: 40 });
  });

  it('vendors + assets: list seeded and upsert', async () => {
    const vendors = await request(app).get('/api/inventory/vendors').set(auth(admin));
    expect(vendors.body.length).toBe(1);
    const v = await request(app).post('/api/inventory/vendors').set(auth(admin)).send({ name: 'New Vendor', mobile: '9990001111' });
    expect(v.status).toBe(201);

    const assets = await request(app).get('/api/inventory/assets').set(auth(admin));
    expect(assets.body.length).toBe(1);
    expect(assets.body[0]).toMatchObject({ name: 'Projector', currentValue: 30000 });
    const a = await request(app).post('/api/inventory/assets').set(auth(admin)).send({ name: 'Printer', assetCode: 'AST-002', currentValue: 8000 });
    expect(a.status).toBe(201);
  });

  it('rejects invalid payloads (400)', async () => {
    expect((await request(app).post('/api/inventory/items').set(auth(admin)).send({ category: 'x' })).status).toBe(400);
    expect((await request(app).post('/api/inventory/purchase').set(auth(admin)).send({ vendorName: 'x' })).status).toBe(400);
  });
});
