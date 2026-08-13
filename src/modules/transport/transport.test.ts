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

describe('Transport API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get('/api/transport/vehicles')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/transport/vehicles').set(auth(acc))).status).toBe(403);
  });

  it('allows super_admin and support_engineer to read vehicles/routes given ?schoolId= (GPS Devices page dependency)', async () => {
    const profile = await request(app).get('/api/auth/profile').set(auth(admin));
    const schoolId = profile.body.schoolId as string;
    const sa = await token('superadmin');
    const eng = await token('support');
    expect((await request(app).get('/api/transport/vehicles').query({ schoolId }).set(auth(sa))).status).toBe(200);
    expect((await request(app).get('/api/transport/vehicles').query({ schoolId }).set(auth(eng))).status).toBe(200);
    expect((await request(app).get('/api/transport/routes').query({ schoolId }).set(auth(sa))).status).toBe(200);
    expect((await request(app).get('/api/transport/routes').query({ schoolId }).set(auth(eng))).status).toBe(200);
  });

  it('super_admin/support_engineer without ?schoolId= get 400, not a silent empty list', async () => {
    const eng = await token('support');
    expect((await request(app).get('/api/transport/vehicles').set(auth(eng))).status).toBe(400);
  });

  it('still forbids super_admin/support_engineer from vehicle/driver mutation and the KPI dashboard (adminOnly stays school_admin/principal)', async () => {
    const eng = await token('support');
    expect((await request(app).get('/api/transport/dashboard').set(auth(eng))).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/transport/vehicles')
          .set(auth(eng))
          .send({ registrationNumber: 'X', type: 'bus', capacity: 10 })
      ).status,
    ).toBe(403);
  });

  it('dashboard KPI reflects seeded data', async () => {
    const kpi = await request(app).get('/api/transport/dashboard').set(auth(admin));
    expect(kpi.status).toBe(200);
    expect(kpi.body).toMatchObject({ totalVehicles: 1, drivers: 1, activeRoutes: 1, studentsAvailing: 1, pendingFee: 800 });
  });

  it('vehicles: list/get/create/update/status', async () => {
    const list = await request(app).get('/api/transport/vehicles').set(auth(admin));
    expect(list.body.length).toBe(1);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), registrationNumber: 'PB-11-AB-1234' });

    const create = await request(app)
      .post('/api/transport/vehicles')
      .set(auth(admin))
      .send({ registrationNumber: 'PB-11-XY-9999', vehicleType: 'van', seatingCapacity: 15 });
    expect(create.status).toBe(201);
    const id = create.body.id;

    const upd = await request(app).put(`/api/transport/vehicles/${id}`).set(auth(admin)).send({ seatingCapacity: 18 });
    expect(upd.body.seatingCapacity).toBe(18);
    const st = await request(app).patch(`/api/transport/vehicles/${id}/status`).set(auth(admin)).send({ status: 'maintenance' });
    expect(st.body.status).toBe('maintenance');
  });

  it('drivers: list/create/update', async () => {
    const list = await request(app).get('/api/transport/drivers').set(auth(admin));
    expect(list.body.length).toBe(1);
    const create = await request(app).post('/api/transport/drivers').set(auth(admin)).send({ name: 'Sukhwinder', mobile: '9876500002' });
    expect(create.status).toBe(201);
    const upd = await request(app).put(`/api/transport/drivers/${create.body.id}`).set(auth(admin)).send({ status: 'on_leave' });
    expect(upd.body.status).toBe('on_leave');
  });

  it('routes: list with stops, upsert (create + edit), delete', async () => {
    const list = await request(app).get('/api/transport/routes').set(auth(admin));
    expect(list.body.length).toBe(1);
    expect(list.body[0]).toMatchObject({ routeName: 'North Route', stops: expect.any(Array) });
    expect(list.body[0].stops[0]).toMatchObject({ id: expect.any(String), stopName: 'Model Town' });

    const create = await request(app)
      .post('/api/transport/routes')
      .set(auth(admin))
      .send({ routeName: 'South Route', routeCode: 'R2', monthlyFee: 900, stops: [{ stopOrder: 1, stopName: 'Civil Lines' }] });
    expect(create.status).toBe(201);
    const id = create.body.id;

    const edit = await request(app).post('/api/transport/routes').set(auth(admin)).send({ id, routeName: 'South Route', monthlyFee: 1000 });
    expect(edit.body.monthlyFee).toBe(1000);

    const del = await request(app).delete(`/api/transport/routes/${id}`).set(auth(admin));
    expect(del.body.success).toBe(true);
  });

  it('student assignments: list/assign/remove', async () => {
    const list = await request(app).get('/api/transport/students').set(auth(admin));
    expect(list.body.length).toBe(1);

    const students = await request(app).get('/api/students?classKey=Class 2').set(auth(admin));
    const student = students.body.rows[0];
    const assign = await request(app)
      .post('/api/transport/students/assign')
      .set(auth(admin))
      .send({ studentId: student.id, studentName: student.name, className: student.className, routeName: 'North Route', stopName: 'Model Town', pickupPoint: 'Model Town', dropPoint: 'Model Town', monthlyFee: 800 });
    expect(assign.status).toBe(201);

    const list2 = await request(app).get('/api/transport/students').set(auth(admin));
    expect(list2.body.length).toBe(2);

    const del = await request(app).delete(`/api/transport/students/${assign.body.id}/assignment`).set(auth(admin));
    expect(del.body.success).toBe(true);
  });

  it('GET /students/:id/transport resolves route + driver + vehicle', async () => {
    const list = await request(app).get('/api/transport/students').set(auth(admin));
    const studentId = list.body[0].studentId;
    const res = await request(app).get(`/api/students/${studentId}/transport`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      routeName: 'North Route',
      driverName: 'Rajesh Singh',
      driverMobile: '9876500001',
      vehicleNumber: 'PB-11-AB-1234',
    });
  });
});
