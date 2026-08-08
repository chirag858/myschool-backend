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

describe('Timetable API', () => {
  let admin: string;
  let teacher: string;

  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
    teacher = await token('teacher');
  });

  // ─── Authentication & Authorization ─────────────────────────────────
  it('requires authentication (401)', async () => {
    expect((await request(app).get('/api/timetable/config/periods')).status).toBe(401);
  });

  it('allows teachers to read but not edit', async () => {
    const read = await request(app).get('/api/timetable/config/periods').set(auth(teacher));
    expect(read.status).toBe(200);

    const edit = await request(app)
      .post('/api/timetable/config/periods/save')
      .set(auth(teacher))
      .send({ periods: [] });
    expect(edit.status).toBe(403);
  });

  // ─── Periods ────────────────────────────────────────────────────────
  it('GET /timetable/config/periods returns empty array initially', async () => {
    const res = await request(app).get('/api/timetable/config/periods').set(auth(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('POST /timetable/config/periods/save saves periods', async () => {
    const periods = [
      { order: 0, name: 'Period 1', startTime: '08:00', endTime: '08:45', type: 'class', applicableDays: 'all' },
      { order: 1, name: 'Period 2', startTime: '08:50', endTime: '09:35', type: 'class', applicableDays: 'all' },
      { order: 2, name: 'Break', startTime: '09:35', endTime: '09:50', type: 'break', applicableDays: 'all' },
    ];
    const save = await request(app)
      .post('/api/timetable/config/periods/save')
      .set(auth(admin))
      .send({ periods });
    expect(save.status).toBe(200);
    expect(save.body.success).toBe(true);

    const get = await request(app).get('/api/timetable/config/periods').set(auth(admin));
    expect(get.body.length).toBe(3);
    expect(get.body[0]).toMatchObject({ name: 'Period 1', startTime: '08:00', endTime: '08:45' });
  });

  // ─── Subjects ───────────────────────────────────────────────────────
  it('CRUD operations on subjects', async () => {
    // Create
    const create = await request(app)
      .post('/api/timetable/config/subjects')
      .set(auth(admin))
      .send({
        name: 'Mathematics',
        code: 'MATH',
        type: 'core',
        applicableClasses: 'all',
        maxWeeklyPeriods: 6,
        color: '#3B82F6',
      });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ name: 'Mathematics', code: 'MATH' });
    const subjectId = create.body.id;

    // Read
    const list = await request(app).get('/api/timetable/config/subjects').set(auth(admin));
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    // Update
    const update = await request(app)
      .put(`/api/timetable/config/subjects/${subjectId}`)
      .set(auth(admin))
      .send({ maxWeeklyPeriods: 7 });
    expect(update.status).toBe(200);
    expect(update.body.maxWeeklyPeriods).toBe(7);

    // Delete
    const del = await request(app)
      .delete(`/api/timetable/config/subjects/${subjectId}`)
      .set(auth(admin));
    expect(del.status).toBe(200);

    const list2 = await request(app).get('/api/timetable/config/subjects').set(auth(admin));
    expect(list2.body.length).toBe(0);
  });

  // ─── Rooms ──────────────────────────────────────────────────────────
  it('CRUD operations on rooms', async () => {
    // Create
    const create = await request(app)
      .post('/api/timetable/config/rooms')
      .set(auth(admin))
      .send({
        name: 'Room 101',
        type: 'classroom',
        capacity: 40,
        floor: 'G',
        facilities: ['projector', 'ac'],
        status: 'available',
      });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ name: 'Room 101', capacity: 40 });
    const roomId = create.body.id;

    // Read
    const list = await request(app).get('/api/timetable/config/rooms').set(auth(admin));
    expect(list.status).toBe(200);
    expect(list.body.length).toBe(1);

    // Update
    const update = await request(app)
      .put(`/api/timetable/config/rooms/${roomId}`)
      .set(auth(admin))
      .send({ capacity: 45 });
    expect(update.status).toBe(200);
    expect(update.body.capacity).toBe(45);

    // Delete
    const del = await request(app).delete(`/api/timetable/config/rooms/${roomId}`).set(auth(admin));
    expect(del.status).toBe(200);
  });

  // ─── Timetable Slots & Conflict Detection ───────────────────────────
  it('creates a timetable slot and retrieves it', async () => {
    // Create subject and room first
    const subject = await request(app)
      .post('/api/timetable/config/subjects')
      .set(auth(admin))
      .send({
        name: 'Physics',
        code: 'PHY',
        type: 'core',
        applicableClasses: 'all',
        maxWeeklyPeriods: 5,
        color: '#EF4444',
      });

    const room = await request(app)
      .post('/api/timetable/config/rooms')
      .set(auth(admin))
      .send({
        name: 'Lab 1',
        type: 'lab',
        capacity: 30,
        floor: '1',
        facilities: ['projector'],
        status: 'available',
      });

    const slotPayload = {
      classId: 'Class-9',
      section: 'A',
      day: 'mon',
      periodId: 'p1',
      subjectId: subject.body.id,
      subjectName: 'Physics',
      subjectColor: '#EF4444',
      teacherId: 'teacher123',
      teacherName: 'Dr. Sharma',
      roomId: room.body.id,
      roomName: 'Lab 1',
    };

    const save = await request(app)
      .post('/api/timetable/Class-9/save')
      .set(auth(admin))
      .send(slotPayload);
    expect(save.status).toBe(200);
    expect(save.body).toMatchObject({ day: 'mon', periodId: 'p1', subjectName: 'Physics' });

    const get = await request(app)
      .get('/api/timetable/Class-9?section=A')
      .set(auth(admin));
    expect(get.status).toBe(200);
    expect(get.body.slots.length).toBe(1);
    expect(get.body.slots[0]).toMatchObject({ subjectName: 'Physics', teacherName: 'Dr. Sharma' });
  });

  it('detects teacher overlap conflict', async () => {
    const subject = await request(app)
      .post('/api/timetable/config/subjects')
      .set(auth(admin))
      .send({
        name: 'Chemistry',
        code: 'CHEM',
        type: 'core',
        applicableClasses: 'all',
        maxWeeklyPeriods: 5,
        color: '#10B981',
      });

    const room1 = await request(app)
      .post('/api/timetable/config/rooms')
      .set(auth(admin))
      .send({ name: 'Room 201', type: 'classroom', capacity: 40, floor: '2', facilities: [], status: 'available' });

    const room2 = await request(app)
      .post('/api/timetable/config/rooms')
      .set(auth(admin))
      .send({ name: 'Room 202', type: 'classroom', capacity: 40, floor: '2', facilities: [], status: 'available' });

    // Save slot for Class-10-A with teacher123
    await request(app)
      .post('/api/timetable/Class-10/save')
      .set(auth(admin))
      .send({
        classId: 'Class-10',
        section: 'A',
        day: 'tue',
        periodId: 'p2',
        subjectId: subject.body.id,
        subjectName: 'Chemistry',
        subjectColor: '#10B981',
        teacherId: 'teacher123',
        teacherName: 'Dr. Kumar',
        roomId: room1.body.id,
        roomName: 'Room 201',
      });

    // Try to save slot for Class-11-A with SAME teacher at SAME time
    const conflict = await request(app)
      .post('/api/timetable/Class-11/save')
      .set(auth(admin))
      .send({
        classId: 'Class-11',
        section: 'A',
        day: 'tue',
        periodId: 'p2',
        subjectId: subject.body.id,
        subjectName: 'Chemistry',
        subjectColor: '#10B981',
        teacherId: 'teacher123', // SAME TEACHER
        teacherName: 'Dr. Kumar',
        roomId: room2.body.id,
        roomName: 'Room 202',
      });

    expect(conflict.status).toBe(400);
    expect(conflict.body.message).toContain('Conflicts detected');

    // The same conflicting save is accepted when `overridden: true` is sent
    // (the assign-slot modal's "I confirm I want to override" checkbox).
    const override = await request(app)
      .post('/api/timetable/Class-11/save')
      .set(auth(admin))
      .send({
        classId: 'Class-11',
        section: 'A',
        day: 'tue',
        periodId: 'p2',
        subjectId: subject.body.id,
        subjectName: 'Chemistry',
        subjectColor: '#10B981',
        teacherId: 'teacher123',
        teacherName: 'Dr. Kumar',
        roomId: room2.body.id,
        roomName: 'Room 202',
        overridden: true,
      });
    expect(override.status).toBe(200);
    expect(override.body).toMatchObject({ day: 'tue', periodId: 'p2', teacherId: 'teacher123' });
  });

  it('detects room collision conflict', async () => {
    const subject = await request(app)
      .post('/api/timetable/config/subjects')
      .set(auth(admin))
      .send({
        name: 'Biology',
        code: 'BIO',
        type: 'core',
        applicableClasses: 'all',
        maxWeeklyPeriods: 5,
        color: '#8B5CF6',
      });

    const room = await request(app)
      .post('/api/timetable/config/rooms')
      .set(auth(admin))
      .send({ name: 'Science Lab', type: 'lab', capacity: 30, floor: '1', facilities: [], status: 'available' });

    // Save slot for Class-8-A
    await request(app)
      .post('/api/timetable/Class-8/save')
      .set(auth(admin))
      .send({
        classId: 'Class-8',
        section: 'A',
        day: 'wed',
        periodId: 'p3',
        subjectId: subject.body.id,
        subjectName: 'Biology',
        subjectColor: '#8B5CF6',
        teacherId: 'teacher456',
        teacherName: 'Ms. Patel',
        roomId: room.body.id,
        roomName: 'Science Lab',
      });

    // Try to save slot for Class-9-B with SAME room at SAME time
    const conflict = await request(app)
      .post('/api/timetable/Class-9/save')
      .set(auth(admin))
      .send({
        classId: 'Class-9',
        section: 'B',
        day: 'wed',
        periodId: 'p3',
        subjectId: subject.body.id,
        subjectName: 'Biology',
        subjectColor: '#8B5CF6',
        teacherId: 'teacher789',
        teacherName: 'Dr. Singh',
        roomId: room.body.id, // SAME ROOM
        roomName: 'Science Lab',
      });

    expect(conflict.status).toBe(400);
    expect(conflict.body.message).toContain('Conflicts detected');
  });

  // ─── Check Conflicts Endpoint ───────────────────────────────────────
  it('POST /timetable/check-conflicts returns conflicts before saving', async () => {
    const subject = await request(app)
      .post('/api/timetable/config/subjects')
      .set(auth(admin))
      .send({
        name: 'English',
        code: 'ENG',
        type: 'core',
        applicableClasses: 'all',
        maxWeeklyPeriods: 5,
        color: '#F59E0B',
      });

    const room = await request(app)
      .post('/api/timetable/config/rooms')
      .set(auth(admin))
      .send({ name: 'Room 301', type: 'classroom', capacity: 35, floor: '3', facilities: [], status: 'available' });

    // Save a slot
    await request(app)
      .post('/api/timetable/Class-7/save')
      .set(auth(admin))
      .send({
        classId: 'Class-7',
        section: 'A',
        day: 'thu',
        periodId: 'p4',
        subjectId: subject.body.id,
        subjectName: 'English',
        subjectColor: '#F59E0B',
        teacherId: 'teacher999',
        teacherName: 'Ms. Gupta',
        roomId: room.body.id,
        roomName: 'Room 301',
      });

    // Check for conflicts
    const check = await request(app)
      .post('/api/timetable/check-conflicts')
      .set(auth(admin))
      .send({
        classId: 'Class-8',
        section: 'B',
        day: 'thu',
        periodId: 'p4',
        subjectId: subject.body.id,
        teacherId: 'teacher999', // SAME TEACHER
        roomId: room.body.id, // SAME ROOM
      });

    expect(check.status).toBe(200);
    expect(check.body.length).toBeGreaterThan(0);
    expect(check.body.some((c: { type: string }) => c.type === 'teacher_overlap')).toBe(true);
    expect(check.body.some((c: { type: string }) => c.type === 'room_collision')).toBe(true);
  });

  // ─── Clear Slot ─────────────────────────────────────────────────────
  it('DELETE clears a slot', async () => {
    const subject = await request(app)
      .post('/api/timetable/config/subjects')
      .set(auth(admin))
      .send({
        name: 'Hindi',
        code: 'HIN',
        type: 'language',
        applicableClasses: 'all',
        maxWeeklyPeriods: 4,
        color: '#EC4899',
      });

    const room = await request(app)
      .post('/api/timetable/config/rooms')
      .set(auth(admin))
      .send({ name: 'Room 401', type: 'classroom', capacity: 40, floor: '4', facilities: [], status: 'available' });

    await request(app)
      .post('/api/timetable/Class-6/save')
      .set(auth(admin))
      .send({
        classId: 'Class-6',
        section: 'A',
        day: 'fri',
        periodId: 'p5',
        subjectId: subject.body.id,
        subjectName: 'Hindi',
        subjectColor: '#EC4899',
        teacherId: 'teacher111',
        teacherName: 'Mr. Joshi',
        roomId: room.body.id,
        roomName: 'Room 401',
      });

    const before = await request(app).get('/api/timetable/Class-6?section=A').set(auth(admin));
    expect(before.body.slots.length).toBe(1);

    await request(app)
      .delete('/api/timetable/Class-6/slots/clear')
      .set(auth(admin))
      .send({ section: 'A', day: 'fri', periodId: 'p5' });

    const after = await request(app).get('/api/timetable/Class-6?section=A').set(auth(admin));
    expect(after.body.slots.length).toBe(0);
  });

  // ─── Toggle Publish ─────────────────────────────────────────────────
  it('PATCH toggles publish status', async () => {
    const before = await request(app).get('/api/timetable/Class-5?section=A').set(auth(admin));
    expect(before.body.published).toBe(false);

    await request(app)
      .patch('/api/timetable/Class-5/publish')
      .set(auth(admin))
      .send({ section: 'A', publish: true });

    const after = await request(app).get('/api/timetable/Class-5?section=A').set(auth(admin));
    expect(after.body.published).toBe(true);
  });

  // ─── Copy Day ───────────────────────────────────────────────────────
  it('POST /timetable/copy-day duplicates slots to other days', async () => {
    const subject = await request(app)
      .post('/api/timetable/config/subjects')
      .set(auth(admin))
      .send({
        name: 'Geography',
        code: 'GEO',
        type: 'core',
        applicableClasses: 'all',
        maxWeeklyPeriods: 3,
        color: '#14B8A6',
      });

    const room = await request(app)
      .post('/api/timetable/config/rooms')
      .set(auth(admin))
      .send({ name: 'Room 501', type: 'classroom', capacity: 40, floor: '5', facilities: [], status: 'available' });

    // Save a slot on Monday
    await request(app)
      .post('/api/timetable/Class-4/save')
      .set(auth(admin))
      .send({
        classId: 'Class-4',
        section: 'A',
        day: 'mon',
        periodId: 'p1',
        subjectId: subject.body.id,
        subjectName: 'Geography',
        subjectColor: '#14B8A6',
        teacherId: 'teacher222',
        teacherName: 'Dr. Reddy',
        roomId: room.body.id,
        roomName: 'Room 501',
      });

    // Copy Monday to Tuesday and Wednesday
    await request(app)
      .post('/api/timetable/copy-day')
      .set(auth(admin))
      .send({ classId: 'Class-4', section: 'A', fromDay: 'mon', toDays: ['tue', 'wed'] });

    const get = await request(app).get('/api/timetable/Class-4?section=A').set(auth(admin));
    expect(get.body.slots.length).toBe(3); // mon + tue + wed
    expect(get.body.slots.filter((s: { day: string }) => s.day === 'tue').length).toBe(1);
    expect(get.body.slots.filter((s: { day: string }) => s.day === 'wed').length).toBe(1);
  });

  // ─── Master Timetable ───────────────────────────────────────────────
  it('GET /timetable/master returns all class timetables', async () => {
    const res = await request(app).get('/api/timetable/master').set(auth(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // ─── Teacher Schedule ───────────────────────────────────────────────
  it('GET /timetable/teacher/:staffId returns teacher-specific slots', async () => {
    const subject = await request(app)
      .post('/api/timetable/config/subjects')
      .set(auth(admin))
      .send({
        name: 'History',
        code: 'HIST',
        type: 'core',
        applicableClasses: 'all',
        maxWeeklyPeriods: 4,
        color: '#F97316',
      });

    const room = await request(app)
      .post('/api/timetable/config/rooms')
      .set(auth(admin))
      .send({ name: 'Room 601', type: 'classroom', capacity: 35, floor: '6', facilities: [], status: 'available' });

    await request(app)
      .post('/api/timetable/Class-3/save')
      .set(auth(admin))
      .send({
        classId: 'Class-3',
        section: 'A',
        day: 'mon',
        periodId: 'p2',
        subjectId: subject.body.id,
        subjectName: 'History',
        subjectColor: '#F97316',
        teacherId: 'teacher_xyz',
        teacherName: 'Prof. Nair',
        roomId: room.body.id,
        roomName: 'Room 601',
      });

    const schedule = await request(app).get('/api/timetable/teacher/teacher_xyz').set(auth(admin));
    expect(schedule.status).toBe(200);
    expect(schedule.body.length).toBe(1);
    expect(schedule.body[0]).toMatchObject({ teacherId: 'teacher_xyz', subjectName: 'History' });
  });

  it('GET /timetable/my-schedule resolves the logged-in teacher’s own periods via their linked Staff record', async () => {
    // A staff member with no linked login yet has no schedule (empty, not an error).
    const staffList = await request(app).get('/api/staff').set(auth(admin));
    const staffId = staffList.body.rows[0].id;
    const noLogin = await request(app).get('/api/timetable/my-schedule').set(auth(teacher));
    expect(noLogin.status).toBe(200);

    // Link a fresh login to that staff member and give them a period.
    const creds = await request(app)
      .post(`/api/staff/${staffId}/credentials`)
      .set(auth(admin))
      .send({ role: 'teacher', email: 'schedule-owner@example.com', username: 'schedule-owner', password: 'demo1234' });
    expect(creds.status).toBe(201);

    const subject = await request(app)
      .post('/api/timetable/config/subjects')
      .set(auth(admin))
      .send({ name: 'Geography', code: 'GEO', type: 'core', applicableClasses: 'all', maxWeeklyPeriods: 4, color: '#0EA5E9' });
    const room = await request(app)
      .post('/api/timetable/config/rooms')
      .set(auth(admin))
      .send({ name: 'Room 701', type: 'classroom', capacity: 35, floor: '7', facilities: [], status: 'available' });

    await request(app)
      .post('/api/timetable/Class-3/save')
      .set(auth(admin))
      .send({
        classId: 'Class-3',
        section: 'B',
        day: 'wed',
        periodId: 'p3',
        subjectId: subject.body.id,
        subjectName: 'Geography',
        subjectColor: '#0EA5E9',
        teacherId: staffId,
        teacherName: 'Schedule Owner',
        roomId: room.body.id,
        roomName: 'Room 701',
      });

    const ownerToken = await token('schedule-owner');
    const mine = await request(app).get('/api/timetable/my-schedule').set(auth(ownerToken));
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBe(1);
    expect(mine.body[0]).toMatchObject({ subjectName: 'Geography', classId: 'Class-3', section: 'B' });
  });

  // ─── Scan All Conflicts ─────────────────────────────────────────────
  it('POST /timetable/scan-conflicts detects all school-wide conflicts', async () => {
    const res = await request(app).post('/api/timetable/scan-conflicts').set(auth(admin));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('a coordinator with a non-empty assignedClasses may only save/clear/publish/copy slots for their supervised classes', async () => {
    const coord = await token('coordinator');
    const classes = await request(app).get('/api/classes').set(auth(admin));
    const class1Id = classes.body.find((c: { name: string }) => c.name === 'Class 1').id;
    const nurseryId = classes.body.find((c: { name: string }) => c.name === 'Nursery').id;

    const subject = await request(app)
      .post('/api/timetable/config/subjects')
      .set(auth(admin))
      .send({ name: 'Art', code: 'ART', type: 'core', applicableClasses: 'all', maxWeeklyPeriods: 5, color: '#EF4444' });
    const room = await request(app)
      .post('/api/timetable/config/rooms')
      .set(auth(admin))
      .send({ name: 'Room A', type: 'classroom', capacity: 30, floor: '1', facilities: [], status: 'available' });

    const slotPayload = (classId: string) => ({
      classId,
      section: 'A',
      day: 'mon',
      periodId: 'p1',
      subjectId: subject.body.id,
      subjectName: 'Art',
      subjectColor: '#EF4444',
      teacherId: 'teacher123',
      teacherName: 'Dr. Sharma',
      roomId: room.body.id,
      roomName: 'Room A',
    });

    // Class 1-A is within the seeded coordinator's assignedClasses — allowed.
    expect((await request(app).post(`/api/timetable/${class1Id}/save`).set(auth(coord)).send(slotPayload(class1Id))).status).toBe(200);

    // Nursery-A is outside — forbidden for save, clear, publish, and copy-day.
    expect((await request(app).post(`/api/timetable/${nurseryId}/save`).set(auth(coord)).send(slotPayload(nurseryId))).status).toBe(403);
    expect(
      (
        await request(app)
          .delete(`/api/timetable/${nurseryId}/slots/p1`)
          .set(auth(coord))
          .send({ section: 'A', day: 'mon', periodId: 'p1' })
      ).status,
    ).toBe(403);
    expect((await request(app).patch(`/api/timetable/${nurseryId}/publish`).set(auth(coord)).send({ section: 'A', publish: true })).status).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/timetable/copy-day')
          .set(auth(coord))
          .send({ classId: nurseryId, section: 'A', fromDay: 'mon', toDays: ['tue'] })
      ).status,
    ).toBe(403);
  });

  // ─── Subject-Teacher Assignment ──────────────────────────────────────
  it('a coordinator with a non-empty assignedClasses may only save/auto-assign subject-teachers for their supervised classes', async () => {
    const coord = await token('coordinator');
    const classes = await request(app).get('/api/classes').set(auth(admin));
    const nurseryId = classes.body.find((c: { name: string }) => c.name === 'Nursery').id;

    const save = await request(app)
      .post('/api/timetable/subject-assignments')
      .set(auth(coord))
      .send({ classId: nurseryId, section: 'A', rows: [] });
    expect(save.status).toBe(403);

    const auto = await request(app)
      .post('/api/timetable/subject-assignments/auto-assign')
      .set(auth(coord))
      .send({ classId: nurseryId, section: 'A' });
    expect(auto.status).toBe(403);
  });

  // ─── Subject-Teacher Assignment ──────────────────────────────────────
  it('subject assignments: lists applicable subjects, saves, auto-assigns, and reflects real teacher load', async () => {
    const subject = await request(app)
      .post('/api/timetable/config/subjects')
      .set(auth(admin))
      .send({
        name: 'Geography',
        code: 'GEO',
        type: 'core',
        applicableClasses: 'all',
        maxWeeklyPeriods: 5,
        color: '#10B981',
      });
    const subjectId = subject.body.id;

    const list = await request(app)
      .get('/api/timetable/subject-assignments?classId=Class-3&section=A')
      .set(auth(admin));
    expect(list.status).toBe(200);
    expect(list.body.some((r: { subjectId: string }) => r.subjectId === subjectId)).toBe(true);
    expect(list.body[0]).toMatchObject({
      subjectId: expect.any(String),
      subjectName: expect.any(String),
      teacherId: null,
      teacherWeeklyLoad: 0,
    });

    const staff = await request(app).get('/api/staff?department=teaching&pageSize=5').set(auth(admin));
    const teacherId = staff.body.rows[0].id;

    const save = await request(app)
      .post('/api/timetable/subject-assignments')
      .set(auth(admin))
      .send({ classId: 'Class-3', section: 'A', rows: [{ subjectId, teacherId }] });
    expect(save.status).toBe(200);

    const afterSave = await request(app)
      .get('/api/timetable/subject-assignments?classId=Class-3&section=A')
      .set(auth(admin));
    const savedRow = afterSave.body.find((r: { subjectId: string }) => r.subjectId === subjectId);
    expect(savedRow).toMatchObject({ teacherId });

    // Teacher-editing forbidden.
    expect(
      (
        await request(app)
          .post('/api/timetable/subject-assignments')
          .set(auth(teacher))
          .send({ classId: 'Class-3', section: 'A', rows: [] })
      ).status,
    ).toBe(403);

    const auto = await request(app)
      .post('/api/timetable/subject-assignments/auto-assign')
      .set(auth(admin))
      .send({ classId: 'Class-3', section: 'B' });
    expect(auto.status).toBe(200);
    expect(auto.body.every((r: { teacherId: string | null }) => r.teacherId !== null)).toBe(true);
  });
});
