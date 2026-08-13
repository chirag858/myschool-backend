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

async function firstExamId(t: string): Promise<string> {
  const list = await request(app).get('/api/exams').set(auth(t));
  return list.body[0].id;
}
async function class1StudentId(t: string): Promise<string> {
  const res = await request(app).get('/api/students?classKey=Class 1').set(auth(t));
  return res.body.rows[0].id;
}

describe('Exams API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids non-teaching roles (403)', async () => {
    expect((await request(app).get('/api/exams')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/exams').set(auth(acc))).status).toBe(403);
  });

  it('GET /exams lists the seeded exam; kpi + upcoming work', async () => {
    const list = await request(app).get('/api/exams').set(auth(admin));
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), name: 'Mid Term 2025', type: 'mid_term', published: true });

    const kpi = await request(app).get('/api/exams/kpi').set(auth(admin));
    expect(kpi.body).toMatchObject({ totalExams: expect.any(Number), publishedCount: expect.any(Number) });
    expect(kpi.body.totalExams).toBeGreaterThanOrEqual(1);

    const upcoming = await request(app).get('/api/exams/upcoming').set(auth(admin));
    expect(Array.isArray(upcoming.body)).toBe(true);
  });

  it('creates an exam (scheduled/unpublished) and can publish/unpublish it', async () => {
    const create = await request(app)
      .post('/api/exams')
      .set(auth(admin))
      .send({ name: 'Unit Test 1', type: 'unit_test', classes: ['Class 1'], patternByClass: {} });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ id: expect.any(String), status: 'scheduled', published: false });
    const id = create.body.id;

    const pub = await request(app).patch(`/api/exams/${id}/publish`).set(auth(admin));
    expect(pub.body).toMatchObject({ published: true, status: 'marks_entry' });
    const unpub = await request(app).patch(`/api/exams/${id}/unpublish`).set(auth(admin));
    expect(unpub.body).toMatchObject({ published: false, status: 'scheduled' });
  });

  it('a coordinator with a non-empty assignedClasses may only schedule exams for their supervised classes', async () => {
    const coord = await token('coordinator');

    // Class 1-A and Class 2-A are the seeded coordinator's assignedClasses — allowed.
    const inScope = await request(app)
      .post('/api/exams')
      .set(auth(coord))
      .send({ name: 'Scoped Test', type: 'unit_test', classes: ['Class 1-A', 'Class 2-A'], patternByClass: {} });
    expect(inScope.status).toBe(201);

    // Nursery-A is outside their assignedClasses — forbidden, even mixed with an in-scope class.
    const outOfScope = await request(app)
      .post('/api/exams')
      .set(auth(coord))
      .send({ name: 'Leaky Test', type: 'unit_test', classes: ['Class 1-A', 'Nursery-A'], patternByClass: {} });
    expect(outOfScope.status).toBe(403);

    // Unscope the coordinator — now unrestricted like school_admin.
    const meRes = await request(app).get('/api/auth/profile').set(auth(coord));
    const coordId = meRes.body._id ?? meRes.body.id;
    await request(app).patch(`/api/coordinator/assigned-classes/${coordId}`).set(auth(admin)).send({ classKeys: [] });
    const unscoped = await request(app)
      .post('/api/exams')
      .set(auth(coord))
      .send({ name: 'Unscoped Test', type: 'unit_test', classes: ['Nursery-A'], patternByClass: {} });
    expect(unscoped.status).toBe(201);
  });

  it('404 for a missing exam, 400 for invalid payload', async () => {
    expect((await request(app).get('/api/exams/000000000000000000000000').set(auth(admin))).status).toBe(404);
    expect((await request(app).post('/api/exams').set(auth(admin)).send({ type: 'unit_test' })).status).toBe(400);
  });

  it('GET /exams/:id/marks returns the roster with derived total/grade/passFail', async () => {
    const id = await firstExamId(admin);
    const res = await request(app)
      .get(`/api/exams/${id}/marks?classKey=Class 1&subjectId=math`)
      .set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(3);
    expect(res.body[0]).toMatchObject({
      studentId: expect.any(String),
      name: expect.any(String),
      theory: expect.any(Number),
      total: expect.any(Number),
      grade: expect.any(String),
      passFail: 'pass',
    });
  });

  it('saves draft + submits marks and reflects them on read', async () => {
    const id = await firstExamId(admin);
    const marks = await request(app).get(`/api/exams/${id}/marks?classKey=Class 1&subjectId=science`).set(auth(admin));
    const rows = marks.body.map((r: { studentId: string }) => ({ studentId: r.studentId, theory: 70, practical: 18, internal: 0, isAbsent: false }));

    const draft = await request(app)
      .post(`/api/exams/${id}/marks/save-draft`)
      .set(auth(admin))
      .send({ classKey: 'Class 1', subjectId: 'science', rows });
    expect(draft.body.saved).toBe(rows.length);

    const submit = await request(app)
      .post(`/api/exams/${id}/marks/submit`)
      .set(auth(admin))
      .send({ classKey: 'Class 1', subjectId: 'science', rows });
    expect(submit.body.submitted).toBe(rows.length);

    const after = await request(app).get(`/api/exams/${id}/marks?classKey=Class 1&subjectId=science`).set(auth(admin));
    expect(after.body[0].theory).toBe(70);
    expect(after.body[0].total).toBe(88);
  });

  it('calculates + reads results with ranks, then publishes them', async () => {
    const id = await firstExamId(admin);
    const calc = await request(app)
      .post(`/api/exams/${id}/results/calculate`)
      .set(auth(admin))
      .send({ classKey: 'Class 1' });
    expect(calc.status).toBe(200);
    expect(calc.body.length).toBe(3);
    expect(calc.body[0]).toMatchObject({
      studentId: expect.any(String),
      totalObtained: expect.any(Number),
      totalMax: expect.any(Number),
      percentage: expect.any(Number),
      division: expect.any(String),
      rank: expect.any(Number),
      passFail: expect.any(String),
    });
    const ranks = calc.body.map((r: { rank: number }) => r.rank).sort();
    expect(ranks).toEqual([1, 2, 3]);

    const get = await request(app).get(`/api/exams/${id}/results?classKey=Class 1`).set(auth(admin));
    expect(get.body.length).toBe(3);

    const pub = await request(app).patch(`/api/exams/${id}/results/publish`).set(auth(admin)).send({ classKey: 'Class 2' });
    expect(pub.body.success).toBe(true);
  });

  it('GET /exams/:id/analytics matches the results it summarizes; report card + remarks round-trip', async () => {
    const id = await firstExamId(admin);
    await request(app).post(`/api/exams/${id}/results/calculate`).set(auth(admin)).send({ classKey: 'Class 1' });

    const analytics = await request(app).get(`/api/exams/${id}/analytics?classKey=Class 1`).set(auth(admin));
    expect(analytics.status).toBe(200);
    expect(analytics.body).toMatchObject({
      totalStudents: 3,
      pass: expect.any(Number),
      fail: expect.any(Number),
      absent: expect.any(Number),
      classAverage: expect.any(Number),
    });
    expect(analytics.body.pass + analytics.body.fail + analytics.body.absent).toBe(3);

    const sid = await class1StudentId(admin);
    const card = await request(app).get(`/api/exams/${id}/report-card/${sid}`).set(auth(admin));
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({
      studentId: sid,
      studentName: expect.any(String),
      admissionNumber: expect.any(String),
      subjects: expect.any(Array),
      totalObtained: expect.any(Number),
      passFail: expect.any(String),
    });

    const remarks = await request(app)
      .post(`/api/exams/${id}/report-card/${sid}/remarks`)
      .set(auth(admin))
      .send({ teacherRemarks: 'Great improvement', principalRemarks: 'Keep it up' });
    expect(remarks.status).toBe(200);

    const cardAfter = await request(app).get(`/api/exams/${id}/report-card/${sid}`).set(auth(admin));
    expect(cardAfter.body).toMatchObject({
      teacherRemarks: 'Great improvement',
      principalRemarks: 'Keep it up',
    });
  });

  it('GET /students/:id/exams returns published exam results for the student', async () => {
    const sid = await class1StudentId(admin);
    const res = await request(app).get(`/api/students/${sid}/exams`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toMatchObject({
      id: expect.any(String),
      examName: 'Mid Term 2025',
      obtained: expect.any(Number),
      percentage: expect.any(Number),
      grade: expect.any(String),
    });
  });
});
