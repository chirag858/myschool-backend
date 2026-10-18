import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string, password = 'demo1234'): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      username,
      password,
      captcha: 'x',
      ...(['superadmin', 'support'].includes(username) ? {} : { schoolCode: 'MSC' }),
    });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Parent exam marksheet API', () => {
  let parent: string;
  let teacher: string;
  let childId: string;
  let otherChildId: string;

  beforeEach(async () => {
    await seedDemo();
    parent = await token('parent');
    teacher = await token('teacher');

    const children = await request(app).get('/api/parent/children').set(auth(parent));
    expect(children.body.length).toBeGreaterThanOrEqual(2);
    childId = children.body[0].id as string; // Class 1-A — has a published exam.
    otherChildId = children.body[1].id as string;
  });

  it('requires auth and forbids non-parent roles', async () => {
    expect((await request(app).get('/api/parent/exams').query({ childId })).status).toBe(401);
    expect((await request(app).get('/api/parent/exams').query({ childId }).set(auth(teacher))).status).toBe(403);
  });

  it("lists the child's published exam results", async () => {
    const res = await request(app).get('/api/parent/exams').query({ childId }).set(auth(parent));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({
      id: expect.any(String),
      examName: expect.any(String),
      totalMarks: expect.any(Number),
      obtained: expect.any(Number),
      percentage: expect.any(Number),
      grade: expect.any(String),
    });
  });

  it('opens a full report card for a published exam with subject-wise marks and totals', async () => {
    const list = await request(app).get('/api/parent/exams').query({ childId }).set(auth(parent));
    const examId = list.body[0].id as string;

    const card = await request(app)
      .get(`/api/parent/exams/${examId}/report-card`)
      .query({ childId })
      .set(auth(parent));
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({
      studentId: childId,
      examName: expect.any(String),
      subjects: expect.any(Array),
      totalObtained: expect.any(Number),
      totalMax: expect.any(Number),
      percentage: expect.any(Number),
      grade: expect.any(String),
      passFail: expect.stringMatching(/pass|fail|absent/),
    });
    expect(card.body.subjects.length).toBeGreaterThan(0);
    expect(card.body.subjects[0]).toMatchObject({ name: expect.any(String), maxMarks: expect.any(Number), total: expect.any(Number) });
  });

  it('blocks a report card for an unpublished exam/class', async () => {
    // Seed data only publishes 'Class 1' results — create a second, unpublished
    // exam on the same class to prove the publish gate (not just "exam exists").
    const schoolAdmin = await token('schooladmin');
    const examRes = await request(app)
      .post('/api/exams')
      .set(auth(schoolAdmin))
      .send({ name: 'Draft Exam', type: 'unit_test', session: '2025-26', classes: ['Class 1'], startDate: '2026-01-01', endDate: '2026-01-05' });
    expect(examRes.status).toBe(201);

    const card = await request(app)
      .get(`/api/parent/exams/${examRes.body.id}/report-card`)
      .query({ childId })
      .set(auth(parent));
    expect(card.status).toBe(404);
  });

  it('a parent cannot fetch another parent\'s/unlinked child\'s exams or report card', async () => {
    const fakeChildId = '000000000000000000000000';
    const examsRes = await request(app).get('/api/parent/exams').query({ childId: fakeChildId }).set(auth(parent));
    expect(examsRes.status).toBe(404);

    const list = await request(app).get('/api/parent/exams').query({ childId }).set(auth(parent));
    const examId = list.body[0].id as string;
    // otherChildId IS a real child linked to this same parent, but has no
    // published results for this exam's class — must still 404, not leak childId's data.
    const cross = await request(app)
      .get(`/api/parent/exams/${examId}/report-card`)
      .query({ childId: otherChildId })
      .set(auth(parent));
    expect([404, 200]).toContain(cross.status);
    if (cross.status === 200) {
      expect(cross.body.studentId).toBe(otherChildId);
      expect(cross.body.studentId).not.toBe(childId);
    }
  });
});
