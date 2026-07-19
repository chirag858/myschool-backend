import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string, password = 'demo1234'): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password, captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Gate Manager API', () => {
  let gm: string;
  beforeEach(async () => {
    await seedDemo();
    gm = await token('amingatemanager@gmail.com', 'Gatemanager@123');
  });

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get('/api/gate-manager/dashboard')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/gate-manager/dashboard').set(auth(acc))).status).toBe(403);
  });

  it('dashboard reflects seeded visitors and roster', async () => {
    const res = await request(app).get('/api/gate-manager/dashboard').set(auth(gm));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ visitorsInside: 1, visitorsToday: 2, passedOutToday: 0, pendingPickups: 0 });
    expect(res.body.studentsInside).toBeGreaterThan(0);
  });

  it('searches students (all inside) and filters by query', async () => {
    const all = await request(app).get('/api/gate-manager/students').set(auth(gm));
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThan(0);
    expect(all.body[0]).toMatchObject({ id: expect.any(String), inside: true, admissionNumber: expect.any(String) });
    const filtered = await request(app).get('/api/gate-manager/students?q=ADM').set(auth(gm));
    expect(filtered.body.length).toBeGreaterThan(0);
    const none = await request(app).get('/api/gate-manager/students?q=zzzznomatch').set(auth(gm));
    expect(none.body.length).toBe(0);
  });

  it('releases a student, flips them outside, records the pickup', async () => {
    const students = (await request(app).get('/api/gate-manager/students').set(auth(gm))).body;
    const s = students[0];
    const release = await request(app)
      .post('/api/gate-manager/pickups')
      .set(auth(gm))
      .send({ studentId: s.id, pickupByName: 'Father', pickupByMobile: '9998887776', relation: 'father', reason: 'medical', verificationMethod: 'photo_match', notes: 'Doctor visit' });
    expect(release.status).toBe(201);
    expect(release.body).toMatchObject({ status: 'passed_out', studentName: s.name, approvedBy: 'Gate Manager', pickupBy: 'Father', outTime: expect.any(String) });

    const after = (await request(app).get('/api/gate-manager/students').set(auth(gm))).body;
    expect(after.find((x: { id: string }) => x.id === s.id).inside).toBe(false);

    const pickups = (await request(app).get('/api/gate-manager/pickups').set(auth(gm))).body;
    expect(pickups.some((p: { studentId: string }) => p.studentId === s.id)).toBe(true);

    const dash = (await request(app).get('/api/gate-manager/dashboard').set(auth(gm))).body;
    expect(dash.passedOutToday).toBe(1);
  });

  it('missing student on release → 404', async () => {
    const res = await request(app)
      .post('/api/gate-manager/pickups')
      .set(auth(gm))
      .send({ studentId: '000000000000000000000000', pickupByName: 'X', pickupByMobile: '1', relation: 'father', reason: 'medical', verificationMethod: 'otp' });
    expect(res.status).toBe(404);
  });

  it('sends a 6-digit pickup OTP', async () => {
    const res = await request(app).post('/api/gate-manager/otp/send').set(auth(gm)).send({ mobile: '9998887776' });
    expect(res.status).toBe(200);
    expect(res.body.otp).toMatch(/^\d{6}$/);
  });

  it('logs a visitor, then checks them out', async () => {
    const list = (await request(app).get('/api/gate-manager/visitors').set(auth(gm))).body;
    expect(list.length).toBe(2);
    const log = await request(app)
      .post('/api/gate-manager/visitors')
      .set(auth(gm))
      .send({ name: 'New Visitor', mobile: '9871234567', purpose: 'Enquiry', whomToMeet: 'Admissions', takingStudentHome: false });
    expect(log.status).toBe(201);
    expect(log.body).toMatchObject({ name: 'New Visitor', passNumber: expect.stringMatching(/^V-/), inTime: expect.any(String) });
    const checkout = await request(app).patch(`/api/gate-manager/visitors/${log.body.id}/checkout`).set(auth(gm));
    expect(checkout.body).toMatchObject({ id: log.body.id, outTime: expect.any(String) });
    expect((await request(app).patch('/api/gate-manager/visitors/000000000000000000000000/checkout').set(auth(gm))).status).toBe(404);
  });

  it('issues a teacher gate pass, then marks it returned', async () => {
    const list = (await request(app).get('/api/gate-manager/teacher-passes').set(auth(gm))).body;
    expect(list.length).toBe(1);
    const issue = await request(app)
      .post('/api/gate-manager/teacher-passes')
      .set(auth(gm))
      .send({ teacherName: 'Ms. Verma', duration: '1_hour', reason: 'Personal' });
    expect(issue.status).toBe(201);
    expect(issue.body).toMatchObject({ teacherName: 'Ms. Verma', issuedBy: 'Gate Manager', outTime: expect.any(String) });
    const ret = await request(app).patch(`/api/gate-manager/teacher-passes/${issue.body.id}/return`).set(auth(gm));
    expect(ret.body).toMatchObject({ id: issue.body.id, returnedAt: expect.any(String) });
  });
});
