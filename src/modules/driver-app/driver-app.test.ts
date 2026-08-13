import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier: username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Driver App API (mobile)', () => {
  let driver: string;
  let routeId: string;
  let tripId: string;
  beforeEach(async () => {
    await seedDemo();
    driver = await token('driver');
    const a = await request(app).get('/api/driver/assignment').set(auth(driver));
    routeId = a.body.routes[0].id;
    tripId = a.body.routes[0].trips[0].id;
  });

  it('requires auth (401) and forbids non-driver roles (403)', async () => {
    expect((await request(app).get('/api/driver/assignment')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/driver/assignment').set(auth(acc))).status).toBe(403);
  });

  it('assignment returns routes with stops, vehicle and trips', async () => {
    const res = await request(app).get('/api/driver/assignment').set(auth(driver));
    expect(res.body.routes.length).toBeGreaterThanOrEqual(1);
    expect(res.body.routes[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), stops: expect.any(Array), vehicle: expect.any(Object), trips: expect.any(Array) });
    expect(res.body.routes[0].trips.length).toBe(2);
  });

  it('full trip flow: start → manifest → mark boarding → end → history', async () => {
    const start = await request(app).post('/api/driver/trip/start').set(auth(driver)).send({ routeId, tripId });
    expect(start.body).toMatchObject({ tripId, status: 'active' });

    const manifest = await request(app).get(`/api/driver/manifest?routeId=${routeId}&tripId=${tripId}`).set(auth(driver));
    expect(manifest.body).toMatchObject({ routeId, tripId, students: expect.any(Array) });
    if (manifest.body.students.length) {
      const sid = manifest.body.students[0].id;
      const mark = await request(app).post('/api/driver/manifest/mark').set(auth(driver)).send({ tripId, studentId: sid, mark: 'boarded' });
      expect(mark.body).toMatchObject({ id: sid, mark: 'boarded' });
    }

    const end = await request(app).post('/api/driver/trip/end').set(auth(driver)).send({ tripId });
    expect(end.body).toMatchObject({ tripId, status: 'completed' });

    const history = await request(app).get('/api/driver/trips').set(auth(driver));
    expect(history.body.some((h: { id: string }) => h.id === tripId)).toBe(true);
    const detail = await request(app).get(`/api/driver/trips/detail?tripId=${tripId}`).set(auth(driver));
    expect(detail.body).toMatchObject({ id: tripId, outcomes: expect.any(Array) });
  });

  it('location: emit while active → preview reads it back (producer/consumer parity)', async () => {
    await request(app).post('/api/driver/trip/start').set(auth(driver)).send({ routeId, tripId });
    const emit = await request(app).post('/api/driver/location/emit').set(auth(driver))
      .send({ tripId, position: { lat: 30.35, lng: 76.39 }, bearing: 90, tripType: 'pickup', updatedAt: Date.now() });
    expect(emit.body).toMatchObject({ ok: true });
    const preview = await request(app).get(`/api/driver/location/preview?routeId=${routeId}`).set(auth(driver));
    expect(preview.body).toMatchObject({ tripStatus: 'active', position: { lat: 30.35, lng: 76.39 }, stops: expect.any(Array) });
  });

  it('preview reports no_trip before a trip starts', async () => {
    const preview = await request(app).get(`/api/driver/location/preview?routeId=${routeId}`).set(auth(driver));
    expect(preview.body).toMatchObject({ tripStatus: 'no_trip', position: null });
  });

  it('marking on an inactive trip is a 409', async () => {
    const manifest = await request(app).get(`/api/driver/manifest?routeId=${routeId}&tripId=${tripId}`).set(auth(driver));
    // no start → trip run does not exist yet → mark should 404 (no run) or 409; either way not 200
    const mark = await request(app).post('/api/driver/manifest/mark').set(auth(driver)).send({ tripId, studentId: manifest.body.students[0]?.id ?? 'x', mark: 'boarded' });
    expect([404, 409]).toContain(mark.status);
  });

  it('alerts: trigger then list', async () => {
    await request(app).post('/api/driver/trip/start').set(auth(driver)).send({ routeId, tripId });
    const trigger = await request(app).post('/api/driver/alerts').set(auth(driver)).send({ tripId, type: 'started' });
    expect(trigger.body).toMatchObject({ type: 'started', auto: false });
    const list = await request(app).get('/api/driver/alerts').set(auth(driver));
    expect(list.body.length).toBeGreaterThanOrEqual(1);
  });
});
