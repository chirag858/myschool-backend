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

describe('Parent Web API', () => {
  let parent: string;
  let childId: string;
  beforeEach(async () => {
    await seedDemo();
    parent = await token('parent');
    const kids = await request(app).get('/api/parent/children').set(auth(parent));
    childId = kids.body[0].id as string;
  });

  it('requires auth (401) and forbids non-parent roles (403)', async () => {
    expect((await request(app).get('/api/parent/children')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/parent/children').set(auth(acc))).status).toBe(403);
  });

  it('lists the two linked children with today attendance', async () => {
    const res = await request(app).get('/api/parent/children').set(auth(parent));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      className: expect.any(String),
      admissionNumber: expect.any(String),
      todayAttendance: expect.any(String),
    });
  });

  it('fee summary reflects the seeded receipt', async () => {
    const res = await request(app).get(`/api/parent/fee-summary?childId=${childId}`).set(auth(parent));
    expect(res.status).toBe(200);
    expect(res.body.paid).toBe(5000);
    expect(res.body.totalThisSession).toBeGreaterThan(0);
    expect(res.body.balanceDue).toBe(res.body.totalThisSession - 5000);
    expect(res.body.lastPayment).toMatchObject({ amount: 5000, date: '2025-05-10' });
  });

  it('fee monthly returns 12 rows with covered months paid down', async () => {
    const res = await request(app).get(`/api/parent/fee-monthly?childId=${childId}`).set(auth(parent));
    expect(res.body.length).toBe(12);
    const apr = res.body.find((r: { month: string }) => r.month === 'Apr 2025');
    expect(apr.amountPaid).toBeGreaterThan(0);
    expect(apr.receiptNumber).toBe('RCPT-PARENT-001');
  });

  it('fee monthly amountDue matches the annual total ÷ 12 (not just monthly-frequency heads)', async () => {
    const summary = await request(app).get(`/api/parent/fee-summary?childId=${childId}`).set(auth(parent));
    const monthly = await request(app).get(`/api/parent/fee-monthly?childId=${childId}`).set(auth(parent));
    const expectedMonthlyDue = Math.round(summary.body.totalThisSession / 12);
    for (const row of monthly.body) {
      expect(row.amountDue).toBe(expectedMonthlyDue);
    }
  });

  it('fee monthly amountPaid matches the full seeded receipt amount across its covered months, not a mismatched fraction', async () => {
    const res = await request(app).get(`/api/parent/fee-monthly?childId=${childId}`).set(auth(parent));
    const apr = res.body.find((r: { month: string }) => r.month === 'Apr 2025');
    const may = res.body.find((r: { month: string }) => r.month === 'May 2025');
    // Seeded receipt: amount 5000, monthsCovered ['April', 'May'] → 2500 each.
    expect(apr.amountPaid).toBe(2500);
    expect(may.amountPaid).toBe(2500);
    expect(apr.amountPaid + may.amountPaid).toBe(5000);
  });

  it('attendance returns the child history', async () => {
    const res = await request(app).get(`/api/parent/attendance?childId=${childId}`).set(auth(parent));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length) expect(res.body[0]).toMatchObject({ date: expect.any(String), status: expect.any(String) });
  });

  it('circulars returns published parent-visible notices', async () => {
    const res = await request(app).get('/api/parent/circulars').set(auth(parent));
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.some((c: { title: string }) => c.title === 'Annual Day Notice')).toBe(true);
  });

  it('complaints: lists seeded, submits a new one scoped to the child', async () => {
    const seeded = await request(app).get(`/api/parent/complaints?childId=${childId}`).set(auth(parent));
    expect(seeded.body.length).toBe(1);
    expect(seeded.body[0]).toMatchObject({ subject: 'Bus running late', status: 'in_review' });

    const submit = await request(app)
      .post('/api/parent/complaints')
      .set(auth(parent))
      .send({ childId, subject: 'Lunch quality', category: 'other', description: 'Food was cold today.' });
    expect(submit.status).toBe(201);
    expect(submit.body).toMatchObject({ subject: 'Lunch quality', status: 'submitted', submittedAt: expect.any(String) });

    const after = await request(app).get(`/api/parent/complaints?childId=${childId}`).set(auth(parent));
    expect(after.body.length).toBe(2);
  });

  it('blocks access to a child that is not the parent’s (404)', async () => {
    const notMine = '000000000000000000000000';
    expect((await request(app).get(`/api/parent/fee-summary?childId=${notMine}`).set(auth(parent))).status).toBe(404);
    expect(
      (await request(app).post('/api/parent/complaints').set(auth(parent)).send({ childId: notMine, subject: 'x', category: 'other', description: 'y' })).status,
    ).toBe(404);
  });

  it('meet-links: shows only active links for the child’s own class, scoped by childId', async () => {
    const { StudentModel } = await import('../students/student.model');
    // Put the parent's first child into the demo teacher's incharge class
    // (Class 1-A) so a link the teacher posts is actually visible to them.
    await StudentModel.updateOne({ _id: childId }, { $set: { className: 'Class 1', section: 'A' } });

    const teacherToken = await token('teacher');
    const create = await request(app)
      .post('/api/teacher/meet-links')
      .set(auth(teacherToken))
      .send({ classKey: 'Class 1-A', title: 'Morning class', meetLink: 'https://meet.google.com/abc-defg-hij' });
    expect(create.status).toBe(201);

    const mine = await request(app).get(`/api/parent/meet-links?childId=${childId}`).set(auth(parent));
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({
      title: 'Morning class',
      meetLink: 'https://meet.google.com/abc-defg-hij',
      createdBy: 'Teacher',
    });

    // Deactivating the link hides it from the parent view without deleting it.
    await request(app)
      .patch(`/api/teacher/meet-links/${create.body.id}`)
      .set(auth(teacherToken))
      .send({ isActive: false });
    const afterDeactivate = await request(app).get(`/api/parent/meet-links?childId=${childId}`).set(auth(parent));
    expect(afterDeactivate.body).toEqual([]);

    // Requesting another parent's/nonexistent child is refused, not just empty.
    const notMine = '000000000000000000000000';
    expect((await request(app).get(`/api/parent/meet-links?childId=${notMine}`).set(auth(parent))).status).toBe(404);
  });

  it('homework: shows daily + holiday homework for the child’s class, filterable by type, carrying the child’s own submission status', async () => {
    const { StudentModel } = await import('../students/student.model');
    // Seeded daily homework already targets Class 1-A — put the child there
    // so they see it, same as the meet-links test above.
    await StudentModel.updateOne({ _id: childId }, { $set: { className: 'Class 1', section: 'A' } });

    const all = await request(app).get(`/api/parent/homework?childId=${childId}`).set(auth(parent));
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThan(0);
    expect(all.body[0]).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      homeworkType: expect.any(String),
      submissionStatus: 'pending',
    });

    const teacherToken = await token('teacher');
    const holiday = await request(app)
      .post('/api/teacher/homework')
      .set(auth(teacherToken))
      .send({ classKey: 'Class 1-A', subject: 'Mathematics', title: 'Vacation worksheet', dueDate: '2025-06-20', homeworkType: 'holiday' });
    expect(holiday.status).toBe(201);

    const onlyHoliday = await request(app).get(`/api/parent/homework?childId=${childId}&type=holiday`).set(auth(parent));
    expect(onlyHoliday.body).toHaveLength(1);
    expect(onlyHoliday.body[0]).toMatchObject({ title: 'Vacation worksheet', homeworkType: 'holiday' });

    const onlyDaily = await request(app).get(`/api/parent/homework?childId=${childId}&type=daily`).set(auth(parent));
    expect(onlyDaily.body.every((h: { homeworkType: string }) => h.homeworkType === 'daily')).toBe(true);
    expect(onlyDaily.body.some((h: { title: string }) => h.title === 'Vacation worksheet')).toBe(false);

    // The teacher records the child's submission — the parent's own row picks
    // it up, not the whole class's count. Putting the child in Class 1-A
    // above already puts them on the teacher's own roster for that class, but
    // the submission row only materialises once the teacher opens the roster.
    await request(app).get(`/api/teacher/homework/${holiday.body.id}/submissions`).set(auth(teacherToken));
    const patch = await request(app)
      .patch(`/api/teacher/homework/${holiday.body.id}/submissions/${childId}`)
      .set(auth(teacherToken))
      .send({ status: 'submitted' });
    expect(patch.status).toBe(200);
    const afterSubmit = await request(app).get(`/api/parent/homework?childId=${childId}&type=holiday`).set(auth(parent));
    expect(afterSubmit.body[0]).toMatchObject({ submissionStatus: 'submitted' });

    // Requesting another parent's/nonexistent child is refused, not just empty.
    const notMine = '000000000000000000000000';
    expect((await request(app).get(`/api/parent/homework?childId=${notMine}`).set(auth(parent))).status).toBe(404);
  });
});
