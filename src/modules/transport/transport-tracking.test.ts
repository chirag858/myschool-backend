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

describe('Transport tracking / GPS devices API', () => {
  let admin: string;
  let schoolId: string;

  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
    const profile = await request(app).get('/api/auth/profile').set(auth(admin));
    schoolId = profile.body.schoolId as string;
  });

  it('requires auth (401) and forbids untenanted roles without ?schoolId= (400, not silently empty)', async () => {
    expect((await request(app).get('/api/transport/gps-devices')).status).toBe(401);
    const eng = await token('support');
    const res = await request(app).get('/api/transport/gps-devices').set(auth(eng));
    expect(res.status).toBe(400);
  });

  it('school_admin/principal/coordinator/teacher read their own school’s GPS devices via JWT schoolId', async () => {
    const res = await request(app).get('/api/transport/gps-devices').set(auth(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('super_admin/support_engineer can read GPS devices when they pass ?schoolId= (the fix)', async () => {
    const sa = await token('superadmin');
    const eng = await token('support');
    const saRes = await request(app)
      .get('/api/transport/gps-devices')
      .query({ schoolId })
      .set(auth(sa));
    expect(saRes.status).toBe(200);
    const engRes = await request(app)
      .get('/api/transport/gps-devices')
      .query({ schoolId })
      .set(auth(eng));
    expect(engRes.status).toBe(200);
  });

  it('support_engineer can save a GPS device for a school via ?schoolId=', async () => {
    const eng = await token('support');
    const vehicles = await request(app).get('/api/transport/vehicles').set(auth(admin));
    const vehicleId = vehicles.body[0].id as string;

    const save = await request(app)
      .post('/api/transport/gps-devices')
      .query({ schoolId })
      .set(auth(eng))
      .send({
        vehicleId,
        vehicleNumber: 'PB-11-AB-1234',
        simProvider: 'jio',
        status: 'active',
      });
    expect(save.status).toBe(201);
    expect(save.body).toMatchObject({ vehicleId, status: 'active' });

    const list = await request(app)
      .get('/api/transport/gps-devices')
      .query({ schoolId })
      .set(auth(admin));
    expect(list.body.some((d: { vehicleId: string }) => d.vehicleId === vehicleId)).toBe(true);
  });

  it('forbids accountant entirely (403, role never had access)', async () => {
    const acc = await token('accountant');
    expect((await request(app).get('/api/transport/gps-devices').set(auth(acc))).status).toBe(403);
  });
});
