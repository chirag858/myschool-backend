import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { AttendanceModel } from '../attendance/attendance.models';
import { seedDemo } from '../../seed/seed';
import { StudentModel } from '../students/student.model';

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
  /** Clears the seeded coordinator's assignedClasses so leave-decision tests (which
   * don't care about class scoping) see every seeded leave, same as before scoping existed. */
  const unscopeCoord = async () => {
    const admin = await token('schooladmin');
    const me = await request(app).get('/api/auth/profile').set(auth(coord));
    const coordId = me.body._id ?? me.body.id;
    await request(app).patch(`/api/coordinator/assigned-classes/${coordId}`).set(auth(admin)).send({ classKeys: [] });
  };
  const leaveIds = async () => {
    await unscopeCoord();
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
    // Seeded coordinator's assignedClasses is ['Class 1-A', 'Class 2-A'] — 2 distinct
    // classes, 2 sections. Counts must reflect that scope, not the whole school.
    expect(res.body).toMatchObject({
      supervisedClassesCount: 2,
      supervisedSectionsCount: 2,
      acrossExamsCount: expect.any(Number),
    });
    // Seeded pending leaves belong to Nursery students — outside this coordinator's
    // Class-1/Class-2 scope, so they must not show up here.
    expect(res.body.recentStudentLeaves.length).toBe(0);
  });

  it('student-leaves scoping: a coordinator only sees leaves for students in their assignedClasses', async () => {
    const admin = await token('schooladmin');
    const meRes = await request(app).get('/api/auth/profile').set(auth(coord));
    const coordId = meRes.body._id ?? meRes.body.id;

    // Default scope (Class 1-A, Class 2-A) excludes the seeded Nursery leaves.
    const scoped = await request(app).get('/api/coordinator/student-leaves').set(auth(coord));
    expect(scoped.body.length).toBe(0);

    // Widen scope to include Nursery and the seeded leaves become visible.
    await request(app).patch(`/api/coordinator/assigned-classes/${coordId}`).set(auth(admin)).send({ classKeys: ['Nursery-A', 'Nursery-B'] });
    const widened = await request(app).get('/api/coordinator/student-leaves').set(auth(coord));
    expect(widened.body.length).toBe(3);

    // Unscoped (empty array) sees everything, same as school_admin/principal always do.
    await request(app).patch(`/api/coordinator/assigned-classes/${coordId}`).set(auth(admin)).send({ classKeys: [] });
    const unscoped = await request(app).get('/api/coordinator/student-leaves').set(auth(coord));
    expect(unscoped.body.length).toBe(3);
  });

  it('dashboard falls back to whole-school counts for an unscoped coordinator (no assignedClasses)', async () => {
    const admin = await token('schooladmin');
    const meRes = await request(app).get('/api/auth/profile').set(auth(coord));
    const coordId = meRes.body._id ?? meRes.body.id;
    await request(app).patch(`/api/coordinator/assigned-classes/${coordId}`).set(auth(admin)).send({ classKeys: [] });

    const res = await request(app).get('/api/coordinator/dashboard').set(auth(coord));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ supervisedClassesCount: 5, supervisedSectionsCount: 10 });
  });

  it('dashboard classesNotMarkedYet counts every unmarked class for an unscoped coordinator, not just the marked ones', async () => {
    const admin = await token('schooladmin');
    const meRes = await request(app).get('/api/auth/profile').set(auth(coord));
    const coordId = meRes.body._id ?? meRes.body.id;
    await request(app).patch(`/api/coordinator/assigned-classes/${coordId}`).set(auth(admin)).send({ classKeys: [] });

    // Mark today's attendance for exactly one class-section out of the
    // school's 10 (5 classes x 2 sections, per supervisedSectionsCount above).
    // The old bug computed the "unmarked" denominator from the marked set
    // itself, so classesNotMarkedYet was always 0 regardless of this.
    const students = await StudentModel.find({ className: 'Class 1', section: 'A' }).limit(1).lean();
    expect(students.length).toBe(1);
    const today = new Date().toISOString().slice(0, 10);
    await AttendanceModel.create([
      { schoolId: students[0].schoolId, studentId: students[0]._id, date: today, status: 'present', className: 'Class 1', section: 'A', markedBy: 'Test' },
    ]);

    const res = await request(app).get('/api/coordinator/dashboard').set(auth(coord));
    expect(res.status).toBe(200);
    expect(res.body.classesNotMarkedYet).toBe(9);
  });

  it('dashboard computes pendingStaffLeaves and pendingTasks from real data', async () => {
    const res = await request(app).get('/api/coordinator/dashboard').set(auth(coord));
    expect(res.status).toBe(200);
    // Seed has 1 L1-pending staff leave and 3 pending student leaves.
    expect(res.body.pendingStaffLeaves).toBe(1);
    expect(res.body.pendingTasks.length).toBeGreaterThan(0);
    expect(res.body.pendingTasks[0]).toMatchObject({ id: expect.any(String), description: expect.any(String), category: expect.any(String), priority: expect.any(Number) });
    expect(typeof res.body.attendanceTodayPercent).toBe('number');
    expect(typeof res.body.classesNotMarkedYet).toBe('number');
  });

  it('dashboard computes a real attendanceTodayPercent from today\'s marked attendance', async () => {
    // Seeded coordinator supervises Class 1-A and Class 2-A (2 classes). Mark
    // today's attendance for Class 1-A only, 1 present + 1 absent, and leave
    // Class 2-A unmarked — this exercises the ObjectId-cast $match in the
    // dashboard's attendance aggregation, not just its return type.
    const students = await StudentModel.find({ className: 'Class 1', section: 'A' }).limit(2).lean();
    expect(students.length).toBe(2);
    const today = new Date().toISOString().slice(0, 10);
    await AttendanceModel.create([
      { schoolId: students[0].schoolId, studentId: students[0]._id, date: today, status: 'present', className: 'Class 1', section: 'A', markedBy: 'Test' },
      { schoolId: students[1].schoolId, studentId: students[1]._id, date: today, status: 'absent', className: 'Class 1', section: 'A', markedBy: 'Test' },
    ]);

    const res = await request(app).get('/api/coordinator/dashboard').set(auth(coord));
    expect(res.status).toBe(200);
    expect(res.body.attendanceTodayPercent).toBe(50);
    // Class 1-A marked, Class 2-A still not marked -> exactly 1 of the 2 supervised classes pending.
    expect(res.body.classesNotMarkedYet).toBe(1);
  });

  it('student leaves: list seeded (pending), filter by status', async () => {
    await unscopeCoord();
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

  it('409 when re-deciding a leave that was already approved/rejected/forwarded', async () => {
    const [id1, id2, id3] = await leaveIds();
    expect((await request(app).patch(`/api/coordinator/student-leaves/${id1}/approve`).set(auth(coord)).send({})).status).toBe(200);
    // Same leave, decided again -> conflict, not a silent overwrite.
    const reApprove = await request(app).patch(`/api/coordinator/student-leaves/${id1}/approve`).set(auth(coord)).send({});
    expect(reApprove.status).toBe(409);
    const flipToRejected = await request(app).patch(`/api/coordinator/student-leaves/${id1}/reject`).set(auth(coord)).send({ reason: 'x' });
    expect(flipToRejected.status).toBe(409);

    expect((await request(app).patch(`/api/coordinator/student-leaves/${id2}/reject`).set(auth(coord)).send({ reason: 'no' })).status).toBe(200);
    expect((await request(app).patch(`/api/coordinator/student-leaves/${id2}/forward`).set(auth(coord)).send({})).status).toBe(409);

    expect((await request(app).patch(`/api/coordinator/student-leaves/${id3}/forward`).set(auth(coord)).send({})).status).toBe(200);
    expect((await request(app).patch(`/api/coordinator/student-leaves/${id3}/approve`).set(auth(coord)).send({})).status).toBe(409);
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

  it('409 when re-deciding a staff leave already escalated/rejected', async () => {
    const pending = await request(app).get('/api/coordinator/staff-leaves').set(auth(coord));
    const id = pending.body[0].id;

    expect((await request(app).patch(`/api/coordinator/staff-leaves/${id}/approve-level1`).set(auth(coord)).send({})).status).toBe(200);
    // Already escalated past L1 — re-approving must not silently re-run the escalation.
    const reApprove = await request(app).patch(`/api/coordinator/staff-leaves/${id}/approve-level1`).set(auth(coord)).send({});
    expect(reApprove.status).toBe(409);

    // Still 'pending' at level 2, so a reject on it is legitimate...
    expect((await request(app).patch(`/api/coordinator/staff-leaves/${id}/reject`).set(auth(coord)).send({ reason: 'no' })).status).toBe(200);
    // ...but rejecting it again must not succeed a second time.
    const reReject = await request(app).patch(`/api/coordinator/staff-leaves/${id}/reject`).set(auth(coord)).send({ reason: 'no again' });
    expect(reReject.status).toBe(409);
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

  it('marks overview is scoped to assignedClasses, unlike an unscoped admin view', async () => {
    const admin = await token('schooladmin');
    const exams = await request(app).get('/api/exams').set(auth(admin));
    const examId = (Array.isArray(exams.body) ? exams.body : exams.body.rows ?? []).find((e: { name: string }) => e.name === 'Mid Term 2025').id;

    const scoped = await request(app).get(`/api/coordinator/marks-overview?examId=${examId}`).set(auth(coord));
    const scopedKeys = new Set(scoped.body.map((r: { classKey: string }) => r.classKey));
    // Default scope is Class 1-A + Class 2-A only — nothing outside that should appear.
    for (const k of scopedKeys) expect(['Class 1-A', 'Class 2-A']).toContain(k);

    const meRes = await request(app).get('/api/auth/profile').set(auth(coord));
    const coordId = meRes.body._id ?? meRes.body.id;
    await request(app).patch(`/api/coordinator/assigned-classes/${coordId}`).set(auth(admin)).send({ classKeys: [] });
    const unscoped = await request(app).get(`/api/coordinator/marks-overview?examId=${examId}`).set(auth(coord));
    expect(unscoped.body.length).toBeGreaterThanOrEqual(scoped.body.length);
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

  it('staff-attendance: ?date= actually scopes the query, not silently defaulting to today', async () => {
    const admin = await token('schooladmin');
    const past = '2025-09-15';

    const todayView = await request(app).get('/api/coordinator/staff-attendance').set(auth(coord));
    expect(todayView.body.every((r: { status: string }) => r.status === 'not_marked')).toBe(true);

    const roster = await request(app).get(`/api/staff/attendance?date=${past}`).set(auth(admin));
    await request(app)
      .post('/api/staff/attendance/save')
      .set(auth(admin))
      .send({ date: past, attendance: roster.body.rows.map((r: { id: string }) => ({ staffId: r.id, status: 'present' })) });

    const pastView = await request(app).get(`/api/coordinator/staff-attendance?date=${past}`).set(auth(coord));
    expect(pastView.body.every((r: { status: string }) => r.status === 'present')).toBe(true);

    // Today's view is unaffected by the past-date write.
    const todayAgain = await request(app).get('/api/coordinator/staff-attendance').set(auth(coord));
    expect(todayAgain.body.every((r: { status: string }) => r.status === 'not_marked')).toBe(true);

    const exported = await request(app).get(`/api/coordinator/staff-attendance/export?date=${past}`).set(auth(coord));
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml');
  });

  it('exports students and staff-attendance as real .xlsx files', async () => {
    const students = await request(app).get('/api/coordinator/students/export').set(auth(coord));
    expect(students.status).toBe(200);
    expect(students.headers['content-type']).toContain('spreadsheetml');
    expect(students.headers['content-disposition']).toContain('coordinator-students.xlsx');

    const attendance = await request(app).get('/api/coordinator/staff-attendance/export').set(auth(coord));
    expect(attendance.status).toBe(200);
    expect(attendance.headers['content-type']).toContain('spreadsheetml');
    expect(attendance.headers['content-disposition']).toContain('coordinator-staff-attendance.xlsx');
  });

  it('messages a staff member by id and logs it to message history', async () => {
    const staffRes = await request(app).get('/api/coordinator/staff-overview').set(auth(coord));
    const staffId = staffRes.body[0].id;

    const res = await request(app)
      .post(`/api/coordinator/staff/${staffId}/message`)
      .set(auth(coord))
      .send({ body: 'Please submit pending marks by Friday.' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: expect.any(String), status: expect.stringMatching(/delivered|failed/), recipientName: expect.any(String) });

    // Too-short body is rejected.
    expect((await request(app).post(`/api/coordinator/staff/${staffId}/message`).set(auth(coord)).send({ body: 'Hi' })).status).toBe(400);
    // Unknown staff id 404s.
    expect((await request(app).post('/api/coordinator/staff/000000000000000000000000/message').set(auth(coord)).send({ body: 'Hello there' })).status).toBe(404);
  });

  it('students: scoped to the coordinator\'s assigned classes with real attendancePercent', async () => {
    const res = await request(app).get('/api/coordinator/students').set(auth(coord));
    expect(res.status).toBe(200);
    // Seed assigns the demo coordinator to Class 1-A and Class 2-A only.
    expect(res.body.length).toBeGreaterThan(0);
    for (const row of res.body) {
      expect(['Class 1-A', 'Class 2-A']).toContain(`${row.className}-${row.section}`);
      expect(typeof row.attendancePercent).toBe('number');
    }
  });

  it('assigned-classes: school_admin can set them, coordinator cannot', async () => {
    const admin = await token('schooladmin');
    const users = await request(app).get('/api/coordinator/students').set(auth(coord));
    void users;
    const meRes = await request(app).get('/api/auth/profile').set(auth(coord));
    const coordId = meRes.body._id ?? meRes.body.id;

    const forbidden = await request(app)
      .patch(`/api/coordinator/assigned-classes/${coordId}`)
      .set(auth(coord))
      .send({ classKeys: ['Class 1-A'] });
    expect(forbidden.status).toBe(403);

    const ok = await request(app)
      .patch(`/api/coordinator/assigned-classes/${coordId}`)
      .set(auth(admin))
      .send({ classKeys: ['Class 2-A'] });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: coordId, assignedClasses: ['Class 2-A'] });
  });

  it('assigned-classes is a capability any non-teacher staff login can hold, not just role coordinator', async () => {
    const admin = await token('schooladmin');
    const acc = await request(app).get('/api/auth/profile').set(auth(await token('accountant')));
    const accId = acc.body._id ?? acc.body.id;

    const ok = await request(app)
      .patch(`/api/coordinator/assigned-classes/${accId}`)
      .set(auth(admin))
      .send({ classKeys: ['Class 1-A'] });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: accId, assignedClasses: ['Class 1-A'] });
  });

  it('assigned-classes rejects an unknown class/section and rejects teachers (they use class-incharge)', async () => {
    const admin = await token('schooladmin');
    const meRes = await request(app).get('/api/auth/profile').set(auth(coord));
    const coordId = meRes.body._id ?? meRes.body.id;

    const badKey = await request(app)
      .patch(`/api/coordinator/assigned-classes/${coordId}`)
      .set(auth(admin))
      .send({ classKeys: ['Class 99-Z'] });
    expect(badKey.status).toBe(400);

    const teacherRes = await request(app).get('/api/auth/profile').set(auth(await token('teacher')));
    const teacherId = teacherRes.body._id ?? teacherRes.body.id;
    const onTeacher = await request(app)
      .patch(`/api/coordinator/assigned-classes/${teacherId}`)
      .set(auth(admin))
      .send({ classKeys: ['Class 1-A'] });
    expect(onTeacher.status).toBe(400);
  });

  it('teacher-assignments: school_admin can create/update/delete; coordinator can only read', async () => {
    const admin = await token('schooladmin');
    const teachers = await request(app).get('/api/coordinator/teachers').set(auth(coord));
    expect(teachers.status).toBe(200);
    expect(teachers.body.length).toBeGreaterThan(0);
    const teacherId = teachers.body[0].id;

    const forbidden = await request(app)
      .post('/api/coordinator/teacher-assignments')
      .set(auth(coord))
      .send({ teacherUserId: teacherId, className: 'Class 3', section: 'A', subjects: ['Maths'], periodsPerWeek: 5 });
    expect(forbidden.status).toBe(403);

    const create = await request(app)
      .post('/api/coordinator/teacher-assignments')
      .set(auth(admin))
      .send({ teacherUserId: teacherId, className: 'Class 3', section: 'A', subjects: ['Maths'], periodsPerWeek: 5 });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({
      teacherUserId: teacherId,
      className: 'Class 3',
      section: 'A',
      classKey: 'Class 3-A',
      subjects: ['Maths'],
      periodsPerWeek: 5,
    });

    const list = await request(app).get('/api/coordinator/teacher-assignments').set(auth(coord));
    expect(list.status).toBe(200);
    expect(list.body.some((a: { id: string }) => a.id === create.body.id)).toBe(true);

    // Re-saving the same (teacher, class, section) upserts rather than duplicating.
    const update = await request(app)
      .post('/api/coordinator/teacher-assignments')
      .set(auth(admin))
      .send({ teacherUserId: teacherId, className: 'Class 3', section: 'A', subjects: ['Maths', 'Science'], periodsPerWeek: 8 });
    expect(update.body.id).toBe(create.body.id);
    expect(update.body.subjects).toEqual(['Maths', 'Science']);

    const delForbidden = await request(app).delete(`/api/coordinator/teacher-assignments/${create.body.id}`).set(auth(coord));
    expect(delForbidden.status).toBe(403);

    const del = await request(app).delete(`/api/coordinator/teacher-assignments/${create.body.id}`).set(auth(admin));
    expect(del.status).toBe(204);
    expect((await request(app).delete(`/api/coordinator/teacher-assignments/${create.body.id}`).set(auth(admin))).status).toBe(404);
  });

  it('teacher-assignments: ?teacherUserId= filters to just that teacher', async () => {
    const admin = await token('schooladmin');
    const teachers = await request(app).get('/api/coordinator/teachers').set(auth(coord));
    expect(teachers.body.length).toBeGreaterThanOrEqual(1);
    const [teacherA] = teachers.body;

    await request(app)
      .post('/api/coordinator/teacher-assignments')
      .set(auth(admin))
      .send({ teacherUserId: teacherA.id, className: 'Class 4', section: 'A', subjects: ['English'], periodsPerWeek: 4 });

    const filtered = await request(app)
      .get(`/api/coordinator/teacher-assignments?teacherUserId=${teacherA.id}`)
      .set(auth(coord));
    expect(filtered.status).toBe(200);
    expect(filtered.body.length).toBeGreaterThan(0);
    expect(filtered.body.every((a: { teacherUserId: string }) => a.teacherUserId === teacherA.id)).toBe(true);

    const unfiltered = await request(app).get('/api/coordinator/teacher-assignments').set(auth(coord));
    expect(unfiltered.body.length).toBeGreaterThanOrEqual(filtered.body.length);
  });
});
