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

describe('Attendance API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids non-teaching roles (403)', async () => {
    expect((await request(app).get('/api/attendance/dashboard')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/attendance/dashboard').set(auth(acc))).status).toBe(403);
  });

  it('GET /attendance/mark returns the roster with seeded marks (locked)', async () => {
    const res = await request(app)
      .get('/api/attendance/mark?date=2025-04-07&class=Nursery&section=A')
      .set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: '2025-04-07', classLabel: 'Nursery', section: 'A', lockStatus: 'locked' });
    expect(res.body.students.length).toBeGreaterThan(0);
    expect(res.body.students[0]).toMatchObject({ id: expect.any(String), rollNumber: expect.any(String), name: expect.any(String), status: expect.any(String) });
  });

  it('POST /attendance/save marks an unmarked day and locks it', async () => {
    const ms = await request(app)
      .get('/api/attendance/mark?date=2025-04-11&class=Nursery&section=A')
      .set(auth(admin));
    expect(ms.body.lockStatus).toBe('unlocked');
    const payload = {
      date: '2025-04-11',
      classKey: 'Nursery-A',
      attendance: ms.body.students.map((s: { id: string }) => ({ studentId: s.id, status: 'present' })),
    };
    const save = await request(app).post('/api/attendance/save').set(auth(admin)).send(payload);
    expect(save.body.saved).toBe(ms.body.students.length);

    const ms2 = await request(app)
      .get('/api/attendance/mark?date=2025-04-11&class=Nursery&section=A')
      .set(auth(admin));
    expect(ms2.body.lockStatus).toBe('locked');
    expect(ms2.body.students[0].status).toBe('present');
  });

  it('POST /attendance/save-and-alert counts absentee alerts', async () => {
    const ms = await request(app)
      .get('/api/attendance/mark?date=2025-04-14&class=Nursery&section=A')
      .set(auth(admin));
    const payload = {
      date: '2025-04-14',
      classKey: 'Nursery-A',
      attendance: ms.body.students.map((s: { id: string }, i: number) => ({ studentId: s.id, status: i === 0 ? 'absent' : 'present' })),
    };
    const res = await request(app).post('/api/attendance/save-and-alert').set(auth(admin)).send(payload);
    expect(res.body).toMatchObject({ saved: ms.body.students.length, alertsSent: 1 });
  });

  it('PATCH /attendance/override changes a mark and records an audit entry', async () => {
    const ms = await request(app)
      .get('/api/attendance/mark?date=2025-04-07&class=Nursery&section=A')
      .set(auth(admin));
    const stu = ms.body.students[0];
    const newStatus = stu.status === 'present' ? 'absent' : 'present';
    const res = await request(app)
      .patch('/api/attendance/override')
      .set(auth(admin))
      .send({
        date: '2025-04-07',
        classKey: 'Nursery-A',
        attendance: [{ studentId: stu.id, status: newStatus }],
        reason: 'Correction',
        originalAttendance: [{ studentId: stu.id, status: stu.status }],
      });
    expect(res.body.entries).toBe(1);

    const hist = await request(app).get('/api/attendance/override-history').set(auth(admin));
    expect(hist.body.length).toBe(1);
    expect(hist.body[0]).toMatchObject({ studentName: stu.name, reason: 'Correction', newStatus });
  });

  it('GET /attendance/dashboard aggregates the day', async () => {
    const res = await request(app).get('/api/attendance/dashboard?date=2025-04-07').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      date: '2025-04-07',
      totalPresent: expect.any(Number),
      totalAbsent: expect.any(Number),
      overallPercent: expect.any(Number),
    });
    expect(res.body.totalPresent).toBeGreaterThan(0);
    expect(res.body.classSummaries.length).toBeGreaterThanOrEqual(5);
    expect(res.body.classSummaries[0]).toMatchObject({ classKey: expect.any(String), total: expect.any(Number), status: expect.any(String) });
  });

  it('GET /attendance/reports/daily and absentees', async () => {
    const daily = await request(app).get('/api/attendance/reports/daily?date=2025-04-07').set(auth(admin));
    expect(daily.status).toBe(200);
    expect(daily.body[0]).toMatchObject({ classLabel: expect.any(String), total: expect.any(Number), present: expect.any(Number) });

    const absentees = await request(app).get('/api/attendance/reports/absentees?date=2025-04-07').set(auth(admin));
    expect(absentees.status).toBe(200);
    expect(Array.isArray(absentees.body)).toBe(true);
    if (absentees.body.length > 0) {
      expect(absentees.body[0]).toMatchObject({ studentId: expect.any(String), studentName: expect.any(String), rollNumber: expect.any(String), alertSent: false });
    }
  });

  it('POST /attendance/reports/absentees/alert marks absentees alerted, persisted and idempotent', async () => {
    const before = await request(app).get('/api/attendance/reports/absentees?date=2025-04-07').set(auth(admin));
    expect(before.body.every((a: { alertSent: boolean }) => a.alertSent === false)).toBe(true);
    if (before.body.length === 0) return;

    const res = await request(app)
      .post('/api/attendance/reports/absentees/alert')
      .set(auth(admin))
      .send({ date: '2025-04-07' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(before.body.length);

    const after = await request(app).get('/api/attendance/reports/absentees?date=2025-04-07').set(auth(admin));
    expect(after.body.every((a: { alertSent: boolean }) => a.alertSent === true)).toBe(true);

    // Idempotent: re-running for the same date is safe and every row stays alerted.
    const again = await request(app)
      .post('/api/attendance/reports/absentees/alert')
      .set(auth(admin))
      .send({ date: '2025-04-07' });
    expect(again.status).toBe(200);
    const stillAfter = await request(app).get('/api/attendance/reports/absentees?date=2025-04-07').set(auth(admin));
    expect(stillAfter.body.every((a: { alertSent: boolean }) => a.alertSent === true)).toBe(true);
  });

  it('GET /students/:id/attendance builds the monthly calendar', async () => {
    const list = await request(app).get('/api/students').set(auth(admin));
    const id = list.body.rows[0].id;
    const res = await request(app).get(`/api/students/${id}/attendance?year=2025&month=4`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ year: 2025, month: 4, workingDays: expect.any(Number), percentage: expect.any(Number) });
    expect(res.body.workingDays).toBeGreaterThan(0);
    expect(res.body.days.some((d: { status: string }) => d.status === 'weekend')).toBe(true);
    expect(res.body.days.some((d: { status: string }) => ['present', 'absent', 'leave'].includes(d.status))).toBe(true);
  });

  it('GET /students/:id/attendance/annual-summary rolls up by month', async () => {
    const list = await request(app).get('/api/students').set(auth(admin));
    const id = list.body.rows[0].id;
    const res = await request(app).get(`/api/students/${id}/attendance/annual-summary`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const april = res.body.find((r: { month: string }) => r.month.startsWith('Apr'));
    expect(april).toMatchObject({ workingDays: expect.any(Number), present: expect.any(Number), percentage: expect.any(Number) });
  });

  it('GET /attendance/reports/monthly returns per-student stats', async () => {
    const res = await request(app).get('/api/attendance/reports/monthly').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({ studentId: expect.any(String), name: expect.any(String), workingDays: expect.any(Number), present: expect.any(Number), percentage: expect.any(Number) });
  });

  it('GET /attendance/reports/low-attendance filters by threshold', async () => {
    const all = await request(app).get('/api/attendance/reports/low-attendance?threshold=100').set(auth(admin));
    expect(all.status).toBe(200);
    expect(Array.isArray(all.body)).toBe(true);
    // threshold 100 → any student with a single absence appears; each row is well-formed
    if (all.body.length) expect(all.body[0]).toMatchObject({ studentId: expect.any(String), percentage: expect.any(Number), totalDays: expect.any(Number) });
    const none = await request(app).get('/api/attendance/reports/low-attendance?threshold=0').set(auth(admin));
    expect(none.body.length).toBe(0);
  });

  it('GET /attendance/reports/register returns a student×date matrix', async () => {
    const res = await request(app).get('/api/attendance/reports/register?classKey=Nursery-A').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ students: expect.any(Array), dates: expect.any(Array), cells: expect.any(Object) });
    expect(res.body.students.length).toBeGreaterThan(0);
    if (res.body.dates.length) {
      const sid = res.body.students[0].id;
      expect(res.body.cells[sid]).toBeTruthy();
    }
  });
});
