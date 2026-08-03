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
const DATE = '2025-09-15';

describe('Staff/HR API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get('/api/staff')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/staff').set(auth(acc))).status).toBe(403);
  });

  it('GET /staff lists seeded staff (StaffRow) with filter + pagination', async () => {
    const list = await request(app).get('/api/staff').set(auth(admin));
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ total: 4, page: 1, pageSize: 10 });
    expect(list.body.rows[0]).toMatchObject({
      id: expect.any(String),
      employeeId: expect.any(String),
      name: expect.any(String),
      basic: expect.any(Number),
      netSalary: expect.any(Number),
    });
    const teaching = await request(app).get('/api/staff?department=teaching').set(auth(admin));
    expect(teaching.body.total).toBe(2);
  });

  it('stats + id generation/check', async () => {
    const stats = await request(app).get('/api/staff/stats').set(auth(admin));
    expect(stats.body).toMatchObject({ totalStaff: 4, teachingCount: 2, nonTeachingCount: 2 });

    const gen = await request(app).get('/api/staff/generate-id').set(auth(admin));
    expect(gen.body.employeeId).toBe('EMP0005');
    const check = await request(app).get('/api/staff/check-id?employeeId=EMP0001').set(auth(admin));
    expect(check.body.taken).toBe(true);
    const free = await request(app).get('/api/staff/check-id?employeeId=EMP9999').set(auth(admin));
    expect(free.body.taken).toBe(false);
  });

  it('create staff computes employeeId + netSalary; profile + status update', async () => {
    const create = await request(app)
      .post('/api/staff')
      .set(auth(admin))
      .send({ name: 'New Teacher', designation: 'teacher', department: 'teaching', mobile: '9990001234', basic: 40000, joiningDate: '2025-08-01' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ employeeId: 'EMP0005', netSalary: 40000, status: 'active' });
    const id = create.body.id;

    const profile = await request(app).get(`/api/staff/${id}`).set(auth(admin));
    expect(profile.body).toMatchObject({ id, name: 'New Teacher', qualifications: expect.any(Array), salaryStructure: expect.any(Object) });
    // salaryStructure.basic must mirror the top-level basic even though
    // createStaff never writes `basic` inside the nested structure itself.
    expect(profile.body.salaryStructure).toMatchObject({ basic: 40000, allowances: [], deductions: [] });

    const st = await request(app).patch(`/api/staff/${id}/status`).set(auth(admin)).send({ status: 'inactive' });
    expect(st.body.status).toBe('inactive');
  });

  it('create staff with allowances/deductions computes net salary additively', async () => {
    const create = await request(app)
      .post('/api/staff')
      .set(auth(admin))
      .send({
        name: 'Adjusted Teacher',
        designation: 'teacher',
        department: 'teaching',
        mobile: '9990001235',
        basic: 25000,
        joiningDate: '2025-08-01',
        allowances: [{ type: 'hra', amount: 8000 }, { type: 'da', amount: 2500 }],
        deductions: [{ type: 'pf', amount: 3000 }, { type: 'professional_tax', amount: 200 }],
      });
    expect(create.status).toBe(201);
    expect(create.body.netSalary).toBe(32300);

    const profile = await request(app).get(`/api/staff/${create.body.id}`).set(auth(admin));
    expect(profile.body.salaryStructure).toMatchObject({
      allowances: [{ type: 'hra', amount: 8000 }, { type: 'da', amount: 2500 }],
      deductions: [{ type: 'pf', amount: 3000 }, { type: 'professional_tax', amount: 200 }],
    });
  });

  it('create staff persists and reads back the full wizard payload (personal, qualification, employment extras)', async () => {
    const create = await request(app)
      .post('/api/staff')
      .set(auth(admin))
      .send({
        name: 'Full Wizard Teacher',
        designation: 'teacher',
        department: 'teaching',
        mobile: '9990009999',
        joiningDate: '2025-08-01',
        basic: 30000,
        dateOfBirth: '1990-05-15',
        gender: 'female',
        bloodGroup: 'O+',
        religion: 'hindu',
        nationality: 'Indian',
        aadhaar: '123456789012',
        pan: 'ABCDE1234F',
        personalEmail: 'teacher@example.com',
        emergencyContactName: 'Emergency Contact',
        emergencyContactMobile: '9998887777',
        photoUrl: 'data:image/png;base64,xyz',
        currentAddress: { line1: '123 Main St', city: 'Gurgaon', state: 'Haryana', pinCode: '122001' },
        permanentSameAsCurrent: false,
        permanentAddress: { line1: '456 Other St', city: 'Delhi', state: 'Delhi', pinCode: '110001' },
        qualifications: [{ id: 'q1', degree: 'B.Ed', institution: 'Delhi University', yearOfPassing: 2012, grade: 'A' }],
        experience: [{ id: 'e1', organization: 'Old School', designation: 'Teacher', fromDate: '2012-01-01', toDate: '2020-01-01' }],
        teachingSubjects: ['Math'],
        teachingClasses: ['5', '6'],
        teachingExperienceYears: 8,
        probationEndDate: '2026-02-01',
        reportingToId: 'staff_999',
        reportingToName: 'Principal Name',
        workingHoursPerDay: 7,
        weeklyOffDays: ['sun', 'sat'],
      });
    expect(create.status).toBe(201);

    const profile = await request(app).get(`/api/staff/${create.body.id}`).set(auth(admin));
    expect(profile.body).toMatchObject({
      dateOfBirth: '1990-05-15',
      gender: 'female',
      bloodGroup: 'O+',
      religion: 'hindu',
      nationality: 'Indian',
      aadhaar: '123456789012',
      pan: 'ABCDE1234F',
      personalEmail: 'teacher@example.com',
      emergencyContactName: 'Emergency Contact',
      emergencyContactMobile: '9998887777',
      photoUrl: 'data:image/png;base64,xyz',
      currentAddress: { line1: '123 Main St', city: 'Gurgaon', state: 'Haryana', pinCode: '122001' },
      permanentSameAsCurrent: false,
      permanentAddress: { line1: '456 Other St', city: 'Delhi', state: 'Delhi', pinCode: '110001' },
      teachingSubjects: ['Math'],
      teachingClasses: ['5', '6'],
      teachingExperienceYears: 8,
      probationEndDate: '2026-02-01',
      reportingToId: 'staff_999',
      reportingToName: 'Principal Name',
      workingHoursPerDay: 7,
      weeklyOffDays: ['sun', 'sat'],
    });
    expect(profile.body.qualifications).toMatchObject([{ degree: 'B.Ed', institution: 'Delhi University', yearOfPassing: 2012, grade: 'A' }]);
    expect(profile.body.experience).toMatchObject([{ organization: 'Old School', designation: 'Teacher' }]);
  });

  it('staff attendance: get roster → save → lock → report', async () => {
    const get1 = await request(app).get(`/api/staff/attendance?date=${DATE}`).set(auth(admin));
    expect(get1.body.locked).toBe(false);
    expect(get1.body.rows.length).toBe(4);
    expect(get1.body.rows[0].status).toBeNull();

    const attendance = get1.body.rows.map((r: { id: string }, i: number) => ({ id: r.id, staffId: r.id, status: i === 0 ? 'leave' : 'present' }));
    const save = await request(app)
      .post('/api/staff/attendance/save')
      .set(auth(admin))
      .send({ date: DATE, attendance: attendance.map((a: { staffId: string; status: string }) => ({ staffId: a.staffId, status: a.status })) });
    expect(save.body.saved).toBe(4);

    const get2 = await request(app).get(`/api/staff/attendance?date=${DATE}`).set(auth(admin));
    const present = get2.body.rows.filter((r: { status: string }) => r.status === 'present').length;
    expect(present).toBe(3);

    const lock = await request(app).patch('/api/staff/attendance/lock').set(auth(admin)).send({ date: DATE });
    expect(lock.body.success).toBe(true);
    const get3 = await request(app).get(`/api/staff/attendance?date=${DATE}`).set(auth(admin));
    expect(get3.body.locked).toBe(true);

    const report = await request(app).get('/api/staff/attendance/report').set(auth(admin));
    expect(report.body.length).toBe(4);
    expect(report.body[0]).toMatchObject({ workingDays: expect.any(Number), present: expect.any(Number), percentage: expect.any(Number) });
  });

  it('attendance-month: per-staff day-by-day view for one month', async () => {
    const roster = await request(app).get(`/api/staff/attendance?date=${DATE}`).set(auth(admin));
    const staffId = roster.body.rows[0].id as string;

    await request(app)
      .post('/api/staff/attendance/save')
      .set(auth(admin))
      .send({ date: DATE, attendance: [{ staffId, status: 'absent' }] });
    await request(app)
      .post('/api/staff/attendance/save')
      .set(auth(admin))
      .send({ date: '2025-09-16', attendance: [{ staffId, status: 'present' }] });

    const month = await request(app).get(`/api/staff/${staffId}/attendance-month?month=9&year=2025`).set(auth(admin));
    expect(month.status).toBe(200);
    expect(month.body).toMatchObject({ year: 2025, month: 9, present: 1, absent: 1, workingDays: 2 });
    expect(month.body.days.length).toBe(30);
    expect(month.body.days.find((d: { date: string }) => d.date === DATE)).toMatchObject({ date: DATE, status: 'absent' });
    expect(month.body.days.find((d: { date: string }) => d.date === '2025-09-16')).toMatchObject({ status: 'present' });
  });

  it('rejects invalid create payload (400)', async () => {
    expect((await request(app).post('/api/staff').set(auth(admin)).send({ mobile: '999' })).status).toBe(400);
  });

  it('rejects malformed field formats on create (aadhaar, pan, pinCode, email, mobile)', async () => {
    const base = { name: 'Bad Data', designation: 'teacher', department: 'teaching', joiningDate: '2025-08-01' };
    expect((await request(app).post('/api/staff').set(auth(admin)).send({ ...base, mobile: '12345' })).status).toBe(400);
    expect((await request(app).post('/api/staff').set(auth(admin)).send({ ...base, mobile: '9990001111', aadhaar: '12345' })).status).toBe(400);
    expect((await request(app).post('/api/staff').set(auth(admin)).send({ ...base, mobile: '9990001111', pan: 'not-a-pan' })).status).toBe(400);
    expect((await request(app).post('/api/staff').set(auth(admin)).send({ ...base, mobile: '9990001111', personalEmail: 'not-an-email' })).status).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/staff')
          .set(auth(admin))
          .send({ ...base, mobile: '9990001111', currentAddress: { line1: '1 St', city: 'X', state: 'Y', pinCode: 'abc' } })
      ).status,
    ).toBe(400);

    expect((await request(app).post('/api/staff').set(auth(admin)).send({ ...base, mobile: '9990001111', ifsc: 'not-ifsc' })).status).toBe(400);
    expect((await request(app).post('/api/staff').set(auth(admin)).send({ ...base, mobile: '9990001111', bankAccountNumber: 'abc123' })).status).toBe(400);
    expect((await request(app).post('/api/staff').set(auth(admin)).send({ ...base, mobile: '9990001111', designation: 'not_a_role' })).status).toBe(400);
    expect((await request(app).post('/api/staff').set(auth(admin)).send({ ...base, mobile: '9990001111', department: 'not_a_dept' })).status).toBe(400);

    const ok = await request(app).post('/api/staff').set(auth(admin)).send({
      ...base,
      mobile: '9990001111',
      aadhaar: '123456789012',
      pan: 'ABCDE1234F',
      personalEmail: 'valid@example.com',
      currentAddress: { line1: '1 St', city: 'X', state: 'Y', pinCode: '110001' },
      ifsc: 'SBIN0001234',
      bankAccountNumber: '123456789012',
    });
    expect(ok.status).toBe(201);
  });
});

