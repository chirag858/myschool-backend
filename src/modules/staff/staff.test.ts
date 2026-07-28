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
const DATE = '2025-09-15';

describe('Staff/HR API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get('/api/staff')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/staff').set(auth(acc))).status).toBe(403);
  });

  it('GET /staff lists seeded staff (StaffRow) with filter + pagination', async () => {
    const list = await request(app).get('/api/staff').set(auth(admin));
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ total: 4, page: 1, pageSize: 10 });
    expect(list.body.rows[0]).toMatchObject({
      id: expect.any(String),
      employeeId: expect.any(String),
      name: expect.any(String),
      basic: expect.any(Number),
      netSalary: expect.any(Number),
    });
    const teaching = await request(app).get('/api/staff?department=teaching').set(auth(admin));
    expect(teaching.body.total).toBe(2);
  });

  it('stats + id generation/check', async () => {
    const stats = await request(app).get('/api/staff/stats').set(auth(admin));
    expect(stats.body).toMatchObject({ totalStaff: 4, teachingCount: 2, nonTeachingCount: 2 });

    const gen = await request(app).get('/api/staff/generate-id').set(auth(admin));
    expect(gen.body.employeeId).toBe('EMP0005');
    const check = await request(app).get('/api/staff/check-id?employeeId=EMP0001').set(auth(admin));
    expect(check.body.taken).toBe(true);
    const free = await request(app).get('/api/staff/check-id?employeeId=EMP9999').set(auth(admin));
    expect(free.body.taken).toBe(false);
  });

  it('create staff computes employeeId + netSalary; profile + status update', async () => {
    const create = await request(app)
      .post('/api/staff')
      .set(auth(admin))
      .send({ name: 'New Teacher', designation: 'teacher', department: 'teaching', mobile: '9990001234', basic: 40000, joiningDate: '2025-08-01' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ employeeId: 'EMP0005', netSalary: 40000, status: 'active' });
    const id = create.body.id;

    const profile = await request(app).get(`/api/staff/${id}`).set(auth(admin));
    expect(profile.body).toMatchObject({ id, name: 'New Teacher', qualifications: expect.any(Array), salaryStructure: expect.any(Object) });

    const st = await request(app).patch(`/api/staff/${id}/status`).set(auth(admin)).send({ status: 'inactive' });
    expect(st.body.status).toBe('inactive');
  });

  it('create staff with allowances/deductions computes net salary additively', async () => {
    const create = await request(app)
      .post('/api/staff')
      .set(auth(admin))
      .send({
        name: 'Adjusted Teacher',
        designation: 'teacher',
        department: 'teaching',
        mobile: '9990001235',
        basic: 25000,
        joiningDate: '2025-08-01',
        allowances: [{ type: 'hra', amount: 8000 }, { type: 'da', amount: 2500 }],
        deductions: [{ type: 'pf', amount: 3000 }, { type: 'professional_tax', amount: 200 }],
      });
    expect(create.status).toBe(201);
    expect(create.body.netSalary).toBe(32300);

    const profile = await request(app).get(`/api/staff/${create.body.id}`).set(auth(admin));
    expect(profile.body.salaryStructure).toMatchObject({
      allowances: [{ type: 'hra', amount: 8000 }, { type: 'da', amount: 2500 }],
      deductions: [{ type: 'pf', amount: 3000 }, { type: 'professional_tax', amount: 200 }],
    });
  });

  it('staff attendance: get roster → save → lock → report', async () => {
    const get1 = await request(app).get(`/api/staff/attendance?date=${DATE}`).set(auth(admin));
    expect(get1.body.locked).toBe(false);
    expect(get1.body.rows.length).toBe(4);
    expect(get1.body.rows[0].status).toBeNull();

    const attendance = get1.body.rows.map((r: { id: string }, i: number) => ({ id: r.id, staffId: r.id, status: i === 0 ? 'leave' : 'present' }));
    const save = await request(app)
      .post('/api/staff/attendance/save')
      .set(auth(admin))
      .send({ date: DATE, attendance: attendance.map((a: { staffId: string; status: string }) => ({ staffId: a.staffId, status: a.status })) });
    expect(save.body.saved).toBe(4);

    const get2 = await request(app).get(`/api/staff/attendance?date=${DATE}`).set(auth(admin));
    const present = get2.body.rows.filter((r: { status: string }) => r.status === 'present').length;
    expect(present).toBe(3);

    const lock = await request(app).patch('/api/staff/attendance/lock').set(auth(admin)).send({ date: DATE });
    expect(lock.body.success).toBe(true);
    const get3 = await request(app).get(`/api/staff/attendance?date=${DATE}`).set(auth(admin));
    expect(get3.body.locked).toBe(true);

    const report = await request(app).get('/api/staff/attendance/report').set(auth(admin));
    expect(report.body.length).toBe(4);
    expect(report.body[0]).toMatchObject({ workingDays: expect.any(Number), present: expect.any(Number), percentage: expect.any(Number) });
  });

  it('rejects invalid create payload (400)', async () => {
    expect((await request(app).post('/api/staff').set(auth(admin)).send({ mobile: '999' })).status).toBe(400);
  });
});
