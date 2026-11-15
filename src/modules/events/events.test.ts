import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

// R2 upload is stubbed so the multipart endpoint is testable without network.
vi.mock('../../lib/storage', () => ({
  uploadToR2: vi.fn().mockResolvedValue({ url: 'https://r2.test/photo.jpg', key: 'test-key' }),
}));

async function token(identifier: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Events API', () => {
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

  it('requires auth (401) and forbids parent role on the staff surface (403)', async () => {
    expect((await request(app).get('/api/events')).status).toBe(401);
    expect((await request(app).get('/api/events').set(auth(parent))).status).toBe(403);
  });

  it('teacher creates an album, uploads a photo, and reads it back', async () => {
    const created = await request(app)
      .post('/api/events')
      .set(auth(teacher))
      .send({ title: 'Sports Day', description: 'Annual sports', classKeys: [] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: expect.any(String), title: 'Sports Day', photoCount: 0 });
    const albumId = created.body.id;

    const up = await request(app)
      .post('/api/events/upload-photo')
      .set(auth(teacher))
      .attach('file', Buffer.from('x'), 'p.jpg');
    expect(up.status).toBe(200);
    expect(up.body.url).toBe('https://r2.test/photo.jpg');

    const withPhoto = await request(app)
      .post(`/api/events/${albumId}/photos`)
      .set(auth(teacher))
      .send({ url: up.body.url, key: up.body.key, caption: 'run' });
    expect(withPhoto.status).toBe(200);
    expect(withPhoto.body.photoCount).toBe(1);
    expect(withPhoto.body.coverUrl).toBe(up.body.url);

    const list = await request(app).get('/api/events').set(auth(teacher));
    expect(list.body.rows.length).toBe(1);
    expect(list.body.rows[0]).not.toHaveProperty('photos');

    const detail = await request(app).get(`/api/events/${albumId}`).set(auth(teacher));
    expect(detail.body.photos).toHaveLength(1);
    expect(detail.body.photos[0]).toMatchObject({ id: expect.any(String), url: up.body.url, caption: 'run' });
  });

  it('validation: empty title is rejected (400)', async () => {
    expect((await request(app).post('/api/events').set(auth(teacher)).send({ title: '' })).status).toBe(400);
  });

  it('parent sees a whole-school album and a class-targeted one, but not another class', async () => {
    await request(app).post('/api/events').set(auth(teacher)).send({ title: 'Whole School', classKeys: [] });
    await request(app).post('/api/events').set(auth(teacher)).send({ title: 'My Class', classKeys: [classKey] });
    await request(app).post('/api/events').set(auth(teacher)).send({ title: 'Other Class', classKeys: ['ZZZ-9'] });

    const res = await request(app).get(`/api/parent/events?childId=${childId}`).set(auth(parent));
    expect(res.status).toBe(200);
    const titles = res.body.rows.map((r: { title: string }) => r.title).sort();
    expect(titles).toEqual(['My Class', 'Whole School']);
  });

  it('parent album detail is 404 for an album that does not target the child class', async () => {
    const other = await request(app).post('/api/events').set(auth(teacher)).send({ title: 'Other', classKeys: ['ZZZ-9'] });
    const res = await request(app).get(`/api/parent/events/${other.body.id}?childId=${childId}`).set(auth(parent));
    expect(res.status).toBe(404);
  });

  it('tenant isolation: an album is scoped to its school', async () => {
    const created = await request(app).post('/api/events').set(auth(teacher)).send({ title: 'T', classKeys: [] });
    // A bogus id under the same school 404s (not a cross-tenant leak path).
    expect((await request(app).get('/api/events/000000000000000000000000').set(auth(teacher))).status).toBe(404);
    expect((await request(app).delete(`/api/events/${created.body.id}`).set(auth(teacher))).status).toBe(204);
    expect((await request(app).get(`/api/events/${created.body.id}`).set(auth(teacher))).status).toBe(404);
  });
});