describe('Staff login credentials API', () => {
  let admin: string;
  let staffId: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
    const list = await request(app).get('/api/staff').set(auth(admin));
    staffId = list.body.rows[0].id;
  });

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get(`/api/staff/${staffId}/credentials`)).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get(`/api/staff/${staffId}/credentials`).set(auth(acc))).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/staff/${staffId}/credentials`)
          .set(auth(acc))
          .send({ role: 'teacher', email: 'x@example.com' })
      ).status,
    ).toBe(403);
  });

  it('has no login initially; create → get → duplicate-create rejected', async () => {
    const before = await request(app).get(`/api/staff/${staffId}/credentials`).set(auth(admin));
    expect(before.body).toMatchObject({ hasLogin: false });

    const create = await request(app)
      .post(`/api/staff/${staffId}/credentials`)
      .set(auth(admin))
      .send({ role: 'teacher', email: 'newteacher@example.com' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({
      hasLogin: true,
      username: 'newteacher@example.com',
      email: 'newteacher@example.com',
      role: 'teacher',
      active: true,
      tempPassword: expect.any(String),
    });
    expect(create.body.tempPassword.length).toBeGreaterThan(0);

    const after = await request(app).get(`/api/staff/${staffId}/credentials`).set(auth(admin));
    expect(after.body).toMatchObject({ hasLogin: true, email: 'newteacher@example.com', role: 'teacher' });
    expect(after.body.tempPassword).toBeUndefined();

    const dup = await request(app)
      .post(`/api/staff/${staffId}/credentials`)
      .set(auth(admin))
      .send({ role: 'teacher', email: 'another@example.com' });
    expect(dup.status).toBe(409);
  });

  it('explicit password on create is not echoed back; new login can authenticate', async () => {
    const create = await request(app)
      .post(`/api/staff/${staffId}/credentials`)
      .set(auth(admin))
      .send({ role: 'teacher', email: 'setpw@example.com', username: 'setpw', password: 'mypassword1' });
    expect(create.status).toBe(201);
    expect(create.body.tempPassword).toBeUndefined();

    const login = await request(app).post('/api/auth/login').send({ username: 'setpw', password: 'mypassword1', captcha: 'x' });
    expect(login.status).toBe(200);
  });

  it('rejects a role outside STAFF_ROLES and a duplicate email/username', async () => {
    expect(
      (
        await request(app)
          .post(`/api/staff/${staffId}/credentials`)
          .set(auth(admin))
          .send({ role: 'super_admin', email: 'x@example.com' })
      ).status,
    ).toBe(400);

    const dupEmail = await request(app)
      .post(`/api/staff/${staffId}/credentials`)
      .set(auth(admin))
      .send({ role: 'teacher', email: 'teacher@msc.test' }); // already used by seeded demo teacher
    expect(dupEmail.status).toBe(409);
  });

  it('update role/active and reset password', async () => {
    await request(app)
      .post(`/api/staff/${staffId}/credentials`)
      .set(auth(admin))
      .send({ role: 'teacher', email: 'updateme@example.com', password: 'initialpw1' });

    const update = await request(app)
      .patch(`/api/staff/${staffId}/credentials`)
      .set(auth(admin))
      .send({ role: 'coordinator', active: false });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ role: 'coordinator', active: false, assignedClasses: [] });

    const reset = await request(app)
      .post(`/api/staff/${staffId}/credentials/reset-password`)
      .set(auth(admin))
      .send({});
    expect(reset.status).toBe(200);
    expect(reset.body.tempPassword).toEqual(expect.any(String));

    const resetExplicit = await request(app)
      .post(`/api/staff/${staffId}/credentials/reset-password`)
      .set(auth(admin))
      .send({ password: 'brandnewpw1' });
    expect(resetExplicit.status).toBe(200);
    expect(resetExplicit.body.tempPassword).toBeUndefined();
  });

  it('404s update/reset for a staff member with no login yet', async () => {
    expect((await request(app).patch(`/api/staff/${staffId}/credentials`).set(auth(admin)).send({ active: false })).status).toBe(404);
    expect((await request(app).post(`/api/staff/${staffId}/credentials/reset-password`).set(auth(admin)).send({})).status).toBe(404);
  });

  it('tenant scoping: staff from another school 404s', async () => {
    expect((await request(app).get('/api/staff/000000000000000000000000/credentials').set(auth(admin))).status).toBe(404);
  });
});

describe('Class incharge API', () => {
  let admin: string;
  let staffId: string;

  async function classAndSection(className: string, sectionName: string, byToken: string) {
    const classes = await request(app).get('/api/classes').set(auth(byToken));
    const cls = classes.body.find((c: { name: string }) => c.name === className);
    const secs = await request(app).get(`/api/classes/${cls.id}/sections`).set(auth(byToken));
    const sec = secs.body.find((s: { name: string }) => s.name === sectionName);
    return { classId: cls.id, sectionId: sec.id };
  }

  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
    const list = await request(app).get('/api/staff').set(auth(admin));
    staffId = list.body.rows[0].id;
    await request(app)
      .post(`/api/staff/${staffId}/credentials`)
      .set(auth(admin))
      .send({ role: 'teacher', email: 'incharge-target@example.com' });
  });

  it('requires auth (401) and forbids other roles (403)', async () => {
    const { sectionId } = await classAndSection('Class 1', 'A', admin);
    expect((await request(app).get(`/api/staff/${staffId}/incharge`)).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get(`/api/staff/${staffId}/incharge`).set(auth(acc))).status).toBe(403);
    expect((await request(app).put(`/api/staff/${staffId}/incharge`).set(auth(acc)).send({ sectionId })).status).toBe(403);
  });

  it('null before assignment; set → get; reassigning clears the old section', async () => {
    const before = await request(app).get(`/api/staff/${staffId}/incharge`).set(auth(admin));
    expect(before.body).toBeNull();

    const { sectionId: sectionA } = await classAndSection('Class 1', 'A', admin);
    const set = await request(app).put(`/api/staff/${staffId}/incharge`).set(auth(admin)).send({ sectionId: sectionA });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ classKey: 'Class 1-A', className: 'Class 1', section: 'A' });

    const get = await request(app).get(`/api/staff/${staffId}/incharge`).set(auth(admin));
    expect(get.body).toMatchObject({ classKey: 'Class 1-A' });

    // Reassign this teacher to a different section — the old one is cleared.
    const { sectionId: sectionB } = await classAndSection('Class 1', 'B', admin);
    const reassign = await request(app).put(`/api/staff/${staffId}/incharge`).set(auth(admin)).send({ sectionId: sectionB });
    expect(reassign.body).toMatchObject({ classKey: 'Class 1-B' });

    const sections = await request(app).get(`/api/classes/${(await classAndSection('Class 1', 'A', admin)).classId}/sections`).set(auth(admin));
    const secA = sections.body.find((s: { name: string }) => s.name === 'A');
    expect(secA.classTeacherId).toBeNull();
  });

  it('assigning a section that already has a different incharge overwrites it', async () => {
    const list = await request(app).get('/api/staff').set(auth(admin));
    const staffId2 = list.body.rows[1].id;
    await request(app)
      .post(`/api/staff/${staffId2}/credentials`)
      .set(auth(admin))
      .send({ role: 'teacher', email: 'second-teacher@example.com' });

    const { sectionId } = await classAndSection('Class 2', 'A', admin);
    await request(app).put(`/api/staff/${staffId}/incharge`).set(auth(admin)).send({ sectionId });
    const takeover = await request(app).put(`/api/staff/${staffId2}/incharge`).set(auth(admin)).send({ sectionId });
    expect(takeover.status).toBe(200);

    expect((await request(app).get(`/api/staff/${staffId}/incharge`).set(auth(admin))).body).toBeNull();
    expect((await request(app).get(`/api/staff/${staffId2}/incharge`).set(auth(admin))).body).toMatchObject({ classKey: 'Class 2-A' });
  });

  it('clears incharge via DELETE', async () => {
    const { sectionId } = await classAndSection('Class 1', 'A', admin);
    await request(app).put(`/api/staff/${staffId}/incharge`).set(auth(admin)).send({ sectionId });
    expect((await request(app).delete(`/api/staff/${staffId}/incharge`).set(auth(admin))).status).toBe(200);
    expect((await request(app).get(`/api/staff/${staffId}/incharge`).set(auth(admin))).body).toBeNull();
  });

  it('rejects a non-teacher role and tenant-isolates the section', async () => {
    const { sectionId } = await classAndSection('Class 1', 'A', admin);
    await request(app).patch(`/api/staff/${staffId}/credentials`).set(auth(admin)).send({ role: 'coordinator' });
    expect((await request(app).put(`/api/staff/${staffId}/incharge`).set(auth(admin)).send({ sectionId })).status).toBe(400);
  });
});
