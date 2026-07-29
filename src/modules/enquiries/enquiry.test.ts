import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Enquiries API', () => {
  let admin: string;
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids non-admissions roles (403)', async () => {
    expect((await request(app).get('/api/enquiries')).status).toBe(401);
    const teacher = await token('teacher');
    expect((await request(app).get('/api/enquiries').set(auth(teacher))).status).toBe(403);
  });

  it('rejects malformed create payloads (400)', async () => {
    expect((await request(app).post('/api/enquiries').set(auth(admin)).send({ studentName: 'A', mobile: '9990001111' })).status).toBe(400); // name too short
    expect((await request(app).post('/api/enquiries').set(auth(admin)).send({ studentName: 'Valid Name', mobile: '123' })).status).toBe(400); // bad mobile
    expect(
      (await request(app).post('/api/enquiries').set(auth(admin)).send({ studentName: 'Valid Name', mobile: '9990001111', source: 'carrier_pigeon' })).status,
    ).toBe(400); // bad source enum
  });

  it('creates, lists, updates status, converts, and deletes an enquiry', async () => {
    const create = await request(app)
      .post('/api/enquiries')
      .set(auth(admin))
      .send({ studentName: 'New Enquiry', fatherName: 'Father Name', mobile: '9990001111', interestedClass: '5', source: 'walk_in', notes: 'Interested' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ studentName: 'New Enquiry', status: 'new' });
    const id = create.body.id;

    const list = await request(app).get('/api/enquiries').set(auth(admin));
    expect(list.body.some((e: { id: string }) => e.id === id)).toBe(true);

    const badStatus = await request(app).patch(`/api/enquiries/${id}/status`).set(auth(admin)).send({ status: 'bogus' });
    expect(badStatus.status).toBe(400);

    const status = await request(app).patch(`/api/enquiries/${id}/status`).set(auth(admin)).send({ status: 'contacted' });
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('contacted');

    const convert = await request(app).patch(`/api/enquiries/${id}/convert`).set(auth(admin));
    expect(convert.status).toBe(200);
    expect(convert.body).toMatchObject({ admissionDraftId: id });

    const badId = await request(app).patch('/api/enquiries/not-a-valid-id/convert').set(auth(admin));
    expect(badId.status).toBe(400);

    expect((await request(app).delete(`/api/enquiries/${id}`).set(auth(admin))).status).toBe(204);
  });
});
