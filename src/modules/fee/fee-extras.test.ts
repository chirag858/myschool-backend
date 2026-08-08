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

describe('Fee Extras API (fines + concessions)', () => {
  let acc: string;
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    acc = await token('accountant');
    admin = await token('schooladmin');
  });
  const studentId = async () => {
    const res = await request(app).get('/api/students?classKey=Class 2').set(auth(admin));
    return res.body.rows[0];
  };

  it('requires auth (401) and forbids non-finance roles (403)', async () => {
    expect((await request(app).get('/api/fee/fine-rules')).status).toBe(401);
    const teacher = await token('teacher');
    expect((await request(app).get('/api/fee/fine-rules').set(auth(teacher))).status).toBe(403);
  });

  it('fine rules: list seeded + create/update/delete', async () => {
    const list = await request(app).get('/api/fee/fine-rules').set(auth(acc));
    expect(list.body.length).toBe(1);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), name: 'Late Fee', value: 100 });

    const create = await request(app).post('/api/fee/fine-rules').set(auth(acc)).send({ name: 'Cheque Bounce', type: 'fixed', value: 250 });
    expect(create.status).toBe(201);
    const upd = await request(app).put(`/api/fee/fine-rules/${create.body.id}`).set(auth(acc)).send({ value: 300 });
    expect(upd.body.value).toBe(300);
    expect((await request(app).delete(`/api/fee/fine-rules/${create.body.id}`).set(auth(acc))).body.success).toBe(true);
  });

  it('applied fines: list seeded + waive', async () => {
    const list = await request(app).get('/api/fee/applied-fines').set(auth(acc));
    expect(list.body.length).toBe(1);
    const waive = await request(app).patch(`/api/fee/applied-fines/${list.body[0].id}/waive`).set(auth(acc)).send({ reason: 'Genuine hardship' });
    expect(waive.body).toMatchObject({ status: 'waived', waivedReason: 'Genuine hardship' });
  });

  it('concessions: list seeded + create (auto code) + update + delete', async () => {
    const list = await request(app).get('/api/fee/concessions').set(auth(acc));
    expect(list.body.length).toBe(2);

    const create = await request(app).post('/api/fee/concessions').set(auth(acc)).send({ name: 'Merit Scholarship', category: 'merit', calcType: 'percentage', value: 25 });
    expect(create.status).toBe(201);
    expect(create.body.code).toMatch(/^CON\d{3}$/);
    const upd = await request(app).put(`/api/fee/concessions/${create.body.id}`).set(auth(acc)).send({ value: 30 });
    expect(upd.body.value).toBe(30);
    expect((await request(app).delete(`/api/fee/concessions/${create.body.id}`).set(auth(acc))).body.success).toBe(true);
  });

  it('apply concession: no-approval → active; approval-required → pending + review approves it', async () => {
    const concessions = await request(app).get('/api/fee/concessions').set(auth(acc));
    const sibling = concessions.body.find((c: { name: string }) => c.name === 'Sibling Discount');
    const staffChild = concessions.body.find((c: { name: string }) => c.name === 'Staff Child');
    const student = await studentId();

    const applySibling = await request(app)
      .post('/api/fee/concessions/applied')
      .set(auth(acc))
      .send({ concessionId: sibling.id, studentId: student.id, studentName: student.name, className: student.className, effectiveFrom: '2025-04-01' });
    expect(applySibling.status).toBe(201);
    expect(applySibling.body.approvalStatus).toBe('active');

    const applyStaff = await request(app)
      .post('/api/fee/concessions/applied')
      .set(auth(acc))
      .send({ concessionId: staffChild.id, studentId: student.id, studentName: student.name, className: student.className, effectiveFrom: '2025-04-01' });
    expect(applyStaff.body.approvalStatus).toBe('pending');
    const appliedConcessionId = applyStaff.body.id;

    const applied = await request(app).get('/api/fee/concessions/applied').set(auth(acc));
    expect(applied.body.length).toBe(2);

    const queue = await request(app).get('/api/fee/concessions/approvals/queue').set(auth(acc));
    expect(queue.body.length).toBe(1);
    expect(queue.body[0]).toMatchObject({ appliedConcessionId, status: 'pending', concessionName: 'Staff Child' });

    const review = await request(app)
      .patch(`/api/fee/concessions/approvals/${queue.body[0].id}`)
      .set(auth(acc))
      .send({ action: 'approve', remarks: 'Verified staff parent' });
    expect(review.body).toMatchObject({ status: 'approved', history: expect.any(Array) });
    expect(review.body.history.length).toBe(1);

    // The linked applied concession is now active.
    const applied2 = await request(app).get('/api/fee/concessions/applied').set(auth(acc));
    expect(applied2.body.find((a: { id: string }) => a.id === appliedConcessionId).approvalStatus).toBe('active');
  });

  it('revoke an applied concession', async () => {
    const concessions = await request(app).get('/api/fee/concessions').set(auth(acc));
    const sibling = concessions.body.find((c: { name: string }) => c.name === 'Sibling Discount');
    const student = await studentId();
    const apply = await request(app)
      .post('/api/fee/concessions/applied')
      .set(auth(acc))
      .send({ concessionId: sibling.id, studentId: student.id, studentName: student.name, className: student.className });
    const revoke = await request(app).patch(`/api/fee/concessions/applied/${apply.body.id}/revoke`).set(auth(acc)).send({ reason: 'Sibling left' });
    expect(revoke.body.approvalStatus).toBe('revoked');
  });
});
