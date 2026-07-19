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

describe('Academics API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids non-academic roles (403)', async () => {
    expect((await request(app).get('/api/sessions')).status).toBe(401);
    const teacher = await token('teacher');
    expect((await request(app).get('/api/sessions').set(auth(teacher))).status).toBe(403);
  });

  // ── Sessions ──
  it('GET /sessions lists the seeded active session', async () => {
    const res = await request(app).get('/api/sessions').set(auth(admin));
    expect(res.status).toBe(200);
    const active = res.body.find((s: { name: string }) => s.name === '2025-26');
    expect(active).toMatchObject({ id: expect.any(String), status: 'active', startDate: expect.any(String) });
  });

  it('POST /sessions creates an upcoming session; activate closes the old one', async () => {
    const create = await request(app)
      .post('/api/sessions')
      .set(auth(admin))
      .send({ name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ id: expect.any(String), name: '2026-27', status: 'upcoming' });

    const activate = await request(app).patch(`/api/sessions/${create.body.id}/activate`).set(auth(admin));
    expect(activate.status).toBe(200);

    const list = await request(app).get('/api/sessions').set(auth(admin));
    const byName = Object.fromEntries(list.body.map((s: { name: string; status: string }) => [s.name, s.status]));
    expect(byName['2026-27']).toBe('active');
    expect(byName['2025-26']).toBe('closed');
  });

  it('GET /sessions/:id/stats returns the stats shape', async () => {
    const list = await request(app).get('/api/sessions').set(auth(admin));
    const id = list.body[0].id;
    const res = await request(app).get(`/api/sessions/${id}/stats`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalStudents: expect.any(Number),
      totalStaff: expect.any(Number),
      feeStructureConfigured: expect.any(Boolean),
    });
  });

  // ── Classes & Sections ──
  it('GET /classes lists seeded classes with derived section counts', async () => {
    const res = await request(app).get('/api/classes').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(5);
    const nursery = res.body.find((c: { name: string }) => c.name === 'Nursery');
    expect(nursery).toMatchObject({ id: expect.any(String), order: expect.any(Number), totalSections: 2, totalStudents: 0 });
  });

  it('creates/updates/deletes a class; rejects a duplicate name (409)', async () => {
    const create = await request(app).post('/api/classes').set(auth(admin)).send({ name: 'Class 9', order: 9 });
    expect(create.status).toBe(201);
    const id = create.body.id;

    const dup = await request(app).post('/api/classes').set(auth(admin)).send({ name: 'Class 9', order: 10 });
    expect(dup.status).toBe(409);

    const upd = await request(app).put(`/api/classes/${id}`).set(auth(admin)).send({ name: 'Class 9-A' });
    expect(upd.body.name).toBe('Class 9-A');

    const del = await request(app).delete(`/api/classes/${id}`).set(auth(admin));
    expect(del.body).toMatchObject({ ok: true });
  });

  it('reorders classes', async () => {
    const list = await request(app).get('/api/classes').set(auth(admin));
    const ids = list.body.map((c: { id: string }) => c.id).reverse();
    const res = await request(app).patch('/api/classes/reorder').set(auth(admin)).send(ids);
    expect(res.status).toBe(200);
    const after = await request(app).get('/api/classes').set(auth(admin));
    expect(after.body[0].id).toBe(ids[0]);
  });

  it('lists, creates, updates and deletes sections under a class', async () => {
    const classes = await request(app).get('/api/classes').set(auth(admin));
    const classId = classes.body[0].id;

    const list = await request(app).get(`/api/classes/${classId}/sections`).set(auth(admin));
    expect(list.body.length).toBe(2);
    expect(list.body[0]).toMatchObject({ id: expect.any(String), classId, name: expect.any(String), maxCapacity: 40 });

    const create = await request(app)
      .post(`/api/classes/${classId}/sections`)
      .set(auth(admin))
      .send({ name: 'C', maxCapacity: 35 });
    expect(create.status).toBe(201);
    const sectionId = create.body.id;

    const upd = await request(app)
      .put(`/api/classes/${classId}/sections/${sectionId}`)
      .set(auth(admin))
      .send({ roomName: 'Room 3' });
    expect(upd.body.roomName).toBe('Room 3');

    const del = await request(app).delete(`/api/classes/${classId}/sections/${sectionId}`).set(auth(admin));
    expect(del.status).toBe(200);
    const after = await request(app).get(`/api/classes/${classId}/sections`).set(auth(admin));
    expect(after.body.length).toBe(2);
  });

  // ── Holidays ──
  it('creates/updates/deletes holidays and computes the working-days summary', async () => {
    const empty = await request(app).get('/api/holidays').set(auth(admin));
    expect(empty.body).toEqual([]);

    const create = await request(app)
      .post('/api/holidays')
      .set(auth(admin))
      .send({ name: 'Winter Break', startDate: '2025-12-25', endDate: '2025-12-31', type: 'vacation', applicability: 'all' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ id: expect.any(String), name: 'Winter Break', recurring: false });

    const summary = await request(app).get('/api/holidays/working-days-summary').set(auth(admin));
    expect(summary.body.totalDays).toBeGreaterThan(300); // full session year
    expect(summary.body.holidays).toBe(7); // 25th–31st inclusive
    expect(summary.body.workingDays).toBe(summary.body.totalDays - 7);

    const upd = await request(app).put(`/api/holidays/${create.body.id}`).set(auth(admin)).send({ name: 'Winter Vacation' });
    expect(upd.body.name).toBe('Winter Vacation');

    const del = await request(app).delete(`/api/holidays/${create.body.id}`).set(auth(admin));
    expect(del.status).toBe(200);
    expect((await request(app).get('/api/holidays').set(auth(admin))).body).toEqual([]);
  });

  it('rejects invalid input (400)', async () => {
    expect((await request(app).post('/api/classes').set(auth(admin)).send({ order: 1 })).status).toBe(400);
    expect((await request(app).post('/api/sessions').set(auth(admin)).send({ name: 'x' })).status).toBe(400);
  });

  it('scopes data to the tenant (coordinator of the same school sees the classes)', async () => {
    const coordinator = await token('coordinator');
    const res = await request(app).get('/api/classes').set(auth(coordinator));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(5);
  });
});
