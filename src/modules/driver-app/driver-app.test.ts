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
  beforeEach(async () => {
    await seedDemo();
    driver = await token('driver');
  });

  it('my-bus: resolves the bus from the LOGIN, with its route, stops and rider count', async () => {
    const res = await request(app).get('/api/driver/my-bus').set(auth(driver));
    expect(res.status).toBe(200);
    expect(res.body.bus).toMatchObject({ id: expect.any(String), registrationNumber: 'PB-11-AB-1234', seatingCapacity: 40 });
    expect(res.body.route).toMatchObject({ id: expect.any(String), name: expect.any(String) });
    expect(res.body.route.stops[0]).toMatchObject({ order: expect.any(Number), name: expect.any(String), pickupTime: expect.any(String) });
    expect(res.body.studentCount).toBeGreaterThanOrEqual(1);
    expect(res.body.activeTrip).toBeNull();
  });

  it('my-bus: a driver with no bus assigned gets an empty result, never another bus', async () => {
    const { VehicleModel } = await import('../transport/transport.models');
    await VehicleModel.updateMany({}, { $unset: { driverUserId: '' } });
    const res = await request(app).get('/api/driver/my-bus').set(auth(driver));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bus: null, route: null, studentCount: 0, activeTrip: null });
    // …and they cannot start a trip on a bus that isn't theirs.
    expect((await request(app).post('/api/driver/my-bus/trip/start').set(auth(driver)).send({ type: 'pickup' })).status).toBe(403);
  });

  it('my-bus trip: start → shows active → second start refused → end → history', async () => {
    const start = await request(app).post('/api/driver/my-bus/trip/start').set(auth(driver)).send({ type: 'pickup' });
    expect(start.status).toBe(200);
    expect(start.body).toMatchObject({ tripId: expect.any(String), type: 'pickup', status: 'active' });
    // The trip id is server-made from the bus + date + type — not supplied by the app.
    const busId = (await request(app).get('/api/driver/my-bus').set(auth(driver))).body.bus.id;
    expect(start.body.tripId.startsWith(`${busId}:`)).toBe(true);

    const onDuty = await request(app).get('/api/driver/my-bus').set(auth(driver));
    expect(onDuty.body.activeTrip).toMatchObject({ tripId: start.body.tripId, type: 'pickup' });

    expect((await request(app).post('/api/driver/my-bus/trip/start').set(auth(driver)).send({ type: 'drop' })).status).toBe(409);

    const end = await request(app).post('/api/driver/my-bus/trip/end').set(auth(driver)).send({});
    expect(end.status).toBe(200);
    expect(end.body).toMatchObject({ tripId: start.body.tripId, status: 'completed' });
    expect((await request(app).get('/api/driver/my-bus').set(auth(driver))).body.activeTrip).toBeNull();

    // Ending with nothing running is a clear 404, not a silent success.
    expect((await request(app).post('/api/driver/my-bus/trip/end').set(auth(driver)).send({})).status).toBe(404);
  });

  it('my-bus students: the riders on this bus, with a parent number to call', async () => {
    const res = await request(app).get('/api/driver/my-bus/students').set(auth(driver));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      className: expect.any(String),
      stopName: expect.any(String),
      parentContact: expect.any(String),
    });
    expect(res.body[0].parentContact).toBeTruthy();

    // A rider row whose studentId is NOT an ObjectId must not 500 the roster
    // (the same CastError trap that broke exam marks).
    const { StudentTransportModel } = await import('../transport/transport.models');
    const one = await StudentTransportModel.findOne({}).lean();
    await StudentTransportModel.updateOne({ _id: one!._id }, { $set: { studentId: 'legacy-not-an-id' } });
    const after = await request(app).get('/api/driver/my-bus/students').set(auth(driver));
    expect(after.status).toBe(200);
  });

  it('my-bus students: a driver with no bus gets an empty roster, never another bus\'s children', async () => {
    const { VehicleModel } = await import('../transport/transport.models');
    await VehicleModel.updateMany({}, { $unset: { driverUserId: '' } });
    const res = await request(app).get('/api/driver/my-bus/students').set(auth(driver));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('the driver states the leg — the server never guesses it from the clock', async () => {
    // No leg → refused, rather than filed under whatever the server clock says.
    const vague = await request(app).post('/api/driver/my-bus/trip/start').set(auth(driver)).send({});
    expect(vague.status).toBe(400);

    const drop = await request(app).post('/api/driver/my-bus/trip/start').set(auth(driver)).send({ type: 'drop' });
    expect(drop.status).toBe(200);
    expect(drop.body.type).toBe('drop');
    expect((await request(app).get('/api/driver/my-bus').set(auth(driver))).body.activeTrip.type).toBe('drop');
  });

  it('my-bus: non-driver roles are refused', async () => {
    expect((await request(app).get('/api/driver/my-bus')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/driver/my-bus').set(auth(acc))).status).toBe(403);
  });

  it('requires auth (401) and forbids non-driver roles (403)', async () => {
    expect((await request(app).get('/api/driver/my-bus')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/driver/my-bus').set(auth(acc))).status).toBe(403);
  });

  it('the removed route-scoped surface is gone (404), not quietly still serving', async () => {
    // These ignored the logged-in driver, invented data, or were never
    // delivered to anyone. The rebuild deleted them.
    for (const path of [
      '/api/driver/assignment',
      '/api/driver/manifest',
      '/api/driver/location/preview',
      '/api/driver/alerts',
      '/api/driver/trips',
      '/api/driver/trips/detail',
    ]) {
      expect((await request(app).get(path).set(auth(driver))).status).toBe(404);
    }
    for (const path of ['/api/driver/trip/start', '/api/driver/manifest/mark', '/api/driver/location/emit']) {
      expect((await request(app).post(path).set(auth(driver)).send({})).status).toBe(404);
    }
  });
});
