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

describe('Students API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids non-academic roles (403)', async () => {
    expect((await request(app).get('/api/students')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/students').set(auth(acc))).status).toBe(403);
  });

  it('GET /students returns a paginated StudentsListResponse with StudentRow shape', async () => {
    const res = await request(app).get('/api/students').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 15, page: 1, pageSize: 10 });
    expect(res.body.rows.length).toBe(10);
    expect(res.body.rows[0]).toMatchObject({
      id: expect.any(String),
      admissionNumber: expect.any(String),
      name: expect.any(String),
      className: expect.any(String),
      section: expect.any(String),
      admissionType: expect.any(String),
      feeStatus: expect.any(String),
      profileStatus: expect.any(String),
      classKey: expect.any(String),
    });
  });

  it('paginates and filters by class, section and search', async () => {
    const page2 = await request(app).get('/api/students?page=2&pageSize=5').set(auth(admin));
    expect(page2.body.rows.length).toBe(5);
    expect(page2.body.page).toBe(2);

    const nursery = await request(app).get('/api/students?classKey=Nursery').set(auth(admin));
    expect(nursery.body.total).toBe(3);
    expect(nursery.body.rows.every((r: { className: string }) => r.className === 'Nursery')).toBe(true);

    const oneAdm = nursery.body.rows[0].admissionNumber;
    const search = await request(app).get(`/api/students?search=${oneAdm}`).set(auth(admin));
    expect(search.body.total).toBe(1);
  });

  it('GET /students/class-summary groups by class', async () => {
    const res = await request(app).get('/api/students/class-summary').set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(5);
    expect(res.body[0]).toMatchObject({ classKey: expect.any(String), className: expect.any(String), studentCount: 3 });
    const total = res.body.reduce((s: number, c: { studentCount: number }) => s + c.studentCount, 0);
    expect(total).toBe(15);
  });

  it('GET /students/:id returns a full StudentProfile', async () => {
    const list = await request(app).get('/api/students').set(auth(admin));
    const id = list.body.rows[0].id;
    const res = await request(app).get(`/api/students/${id}`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      admissionNumber: expect.any(String),
      rollNumber: expect.any(String),
      gender: expect.any(String),
      parents: expect.objectContaining({ fatherName: expect.any(String) }),
      currentAddress: expect.objectContaining({ city: expect.any(String) }),
      documents: expect.any(Array),
    });
  });

  it('404 for a missing student, 400 for an invalid id', async () => {
    expect((await request(app).get('/api/students/000000000000000000000000').set(auth(admin))).status).toBe(404);
    expect((await request(app).get('/api/students/nope').set(auth(admin))).status).toBe(400);
  });

  it('POST /students/bulk/status changes profileStatus for the selected students', async () => {
    const list = await request(app).get('/api/students').set(auth(admin));
    const ids = list.body.rows.slice(0, 2).map((r: { id: string }) => r.id);
    const res = await request(app)
      .post('/api/students/bulk/status')
      .set(auth(admin))
      .send({ studentIds: ids, status: 'suspended', reason: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(2);
    const suspended = await request(app).get('/api/students?profileStatus=suspended').set(auth(admin));
    expect(suspended.body.total).toBe(2);
  });

  it('POST /students/bulk/transfer moves students to a new class/section', async () => {
    const list = await request(app).get('/api/students').set(auth(admin));
    const id = list.body.rows[0].id;
    const res = await request(app)
      .post('/api/students/bulk/transfer')
      .set(auth(admin))
      .send({ studentIds: [id], toClassName: 'Class 10', toSection: 'C' });
    expect(res.body.affected).toBe(1);
    const profile = await request(app).get(`/api/students/${id}`).set(auth(admin));
    expect(profile.body.className).toBe('Class 10');
    expect(profile.body.section).toBe('C');
  });

  it('POST /students/bulk/promote promotes a whole class', async () => {
    const res = await request(app)
      .post('/api/students/bulk/promote')
      .set(auth(admin))
      .send({ fromClassKey: 'Nursery', toClassName: 'LKG', toSection: 'A', toSession: '2026-27' });
    expect(res.body.affected).toBe(3);
    const summary = await request(app).get('/api/students/class-summary').set(auth(admin));
    const lkg = summary.body.find((c: { className: string }) => c.className === 'LKG');
    expect(lkg.studentCount).toBe(6); // original 3 + promoted 3
  });

  it('rejects invalid bulk payloads (400)', async () => {
    expect((await request(app).post('/api/students/bulk/status').set(auth(admin)).send({ status: 'active' })).status).toBe(400);
  });

  it('documents: list, upload, delete (embedded on the student)', async () => {
    const list = await request(app).get('/api/students').set(auth(admin));
    const id = list.body.rows[0].id;

    expect((await request(app).get(`/api/students/${id}/documents`).set(auth(admin))).body.length).toBe(0);

    const add = await request(app)
      .post(`/api/students/${id}/documents`)
      .set(auth(admin))
      .send({ type: 'birth_certificate', fileName: 'birth.pdf', sizeBytes: 45000, customLabel: 'Birth cert' });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ id: expect.any(String), type: 'birth_certificate', fileName: 'birth.pdf', verification: 'pending' });

    const after = await request(app).get(`/api/students/${id}/documents`).set(auth(admin));
    expect(after.body.length).toBe(1);

    expect((await request(app).delete(`/api/students/${id}/documents/${add.body.id}`).set(auth(admin))).status).toBe(204);
    expect((await request(app).get(`/api/students/${id}/documents`).set(auth(admin))).body.length).toBe(0);
  });
});
