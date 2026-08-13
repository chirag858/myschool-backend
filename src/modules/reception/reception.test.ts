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

describe('Reception API', () => {
  let recep: string;
  beforeEach(async () => {
    await seedDemo();
    recep = await token('receptionist');
  });

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get('/api/reception/appointments')).status).toBe(401);
    const teacher = await token('teacher');
    expect((await request(app).get('/api/reception/appointments').set(auth(teacher))).status).toBe(403);
  });

  it('dashboard aggregates appointments + inquiries', async () => {
    const res = await request(app).get('/api/reception/dashboard').set(auth(recep));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      appointmentsCompleted: expect.any(Number),
      inquiriesThisMonth: expect.any(Number),
      appointmentsUpcoming: expect.any(Number),
    });
  });

  it('appointments: list seeded, filter by date, create, set status', async () => {
    const list = await request(app).get('/api/reception/appointments').set(auth(recep));
    expect(list.body.length).toBe(1);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), visitorName: 'Mr. Gupta', status: 'scheduled' });

    const byDate = await request(app).get('/api/reception/appointments?date=2025-05-05').set(auth(recep));
    expect(byDate.body.length).toBe(1);
    const none = await request(app).get('/api/reception/appointments?date=2099-01-01').set(auth(recep));
    expect(none.body.length).toBe(0);

    const create = await request(app)
      .post('/api/reception/appointments')
      .set(auth(recep))
      .send({ visitorName: 'Ms. Verma', visitorMobile: '9990001111', date: '2026-08-01', time: '11:00', purpose: 'parent_meeting', withWhom: 'Admin' });
    expect(create.status).toBe(201);
    const id = create.body.id;

    const st = await request(app).patch(`/api/reception/appointments/${id}/status`).set(auth(recep)).send({ status: 'completed' });
    expect(st.body.status).toBe('completed');
  });

  it('call logs: list seeded, create, mark follow-up done', async () => {
    const list = await request(app).get('/api/reception/call-logs').set(auth(recep));
    expect(list.body.length).toBe(1);
    expect(list.body[0]).toMatchObject({ callerName: 'Mrs. Rao', followUpDone: false });

    const create = await request(app)
      .post('/api/reception/call-logs')
      .set(auth(recep))
      .send({ direction: 'outgoing', callerName: 'Mr. Singh', mobile: '9990002222', purpose: 'admission', followUpRequired: true });
    expect(create.status).toBe(201);
    expect(create.body.loggedAt).toEqual(expect.any(String));

    const done = await request(app).patch(`/api/reception/call-logs/${create.body.id}/follow-up-done`).set(auth(recep));
    expect(done.body.followUpDone).toBe(true);
  });

  it('rejects invalid payloads (400)', async () => {
    expect((await request(app).post('/api/reception/appointments').set(auth(recep)).send({ time: '10:00' })).status).toBe(400);
    expect((await request(app).post('/api/reception/call-logs').set(auth(recep)).send({ mobile: '999' })).status).toBe(400);
  });
});
