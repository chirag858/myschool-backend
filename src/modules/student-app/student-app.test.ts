import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier: username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Student App API', () => {
  let student: string;
  beforeEach(async () => {
    await seedDemo();
    student = await token('student');
  });

  it('requires auth (401) and forbids non-student roles (403)', async () => {
    expect((await request(app).get('/api/student/me')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/student/me').set(auth(acc))).status).toBe(403);
  });

  it('me resolves the linked roster record (Class 1-A)', async () => {
    const res = await request(app).get('/api/student/me').set(auth(student));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: expect.any(String), name: expect.any(String), className: 'Class 1', section: 'A' });
  });

  it('assignments: lists the class assignment; submit records it', async () => {
    const list = await request(app).get('/api/student/assignments').set(auth(student));
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    const a = list.body[0];
    expect(a).toMatchObject({ id: expect.any(String), title: expect.any(String), status: 'not_submitted', submissionOpen: true });

    const submit = await request(app)
      .post('/api/student/assignments/submit')
      .set(auth(student))
      .send({ assignmentId: a.id, files: [{ id: 'f1', name: 'answer.pdf', kind: 'pdf' }], text: 'My answer' });
    expect(submit.status).toBe(201);
    expect(submit.body).toMatchObject({ id: a.id, status: expect.stringMatching(/submitted/), submission: expect.objectContaining({ text: 'My answer' }) });

    const after = await request(app).get('/api/student/assignments').set(auth(student));
    expect(after.body.find((x: { id: string }) => x.id === a.id).status).toMatch(/submitted/);
  });

  it('notices: lists feed, mark one + all read', async () => {
    const list = await request(app).get('/api/student/notices').set(auth(student));
    expect(list.body.length).toBeGreaterThanOrEqual(1);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), title: expect.any(String), read: false });

    await request(app).post('/api/student/notices/read').set(auth(student)).send({ id: list.body[0].id });
    const after = await request(app).get('/api/student/notices').set(auth(student));
    expect(after.body.find((n: { id: string }) => n.id === list.body[0].id).read).toBe(true);

    await request(app).post('/api/student/notices/read-all').set(auth(student));
    const all = await request(app).get('/api/student/notices').set(auth(student));
    expect(all.body.every((n: { read: boolean }) => n.read)).toBe(true);
  });

  it('id-card returns the digital card with a QR value', async () => {
    const res = await request(app).get('/api/student/id-card').set(auth(student));
    expect(res.body).toMatchObject({
      name: expect.any(String),
      admissionNumber: expect.any(String),
      className: 'Class 1',
      qrValue: expect.stringContaining('MSC:'),
      school: expect.objectContaining({ name: expect.any(String) }),
    });
    expect(Array.isArray(res.body.emergencyContacts)).toBe(true);
  });

  it('library returns the student record shape', async () => {
    const res = await request(app).get('/api/student/library').set(auth(student));
    expect(res.body).toMatchObject({ issued: expect.any(Array), history: expect.any(Array), fine: expect.any(Number) });
  });

  it('dashboard-summary returns badge counts', async () => {
    const res = await request(app).get('/api/student/dashboard-summary').set(auth(student));
    expect(res.body).toMatchObject({ studentId: expect.any(String), badges: expect.any(Object) });
    expect(typeof res.body.badges.assignments).toBe('number');
  });
});
