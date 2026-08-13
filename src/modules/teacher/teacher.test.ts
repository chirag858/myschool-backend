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

  it('my-classes returns only the teacher’s single incharge class', async () => {
    const res = await request(app).get('/api/teacher/my-classes').set(auth(teacher));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    const c1 = res.body[0];
    expect(c1).toMatchObject({ classKey: 'Class 1-A', className: 'Class 1', section: 'A', totalStudents: expect.any(Number) });
    expect(c1.subjects).toContain('Mathematics');
    expect(c1.totalStudents).toBeGreaterThan(0);
    expect(c1.attendanceToday).toMatchObject({ status: expect.any(String) });
  });

  it('my-classes is empty and management endpoints 403 when no incharge class is set', async () => {
    const { UserModel } = await import('../user/user.model');
    const { SectionModel } = await import('../academics/academics.models');
    const me = await UserModel.findOne({ username: 'teacher' }).lean();
    await SectionModel.updateMany({ classTeacherId: String(me!._id) }, { $set: { classTeacherId: null, classTeacherName: null } });

    expect((await request(app).get('/api/teacher/my-classes').set(auth(teacher))).body).toEqual([]);
    expect((await request(app).get('/api/teacher/my-students').set(auth(teacher))).body).toEqual([]);

    // Losing the incharge class doesn't take away homework/assignment
    // creation for subjects still timetabled to them — that right comes
    // from the timetable, not incharge status.
    const stillTeaching = await request(app)
      .post('/api/teacher/homework')
      .set(auth(teacher))
      .send({ classKey: 'Class 1-A', subject: 'Mathematics', title: 'x', dueDate: '2025-06-01' });
    expect(stillTeaching.status).toBe(201);

    const notTeaching = await request(app)
      .post('/api/teacher/homework')
      .set(auth(teacher))
      .send({ classKey: 'Nursery-A', subject: 'English', title: 'x', dueDate: '2025-06-01' });
    expect(notTeaching.status).toBe(403);
  });

  it('homework/assignment creation is allowed for any class/subject the teacher teaches per the timetable, not just their incharge class', async () => {
    // The demo teacher's incharge class is Class 1-A, but they also teach
    // English in Class 2-A per the seeded timetable — that must be allowed.
    const hw = await request(app)
      .post('/api/teacher/homework')
      .set(auth(teacher))
      .send({ classKey: 'Class 2-A', subject: 'English', title: 'Reading assignment', dueDate: '2025-06-01' });
    expect(hw.status).toBe(201);

    const asg = await request(app)
      .post('/api/teacher/assignments')
      .set(auth(teacher))
      .send({ title: 'Essay', classKey: 'Class 2-A', subject: 'English', maxMarks: 10, dueDate: '2999-06-10' });
    expect(asg.status).toBe(201);
  });

  it('homework/assignment/circular creation is rejected for a class/subject the teacher neither teaches nor is incharge of', async () => {
    const hw = await request(app)
      .post('/api/teacher/homework')
      .set(auth(teacher))
      .send({ classKey: 'Nursery-A', subject: 'English', title: 'Not my class', dueDate: '2025-06-01' });
    expect(hw.status).toBe(403);

    // Class 1-A is the incharge class, but the teacher doesn't teach English
    // there (only Mathematics/Science) — incharge only widens to subjects
    // actually timetabled in that class.
    const hwWrongSubject = await request(app)
      .post('/api/teacher/homework')
      .set(auth(teacher))
      .send({ classKey: 'Class 1-A', subject: 'English', title: 'Wrong subject', dueDate: '2025-06-01' });
    expect(hwWrongSubject.status).toBe(403);

    const asg = await request(app)
      .post('/api/teacher/assignments')
      .set(auth(teacher))
      .send({ title: 'Not my class', classKey: 'Nursery-A', subject: 'English', maxMarks: 10, dueDate: '2999-06-10' });
    expect(asg.status).toBe(403);

    // Circulars stay incharge-only (whole-class audience targeting, not a
    // subject-scoped action) — Class 2-A isn't the incharge class even
    // though the teacher teaches a subject there.
    const cir = await request(app)
      .post('/api/teacher/circulars')
      .set(auth(teacher))
      .send({ title: 'Wrong class', body: 'x', audience: ['staff'], audienceClasses: ['Class 2-A'] });
    expect(cir.status).toBe(403);
  });

  it('my-students returns roster scoped to the incharge class only', async () => {
    const all = await request(app).get('/api/teacher/my-students').set(auth(teacher));
    expect(all.body.length).toBeGreaterThan(0);
    expect(all.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), attendancePercent: expect.any(Number) });
    expect(all.body.every((s: { className: string; section: string }) => s.className === 'Class 1' && s.section === 'A')).toBe(true);
    const c1 = await request(app).get('/api/teacher/my-students?classKey=Class 1-A').set(auth(teacher));
    expect(c1.body.length).toBe(all.body.length);
  });

  it('my-exams returns rows for every class/subject the teacher teaches, unaffected by the incharge restriction', async () => {
    const res = await request(app).get('/api/teacher/my-exams').set(auth(teacher));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // The demo teacher teaches in both Class 1-A and Class 2-A, but is only
    // incharge of Class 1-A — marks entry must still cover both.
    const classKeys = new Set(res.body.map((r: { classKey: string }) => r.classKey));
    if (res.body.length) {
      expect(res.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), classKey: expect.any(String), subject: expect.any(String) });
      expect(classKeys.has('Class 2-A')).toBe(true);
    }
  });

  it('my-exams matches exams whose `classes` list stores full classKeys (with section), not just bare class names', async () => {
    const admin = await token('schooladmin');
    // Some exams store `classes` as bare names ("Class 1"), others as full
    // classKeys ("Class 1-A") — a teacher's assignment must match either.
    const create = await request(app)
      .post('/api/exams')
      .set(auth(admin))
      .send({ name: 'Section-keyed Exam', type: 'unit_test', classes: ['Class 2-A'] });
    expect(create.status).toBe(201);

    const res = await request(app).get('/api/teacher/my-exams').set(auth(teacher));
    const rows = res.body.filter((r: { examId: string }) => r.examId === create.body.id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r: { classKey: string; subject: string }) => r.classKey === 'Class 2-A' && r.subject === 'English')).toBe(true);
  });

  it('dashboard-summary aggregates the single incharge class + exams/homework into KPIs and pending tasks', async () => {
    const res = await request(app).get('/api/teacher/dashboard-summary').set(auth(teacher));
    expect(res.status).toBe(200);
    expect(res.body.kpis).toMatchObject({
      classes: 1,
      attendancePending: expect.any(Number),
      homeworkPending: expect.any(Number),
      marksPending: expect.any(Number),
    });
    expect(res.body.classesToday).toHaveLength(1);
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

  it('homework submissions persist, drive the counter, and can be reminded', async () => {
    const list = await request(app).get('/api/teacher/homework').set(auth(teacher));
    const id = list.body[0].id;

    const subs = await request(app).get(`/api/teacher/homework/${id}/submissions`).set(auth(teacher));
    expect(subs.body.length).toBeGreaterThan(0);
    expect(subs.body.every((s: { status: string }) => s.status === 'pending')).toBe(true);
    const studentId = subs.body[0].studentId;

    const marked = await request(app)
      .patch(`/api/teacher/homework/${id}/submissions/${studentId}`)
      .set(auth(teacher))
      .send({ status: 'graded', marks: 8, remark: 'Neat' });
    expect(marked.body).toMatchObject({ status: 'graded', marks: 8, remark: 'Neat' });
    expect(marked.body.submittedAt).toBeTruthy();

    // The stored rows are the source of truth for the homework's counter.
    expect((await request(app).get(`/api/teacher/homework/${id}`).set(auth(teacher))).body.submissions).toBe(1);

    // Re-reading returns the persisted row, not a fresh pending one.
    const again = await request(app).get(`/api/teacher/homework/${id}/submissions`).set(auth(teacher));
    expect(again.body.find((s: { studentId: string }) => s.studentId === studentId).status).toBe('graded');

    const remind = await request(app).post(`/api/teacher/homework/${id}/remind`).set(auth(teacher));
    expect(remind.body.sent).toBe(again.body.length - 1);
    const after = await request(app).get(`/api/teacher/homework/${id}/submissions`).set(auth(teacher));
    expect(after.body.filter((s: { reminderSentAt?: string }) => s.reminderSentAt).length).toBe(again.body.length - 1);
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

  it('a coordinator with a non-empty assignedClasses only sees/edits homework for their supervised classes', async () => {
    const coord = await token('coordinator');
    const admin = await token('schooladmin');

    // Seeded homework is Class 1-A — within the seeded coordinator's
    // assignedClasses (['Class 1-A', 'Class 2-A']).
    const overview = await request(app).get('/api/homework').set(auth(coord));
    expect(overview.body.length).toBe(1);
    expect(overview.body[0].classKey).toBe('Class 1-A');
    const id = overview.body[0].id;

    // In-scope edit succeeds.
    const patch = await request(app).patch(`/api/homework/${id}`).set(auth(coord)).send({ title: 'Coordinator edit' });
    expect(patch.status).toBe(200);

    // Requesting an out-of-scope class explicitly returns nothing, not a leak.
    const outOfScope = await request(app).get('/api/homework?classKey=Nursery-A').set(auth(coord));
    expect(outOfScope.body).toEqual([]);

    // Moving homework to an out-of-scope class is refused.
    const moveOut = await request(app).patch(`/api/homework/${id}`).set(auth(coord)).send({ classKey: 'Nursery-A' });
    expect(moveOut.status).toBe(403);

    // Unscope the coordinator — now unrestricted like before.
    const meRes = await request(app).get('/api/auth/profile').set(auth(coord));
    const coordId = meRes.body._id ?? meRes.body.id;
    await request(app).patch(`/api/coordinator/assigned-classes/${coordId}`).set(auth(admin)).send({ classKeys: [] });
    const unscoped = await request(app).get('/api/homework?classKey=Nursery-A').set(auth(coord));
    expect(unscoped.status).toBe(200);
  });

  it('assignments: list seeded, create, grade a submission, close, delete', async () => {
    const list = await request(app).get('/api/teacher/assignments').set(auth(teacher));
    expect(list.body.length).toBe(1);
    expect(list.body[0]).toMatchObject({ title: 'Science project', maxMarks: 20, totalStudents: expect.any(Number), pending: expect.any(Number) });
    const aid = list.body[0].id;

    // Rows start genuinely pending — nothing is handed in until the teacher says so.
    const subs = await request(app).get(`/api/teacher/assignments/${aid}/submissions`).set(auth(teacher));
    expect(subs.body.length).toBeGreaterThan(0);
    expect(subs.body.every((s: { status: string }) => s.status === 'pending')).toBe(true);
    const studentId = subs.body[0].studentId;

    const receive = await request(app)
      .patch(`/api/teacher/assignments/${aid}/submissions/${studentId}`)
      .set(auth(teacher))
      .send({ status: 'submitted', fileName: 'project.pdf' });
    // Seeded assignment is already past due, so a hand-in lands as `late`.
    expect(['submitted', 'late']).toContain(receive.body.status);
    expect(receive.body.submittedAt).toBeTruthy();

    const grade = await request(app)
      .patch(`/api/teacher/assignments/${aid}/submissions/${studentId}/grade`)
      .set(auth(teacher))
      .send({ marks: 18, feedback: 'Great work' });
    expect(grade.body).toMatchObject({ status: 'graded', marks: 18, feedback: 'Great work' });

    // Marks above the assignment's maxMarks are rejected.
    const tooHigh = await request(app)
      .patch(`/api/teacher/assignments/${aid}/submissions/${studentId}/grade`)
      .set(auth(teacher))
      .send({ marks: 999, feedback: '' });
    expect(tooHigh.status).toBe(400);

    // Editing an assignment persists.
    const edit = await request(app).patch(`/api/teacher/assignments/${aid}`).set(auth(teacher)).send({ title: 'Science project (v2)' });
    expect(edit.body).toMatchObject({ title: 'Science project (v2)', graded: 1 });

    const create = await request(app)
      .post('/api/teacher/assignments')
      .set(auth(teacher))
      .send({ title: 'Essay', classKey: 'Class 1-A', subject: 'Science', maxMarks: 10, dueDate: '2999-06-10' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ title: 'Essay', status: 'active', pending: expect.any(Number) });

    // `overdue` is derived from the due date, never stored.
    const past = await request(app)
      .post('/api/teacher/assignments')
      .set(auth(teacher))
      .send({ title: 'Old essay', classKey: 'Class 1-A', subject: 'Science', maxMarks: 10, dueDate: '2020-01-01' });
    expect(past.body.status).toBe('overdue');

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

    const id = create.body.id;
    const edit = await request(app).patch(`/api/teacher/circulars/${id}`).set(auth(teacher)).send({ title: 'Class 1 PTM (moved)', priority: 'urgent' });
    expect(edit.body).toMatchObject({ title: 'Class 1 PTM (moved)', priority: 'urgent' });

    // Reading counts a view.
    expect((await request(app).post(`/api/teacher/circulars/${id}/read`).set(auth(teacher))).body.views).toBe(1);

    // Someone else's circular is not editable or deletable.
    const admin = await token('schooladmin');
    const foreign = (await request(app).get('/api/teacher/circulars/received').set(auth(admin))).body.find(
      (c: { createdByMe: boolean }) => !c.createdByMe,
    );
    expect((await request(app).patch(`/api/teacher/circulars/${foreign.id}`).set(auth(admin)).send({ title: 'nope' })).status).toBe(403);

    expect((await request(app).delete(`/api/teacher/circulars/${id}`).set(auth(teacher))).status).toBe(204);
    expect((await request(app).get('/api/teacher/circulars/mine').set(auth(teacher))).body.length).toBe(0);
  });

  it('a teacher cannot edit another teacher’s homework', async () => {
    const admin = await token('schooladmin');
    // Admin creates homework, so it is not owned by the demo teacher.
    const mine = (await request(app).get('/api/teacher/homework').set(auth(admin))).body;
    expect(mine.length).toBe(0);

    const id = (await request(app).get('/api/homework').set(auth(admin))).body[0].id;
    // The seeded homework belongs to the teacher — the admin may still edit it.
    expect((await request(app).patch(`/api/homework/${id}`).set(auth(admin)).send({ title: 'Admin edit' })).status).toBe(200);

    const other = await request(app)
      .post('/api/teacher/homework')
      .set(auth(admin))
      .send({ classKey: 'Class 1-A', subject: 'Science', title: 'Admin homework', dueDate: '2025-06-20' });
    expect((await request(app).patch(`/api/homework/${other.body.id}`).set(auth(teacher)).send({ title: 'stolen' })).status).toBe(403);
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

  it('leave: school_admin/principal can list and review pending applications; a teacher cannot', async () => {
    const admin = await token('schooladmin');
    const principal = await token('principal');

    const apply = await request(app)
      .post('/api/teacher/leave/apply')
      .set(auth(teacher))
      .send({ type: 'sick', fromDate: '2025-08-01', toDate: '2025-08-02', days: 2, reason: 'Fever' });
    expect(apply.status).toBe(201);

    // A teacher may not list or review the review queue — only admin/principal.
    expect((await request(app).get('/api/teacher/leave/all-pending').set(auth(teacher))).status).toBe(403);
    expect(
      (await request(app).patch(`/api/teacher/leave/${apply.body.id}/review`).set(auth(teacher)).send({ action: 'approve' })).status,
    ).toBe(403);

    const pending = await request(app).get('/api/teacher/leave/all-pending').set(auth(admin));
    expect(pending.status).toBe(200);
    expect(pending.body.some((r: { id: string; teacherName: string }) => r.id === apply.body.id && r.teacherName)).toBe(true);

    const approve = await request(app)
      .patch(`/api/teacher/leave/${apply.body.id}/review`)
      .set(auth(principal))
      .send({ action: 'approve', remarks: 'Get well soon' });
    expect(approve.status).toBe(200);
    expect(approve.body).toMatchObject({ status: 'approved', decidedBy: 'Principal', remarks: 'Get well soon' });

    // Already decided — re-deciding is rejected, not silently re-applied.
    expect(
      (await request(app).patch(`/api/teacher/leave/${apply.body.id}/review`).set(auth(admin)).send({ action: 'reject' })).status,
    ).toBe(409);

    // Decided leaves drop off the pending queue.
    const pendingAfter = await request(app).get('/api/teacher/leave/all-pending').set(auth(admin));
    expect(pendingAfter.body.some((r: { id: string }) => r.id === apply.body.id)).toBe(false);
  });
});
