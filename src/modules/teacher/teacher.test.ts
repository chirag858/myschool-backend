import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Teacher Portal API', () => {
  let teacher: string;
  beforeEach(async () => {
    await seedDemo();
    teacher = await token('teacher');
  });

  it('requires auth (401) and forbids non-teacher roles (403)', async () => {
    expect((await request(app).get('/api/teacher/my-classes')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/teacher/my-classes').set(auth(acc))).status).toBe(403);
  });

  it('my-classes returns the two assigned classes with rosters', async () => {
    const res = await request(app).get('/api/teacher/my-classes').set(auth(teacher));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    const c1 = res.body.find((c: { classKey: string }) => c.classKey === 'Class 1-A');
    expect(c1).toMatchObject({ className: 'Class 1', section: 'A', totalStudents: expect.any(Number) });
    expect(c1.subjects).toContain('Mathematics');
    expect(c1.totalStudents).toBeGreaterThan(0);
    expect(c1.attendanceToday).toMatchObject({ status: expect.any(String) });
  });

  it('my-students returns roster with attendance %, filterable by class', async () => {
    const all = await request(app).get('/api/teacher/my-students').set(auth(teacher));
    expect(all.body.length).toBeGreaterThan(0);
    expect(all.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), attendancePercent: expect.any(Number) });
    const c1 = await request(app).get('/api/teacher/my-students?classKey=Class 1-A').set(auth(teacher));
    expect(c1.body.every((s: { className: string; section: string }) => s.className === 'Class 1' && s.section === 'A')).toBe(true);
  });

  it('my-exams returns rows scoped to the teacher classes/subjects', async () => {
    const res = await request(app).get('/api/teacher/my-exams').set(auth(teacher));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length) expect(res.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), classKey: expect.any(String), subject: expect.any(String) });
  });

  it('dashboard-summary aggregates real classes/exams/homework into KPIs and pending tasks', async () => {
    const res = await request(app).get('/api/teacher/dashboard-summary').set(auth(teacher));
    expect(res.status).toBe(200);
    expect(res.body.kpis).toMatchObject({
      classes: 2,
      attendancePending: expect.any(Number),
      homeworkPending: expect.any(Number),
      marksPending: expect.any(Number),
    });
    expect(res.body.classesToday).toHaveLength(2);
    expect(res.body.classesToday[0]).toMatchObject({
      classKey: expect.any(String),
      subjects: expect.any(Array),
      attendanceStatus: expect.any(String),
    });
    expect(Array.isArray(res.body.pendingTasks)).toBe(true);
    for (const task of res.body.pendingTasks) {
      expect(['attendance', 'marks', 'homework']).toContain(task.type);
      expect(task.classKey).toEqual(expect.any(String));
    }
  });

  it('homework: list seeded, create, submissions roster, delete', async () => {
    const list = await request(app).get('/api/teacher/homework').set(auth(teacher));
    expect(list.body.length).toBe(1);
    expect(list.body[0]).toMatchObject({ title: 'Algebra worksheet', createdBy: 'Teacher' });

    const create = await request(app)
      .post('/api/teacher/homework')
      .set(auth(teacher))
      .send({ classKey: 'Class 1-A', subject: 'Mathematics', title: 'Geometry HW', description: 'Chapter 4', dueDate: '2025-06-01' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ title: 'Geometry HW', createdBy: 'Teacher', homeworkType: 'daily' });

    const subs = await request(app).get(`/api/teacher/homework/${create.body.id}/submissions`).set(auth(teacher));
    expect(subs.body.length).toBeGreaterThan(0);
    expect(subs.body[0]).toMatchObject({ studentId: expect.any(String), status: 'pending' });

    expect((await request(app).delete(`/api/teacher/homework/${create.body.id}`).set(auth(teacher))).status).toBe(204);
    expect((await request(app).get('/api/teacher/homework').set(auth(teacher))).body.length).toBe(1);
  });

  it('cross-role /homework overview + role-gated edit appends an edit trail', async () => {
    const admin = await token('schooladmin');
    const overview = await request(app).get('/api/homework').set(auth(admin));
    expect(overview.body.length).toBe(1);
    const id = overview.body[0].id;
    const patch = await request(app).patch(`/api/homework/${id}`).set(auth(admin)).send({ title: 'Algebra worksheet (v2)' });
    expect(patch.body).toMatchObject({ title: 'Algebra worksheet (v2)', lastEditedBy: 'School Admin' });
    expect(patch.body.editHistory.length).toBe(1);
    expect(patch.body.createdBy).toBe('Teacher'); // original author preserved
  });

  it('assignments: list seeded, create, grade a submission, close, delete', async () => {
    const list = await request(app).get('/api/teacher/assignments').set(auth(teacher));
    expect(list.body.length).toBe(1);
    expect(list.body[0]).toMatchObject({ title: 'Science project', maxMarks: 20, totalStudents: expect.any(Number), pending: expect.any(Number) });
    const aid = list.body[0].id;

    const subs = await request(app).get(`/api/teacher/assignments/${aid}/submissions`).set(auth(teacher));
    expect(subs.body.length).toBeGreaterThan(0);
    const submitted = subs.body.find((s: { status: string }) => s.status === 'submitted');
    const grade = await request(app)
      .patch(`/api/teacher/assignments/${aid}/submissions/${submitted.studentId}/grade`)
      .set(auth(teacher))
      .send({ marks: 18, feedback: 'Great work' });
    expect(grade.body).toMatchObject({ status: 'graded', marks: 18, feedback: 'Great work' });

    const create = await request(app)
      .post('/api/teacher/assignments')
      .set(auth(teacher))
      .send({ title: 'Essay', classKey: 'Class 1-A', subject: 'Science', maxMarks: 10, dueDate: '2025-06-10' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ title: 'Essay', status: 'active', pending: expect.any(Number) });

    const close = await request(app).patch(`/api/teacher/assignments/${create.body.id}/close`).set(auth(teacher));
    expect(close.body.status).toBe('closed');
    expect((await request(app).delete(`/api/teacher/assignments/${create.body.id}`).set(auth(teacher))).status).toBe(204);
  });

  it('circulars: received published notices, create mine', async () => {
    const received = await request(app).get('/api/teacher/circulars/received').set(auth(teacher));
    expect(received.body.some((c: { title: string }) => c.title === 'Annual Day Notice')).toBe(true);

    expect((await request(app).get('/api/teacher/circulars/mine').set(auth(teacher))).body.length).toBe(0);
    const create = await request(app)
      .post('/api/teacher/circulars')
      .set(auth(teacher))
      .send({ title: 'Class 1 PTM', body: 'Parent-teacher meeting Saturday.', audience: ['staff'] });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ title: 'Class 1 PTM', createdByMe: true, status: 'published' });
    expect((await request(app).get('/api/teacher/circulars/mine').set(auth(teacher))).body.length).toBe(1);
  });

  it('leave: balance reflects approved usage, history, apply + cancel', async () => {
    const balance = await request(app).get('/api/teacher/leave/balance').set(auth(teacher));
    const casual = balance.body.find((b: { type: string }) => b.type === 'casual');
    expect(casual).toMatchObject({ allotted: 12, used: 2, remaining: 10 });

    const history = await request(app).get('/api/teacher/leave/history').set(auth(teacher));
    expect(history.body.length).toBe(2);

    const apply = await request(app)
      .post('/api/teacher/leave/apply')
      .set(auth(teacher))
      .send({ type: 'casual', fromDate: '2025-07-01', toDate: '2025-07-02', days: 2, reason: 'Travel' });
    expect(apply.status).toBe(201);
    expect(apply.body).toMatchObject({ status: 'pending', referenceNumber: expect.stringMatching(/^LV-/) });

    const cancel = await request(app).delete(`/api/teacher/leave/${apply.body.id}/cancel`).set(auth(teacher));
    expect(cancel.body.status).toBe('cancelled');
  });
});
