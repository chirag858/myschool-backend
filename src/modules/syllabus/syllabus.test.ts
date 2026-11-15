import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

vi.mock('../../lib/storage', () => ({
  uploadToR2: vi.fn().mockResolvedValue({ url: 'https://r2.test/syllabus.pdf', key: 'test-key' }),
}));

async function token(identifier: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Syllabus API', () => {
  let teacher: string;
  let parent: string;
  let childId: string;
  let classKey: string;

  beforeEach(async () => {
    await seedDemo();
    teacher = await token('teacher');
    parent = await token('parent');
    const kids = (await request(app).get('/api/parent/app-children').set(auth(parent))).body;
    childId = kids[0].id;
    classKey = `${kids[0].className}-${kids[0].section}`;
  });

  it('requires auth (401) and forbids parent on the staff surface (403)', async () => {
    expect((await request(app).get('/api/syllabus')).status).toBe(401);
    expect((await request(app).get('/api/syllabus').set(auth(parent))).status).toBe(403);
  });

  it('teacher uploads a file and creates a syllabus doc', async () => {
    const up = await request(app)
      .post('/api/syllabus/upload-file')
      .set(auth(teacher))
      .attach('file', Buffer.from('%PDF'), 'term1.pdf');
    expect(up.status).toBe(200);
    expect(up.body.url).toBe('https://r2.test/syllabus.pdf');

    const created = await request(app)
      .post('/api/syllabus')
      .set(auth(teacher))
      .send({ title: 'Term 1 Maths', classKey, subject: 'Maths', term: 'Term 1', fileUrl: up.body.url, fileKey: up.body.key, fileName: 'term1.pdf' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: expect.any(String), title: 'Term 1 Maths', classKey });

    const list = await request(app).get('/api/syllabus').set(auth(teacher));
    expect(list.body.rows.length).toBe(1);
  });

  it('validation: missing fileUrl is rejected (400)', async () => {
    const res = await request(app).post('/api/syllabus').set(auth(teacher)).send({ title: 'X', classKey });
    expect(res.status).toBe(400);
  });

  it('parent sees only syllabus for the child class', async () => {
    const up = { url: 'https://r2.test/s.pdf', key: 'k' };
    await request(app).post('/api/syllabus').set(auth(teacher)).send({ title: 'Mine', classKey, fileUrl: up.url });
    await request(app).post('/api/syllabus').set(auth(teacher)).send({ title: 'Other', classKey: 'ZZZ-9', fileUrl: up.url });

    const res = await request(app).get(`/api/parent/syllabus?childId=${childId}`).set(auth(parent));
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: { title: string }) => r.title)).toEqual(['Mine']);
  });

  it('delete removes the doc', async () => {
    const created = await request(app).post('/api/syllabus').set(auth(teacher)).send({ title: 'D', classKey, fileUrl: 'https://r2.test/s.pdf' });
    expect((await request(app).delete(`/api/syllabus/${created.body.id}`).set(auth(teacher))).status).toBe(204);
    expect((await request(app).get('/api/syllabus').set(auth(teacher))).body.rows.length).toBe(0);
  });
});
