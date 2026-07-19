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

describe('Coordinator API (student leaves)', () => {
  let coord: string;
  beforeEach(async () => {
    await seedDemo();
    coord = await token('coordinator');
  });
  const leaveIds = async () => {
    const res = await request(app).get('/api/coordinator/student-leaves').set(auth(coord));
    return res.body.map((l: { id: string }) => l.id);
  };

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get('/api/coordinator/student-leaves')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/coordinator/student-leaves').set(auth(acc))).status).toBe(403);
  });

  it('dashboard reflects supervised classes + recent leaves', async () => {
    const res = await request(app).get('/api/coordinator/dashboard').set(auth(coord));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      supervisedClassesCount: 5,
      supervisedSectionsCount: 10,
      acrossExamsCount: expect.any(Number),
    });
    expect(res.body.recentStudentLeaves.length).toBe(3);
  });

  it('student leaves: list seeded (pending), filter by status', async () => {
    const list = await request(app).get('/api/coordinator/student-leaves').set(auth(coord));
    expect(list.body.length).toBe(3);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), studentName: expect.any(String), status: 'pending' });
    const pending = await request(app).get('/api/coordinator/student-leaves?status=pending').set(auth(coord));
    expect(pending.body.length).toBe(3);
  });

  it('apply-on-behalf creates an approved leave', async () => {
    const create = await request(app)
      .post('/api/coordinator/student-leaves')
      .set(auth(coord))
      .send({ studentName: 'Test Student', className: 'Class 1', fromDate: '2026-08-01', toDate: '2026-08-02', days: 2, type: 'family', reason: 'Wedding' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ status: 'approved', decidedBy: 'Coordinator (on behalf)', appliedOn: expect.any(String) });
  });

  it('approve / reject / forward decisions', async () => {
    const [id1, id2, id3] = await leaveIds();

    const approve = await request(app).patch(`/api/coordinator/student-leaves/${id1}/approve`).set(auth(coord)).send({ remarks: 'OK' });
    expect(approve.body).toMatchObject({ status: 'approved', remarks: 'OK', decidedAt: expect.any(String) });

    const reject = await request(app).patch(`/api/coordinator/student-leaves/${id2}/reject`).set(auth(coord)).send({ reason: 'Insufficient info' });
    expect(reject.body).toMatchObject({ status: 'rejected', rejectionReason: 'Insufficient info' });

    const forward = await request(app).patch(`/api/coordinator/student-leaves/${id3}/forward`).set(auth(coord)).send({ remarks: 'Needs principal' });
    expect(forward.body).toMatchObject({ status: 'forwarded', decidedBy: 'Coordinator → Principal' });

    const pending = await request(app).get('/api/coordinator/student-leaves?status=pending').set(auth(coord));
    expect(pending.body.length).toBe(0);
  });

  it('404 for a missing leave, 400 for a reject without reason', async () => {
    expect((await request(app).patch('/api/coordinator/student-leaves/000000000000000000000000/approve').set(auth(coord)).send({})).status).toBe(404);
    const [id1] = await leaveIds();
    expect((await request(app).patch(`/api/coordinator/student-leaves/${id1}/reject`).set(auth(coord)).send({})).status).toBe(400);
  });
});

describe('Coordinator API (staff leaves + marks + staff overview)', () => {
  let coord: string;
  beforeEach(async () => {
    await seedDemo();
    coord = await token('coordinator');
  });

  it('staff leaves: L1 pending queue vs history; approve-level1 escalates; reject', async () => {
    const pending = await request(app).get('/api/coordinator/staff-leaves').set(auth(coord));
    expect(pending.status).toBe(200);
    expect(pending.body.length).toBe(1); // only the L1-pending one
    expect(pending.body[0]).toMatchObject({ currentLevel: 1, status: 'pending', staffName: expect.any(String) });

    const history = await request(app).get('/api/coordinator/staff-leaves?tab=history').set(auth(coord));
    expect(history.body.length).toBe(2); // escalated (L2) + rejected

    const id = pending.body[0].id;
    const approve = await request(app).patch(`/api/coordinator/staff-leaves/${id}/approve-level1`).set(auth(coord)).send({ remarks: 'OK, to principal' });
    expect(approve.body).toMatchObject({ currentLevel: 2, remarks: 'OK, to principal', decidedAt: expect.any(String) });
    // Now the L1 queue is empty and history grew.
    expect((await request(app).get('/api/coordinator/staff-leaves').set(auth(coord))).body.length).toBe(0);
    expect((await request(app).get('/api/coordinator/staff-leaves?tab=history').set(auth(coord))).body.length).toBe(3);

    // Reject requires a reason.
    expect((await request(app).patch(`/api/coordinator/staff-leaves/${id}/reject`).set(auth(coord)).send({})).status).toBe(400);
  });

  it('marks overview lists class-subject cells for an exam', async () => {
    const admin = await token('schooladmin');
    const exams = await request(app).get('/api/exams').set(auth(admin));
    const examId = (Array.isArray(exams.body) ? exams.body : exams.body.rows ?? []).find((e: { name: string }) => e.name === 'Mid Term 2025').id;
    const res = await request(app).get(`/api/coordinator/marks-overview?examId=${examId}`).set(auth(coord));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({ classKey: expect.any(String), subject: expect.any(String), teacherName: expect.any(String), status: expect.any(String) });
    expect((await request(app).get('/api/coordinator/marks-overview?examId=000000000000000000000000').set(auth(coord))).status).toBe(404);
  });

  it('staff overview + attendance list all staff (today status)', async () => {
    const overview = await request(app).get('/api/coordinator/staff-overview').set(auth(coord));
    expect(overview.body.length).toBe(4);
    expect(overview.body[0]).toMatchObject({ name: expect.any(String), department: expect.any(String), todayStatus: expect.any(String) });

    const filtered = await request(app).get('/api/coordinator/staff-overview?department=teaching').set(auth(coord));
    expect(filtered.body.length).toBe(2);

    const attendance = await request(app).get('/api/coordinator/staff-attendance').set(auth(coord));
    expect(attendance.body.length).toBe(4);
    expect(attendance.body[0]).toMatchObject({ name: expect.any(String), status: 'not_marked' });
  });
});
