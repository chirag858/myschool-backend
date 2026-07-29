import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const CS = 'Class 1-A';

describe('Teacher App API (mobile)', () => {
  let teacher: string;
  beforeEach(async () => {
    await seedDemo();
    teacher = await token('teacher');
  });

  it('teaching returns class-teacher + subject-teacher cohorts', async () => {
    const res = await request(app).get('/api/teacher/teaching').set(auth(teacher));
    expect(res.status).toBe(200);
    expect(res.body.classTeacher.length).toBe(1);
    expect(res.body.classTeacher[0]).toMatchObject({ kind: 'class_teacher', classSectionId: CS });
    expect(res.body.subjectTeacher.length).toBeGreaterThanOrEqual(2);
    expect(res.body.subjectTeacher[0]).toMatchObject({ kind: 'subject_teacher', subject: expect.any(String) });
  });

  it('roster returns the class-section students', async () => {
    const res = await request(app).get(`/api/teacher/roster?classSectionId=${encodeURIComponent(CS)}`).set(auth(teacher));
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), roll: expect.any(String) });
  });

  it('dashboard flags class-sections pending attendance', async () => {
    const res = await request(app).get('/api/teacher/dashboard').set(auth(teacher));
    expect(res.body).toMatchObject({ today: expect.any(Array), attendancePending: expect.any(Array), badges: expect.any(Object) });
  });

  it('attendance: mark then read back (locked in the past)', async () => {
    const roster = (await request(app).get(`/api/teacher/roster?classSectionId=${encodeURIComponent(CS)}`).set(auth(teacher))).body;
    expect(roster.length).toBeGreaterThan(0);
    const date = new Date().toISOString().slice(0, 10);
    const entries = roster.map((s: { id: string }, i: number) => ({ studentId: s.id, status: i === 0 ? 'absent' : 'present' }));
    const submit = await request(app).post('/api/teacher/attendance/submit').set(auth(teacher)).send({ classSectionId: CS, date, entries });
    expect(submit.body).toMatchObject({ recorded: true, editable: true, classSectionId: CS });
    expect(submit.body.entries.length).toBe(roster.length);
    const read = await request(app).get(`/api/teacher/attendance?classSectionId=${encodeURIComponent(CS)}&date=${date}`).set(auth(teacher));
    expect(read.body.recorded).toBe(true);
  });

  it('assignment-mgmt: create → list → submissions → grade', async () => {
    const create = await request(app).post('/api/teacher/assignment-mgmt').set(auth(teacher))
      .send({ classSectionId: CS, subject: 'Mathematics', title: 'Algebra set', description: 'Q1-5', dueDate: '2026-09-10', maxMarks: 20 });
    expect(create.status).toBe(201);
    const id = create.body.id;
    const list = await request(app).get(`/api/teacher/assignment-mgmt?classSectionId=${encodeURIComponent(CS)}`).set(auth(teacher));
    expect(list.body.some((a: { id: string }) => a.id === id)).toBe(true);

    const subs = await request(app).get(`/api/teacher/assignment-mgmt/submissions?assignmentId=${id}`).set(auth(teacher));
    expect(subs.body).toMatchObject({ assignment: expect.any(Object), submissions: expect.any(Array), summary: expect.any(Object) });
    const studentId = subs.body.submissions[0].studentId;

    const graded = await request(app).post('/api/teacher/assignment-mgmt/grade').set(auth(teacher))
      .send({ assignmentId: id, studentId, marks: 18, feedback: 'Good' });
    expect(graded.body.summary.graded).toBeGreaterThanOrEqual(1);

    expect((await request(app).post('/api/teacher/assignment-mgmt/deactivate').set(auth(teacher)).send({ id })).status).toBe(200);
    const after = await request(app).get(`/api/teacher/assignment-mgmt?classSectionId=${encodeURIComponent(CS)}`).set(auth(teacher));
    expect(after.body.some((a: { id: string }) => a.id === id)).toBe(false);
  });

  it('content: create → list → update → soft-delete', async () => {
    const seeded = await request(app).get(`/api/teacher/content?type=homework&classSectionId=${encodeURIComponent(CS)}`).set(auth(teacher));
    expect(seeded.body.length).toBeGreaterThanOrEqual(1);
    const create = await request(app).post('/api/teacher/content').set(auth(teacher))
      .send({ type: 'classwork', classSectionId: CS, subject: 'Science', title: 'Water cycle', body: 'Diagram' });
    expect(create.status).toBe(201);
    const upd = await request(app).post('/api/teacher/content/update').set(auth(teacher)).send({ id: create.body.id, type: 'classwork', title: 'Water cycle v2', body: 'Diagram + notes' });
    expect(upd.body.title).toBe('Water cycle v2');
    expect((await request(app).post('/api/teacher/content/deactivate').set(auth(teacher)).send({ id: create.body.id })).status).toBe(200);
    const list = await request(app).get(`/api/teacher/content?type=classwork&classSectionId=${encodeURIComponent(CS)}`).set(auth(teacher));
    expect(list.body.some((c: { id: string }) => c.id === create.body.id)).toBe(false);
  });

  it('marks: assessments list, enter marks, server computes the preview + publish locks', async () => {
    const assessments = await request(app).get('/api/teacher/assessments?subjectId=Mathematics').set(auth(teacher));
    expect(assessments.body.length).toBeGreaterThanOrEqual(1);
    const aId = assessments.body[0].id;
    expect(assessments.body[0].components.length).toBe(2);

    const sheet = await request(app).get(`/api/teacher/marks?assessmentId=${aId}&classSectionId=${encodeURIComponent(CS)}`).set(auth(teacher));
    const sid = sheet.body.rows[0].studentId;
    const save = await request(app).post('/api/teacher/marks/save').set(auth(teacher))
      .send({ assessmentId: aId, classSectionId: CS, rows: [{ studentId: sid, marks: { theory: 36, practical: 9 } }], action: 'draft' });
    const preview = save.body.preview.find((p: { studentId: string }) => p.studentId === sid);
    expect(preview).toMatchObject({ total: 45, percentage: 90, grade: 'A+', result: 'pass' });

    // publish locks further edits (409)
    await request(app).post('/api/teacher/marks/save').set(auth(teacher)).send({ assessmentId: aId, classSectionId: CS, rows: [], action: 'publish' });
    const locked = await request(app).post('/api/teacher/marks/save').set(auth(teacher)).send({ assessmentId: aId, classSectionId: CS, rows: [{ studentId: sid, marks: { theory: 10 } }], action: 'draft' });
    expect(locked.status).toBe(409);
  });

  it('performance: class rows + a single student breakdown', async () => {
    const rows = await request(app).get(`/api/teacher/performance?classSectionId=${encodeURIComponent(CS)}`).set(auth(teacher));
    expect(rows.body.length).toBeGreaterThan(0);
    expect(rows.body[0]).toMatchObject({ studentId: expect.any(String), attendancePct: expect.any(Number), assignmentsTotal: expect.any(Number) });
    const sid = rows.body[0].studentId;
    const one = await request(app).get(`/api/teacher/performance/student?classSectionId=${encodeURIComponent(CS)}&studentId=${sid}`).set(auth(teacher));
    expect(one.body).toMatchObject({ student: expect.objectContaining({ id: sid }), assessments: expect.any(Array), assignments: expect.any(Object) });
  });
});
