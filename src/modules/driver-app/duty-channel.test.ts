import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';
import { clearAllDuty, requestPosition, park, submitPosition } from './duty-registry';

async function token(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password: 'demo1234', captcha: 'x', schoolCode: 'MSC' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const tick = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));
/**
 * Dispatch a supertest request NOW instead of when it is awaited. These tests
 * depend on real concurrency — a parked driver request must already be in
 * flight when the parent asks — and supertest only sends on `.then()`.
 */
const fire = <T extends PromiseLike<unknown>>(t: T): Promise<Awaited<T>> => Promise.resolve(t) as Promise<Awaited<T>>;

/**
 * The on-demand location channel end to end: a parent taps Track, the driver's
 * parked request wakes, the phone answers, and the position reaches that parent
 * — with nothing written anywhere.
 */
describe('Driver duty channel (on-demand location)', () => {
  let driver: string;
  let parent: string;
  let childId: string;

  beforeEach(async () => {
    await seedDemo();
    clearAllDuty();
    driver = await token('driver');
    parent = await token('parent');
    const kids = await request(app).get('/api/parent/children').set(auth(parent));
    // The seeded bus rider is a Class 1-A child — the demo parent's own.
    const { StudentTransportModel } = await import('../transport/transport.models');
    const link = await StudentTransportModel.findOne({}).lean();
    childId = String(link!.studentId);
    expect(kids.body.map((k: { id: string }) => k.id)).toContain(childId);
  });

  afterEach(() => clearAllDuty());

  it('parent taps Track → driver phone answers → position reaches that parent', async () => {
    await request(app).post('/api/driver/my-bus/trip/start').set(auth(driver)).send({ type: 'pickup' });

    // Driver goes on duty: one parked request, no GPS read yet.
    const parked = fire(request(app).get('/api/driver/duty/wait').set(auth(driver)));
    await tick();

    // Parent asks. This is the only thing that wakes the phone.
    const tracking = fire(request(app).get('/api/parent/transport/locate').query({ childId }).set(auth(parent)));

    const wake = await parked;
    expect(wake.status).toBe(200);
    expect(wake.body).toMatchObject({ locate: true, reqId: expect.any(String) });

    const answer = await request(app)
      .post('/api/driver/duty/position')
      .set(auth(driver))
      .send({ reqId: wake.body.reqId, lat: 30.3398, lng: 76.3869, accuracy: 12, at: Date.now() });
    expect(answer.body).toEqual({ delivered: true });

    const res = await tracking;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      state: 'located',
      position: { lat: 30.3398, lng: 76.3869, accuracy: 12 },
      bus: { registrationNumber: 'PB-11-AB-1234' },
      driver: { name: expect.any(String) },
      stopName: expect.any(String),
    });
    expect(res.body.ageSeconds).toBeLessThan(5);
  });

  it('nothing is persisted: no coordinate reaches the database', async () => {
    const mongoose = (await import('mongoose')).default;
    await request(app).post('/api/driver/my-bus/trip/start').set(auth(driver)).send({ type: 'pickup' });
    const parked = fire(request(app).get('/api/driver/duty/wait').set(auth(driver)));
    await tick();
    const tracking = fire(request(app).get('/api/parent/transport/locate').query({ childId }).set(auth(parent)));
    const wake = await parked;
    await request(app)
      .post('/api/driver/duty/position')
      .set(auth(driver))
      .send({ reqId: wake.body.reqId, lat: 30.5, lng: 76.5 });
    expect((await tracking).body.state).toBe('located');

    // Sweep EVERY collection in the database: the position must not have been
    // written anywhere — not to a location store, a trip record or an audit log.
    const db = mongoose.connection.db!;
    const collections = await db.listCollections().toArray();
    const offenders: string[] = [];
    for (const { name } of collections) {
      const docs = await db.collection(name).find({}).limit(500).toArray();
      const text = JSON.stringify(docs);
      if (text.includes('30.5') || text.includes('76.5')) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('several parents asking at once cost the driver ONE GPS read', async () => {
    await request(app).post('/api/driver/my-bus/trip/start').set(auth(driver)).send({ type: 'pickup' });
    const parked = fire(request(app).get('/api/driver/duty/wait').set(auth(driver)));
    await tick();

    const a = fire(request(app).get('/api/parent/transport/locate').query({ childId }).set(auth(parent)));
    const b = fire(request(app).get('/api/parent/transport/locate').query({ childId }).set(auth(parent)));
    const c = fire(request(app).get('/api/parent/transport/locate').query({ childId }).set(auth(parent)));

    const wake = await parked;
    await request(app)
      .post('/api/driver/duty/position')
      .set(auth(driver))
      .send({ reqId: wake.body.reqId, lat: 30.34, lng: 76.39 });

    for (const res of await Promise.all([a, b, c])) {
      expect(res.body).toMatchObject({ state: 'located', position: { lat: 30.34, lng: 76.39 } });
    }
  });

  it('trip not started → "not_started"; on duty then trip ended → no longer locatable', async () => {
    const before = await request(app).get('/api/parent/transport/locate').query({ childId }).set(auth(parent));
    expect(before.body).toMatchObject({ state: 'not_started', position: null });

    await request(app).post('/api/driver/my-bus/trip/start').set(auth(driver)).send({ type: 'pickup' });
    // Trip running but the driver app is NOT holding a request (backgrounded / killed).
    const unreached = await request(app).get('/api/parent/transport/locate').query({ childId }).set(auth(parent));
    expect(unreached.body.state).toBe('not_on_duty');

    await request(app).post('/api/driver/my-bus/trip/end').set(auth(driver)).send({});
    const after = await request(app).get('/api/parent/transport/locate').query({ childId }).set(auth(parent));
    expect(after.body.state).toBe('not_started');
  });

  it('a child with no bus gets a polite answer, and another parent\'s child is refused', async () => {
    const { StudentTransportModel } = await import('../transport/transport.models');
    await StudentTransportModel.deleteMany({});
    const none = await request(app).get('/api/parent/transport/locate').query({ childId }).set(auth(parent));
    expect(none.status).toBe(200);
    expect(none.body).toMatchObject({ state: 'no_bus', position: null, bus: null });

    const notMine = '000000000000000000000000';
    expect((await request(app).get('/api/parent/transport/locate').query({ childId: notMine }).set(auth(parent))).status).toBe(404);
  });

  it('duty routes are driver-only, and need a running trip', async () => {
    expect((await request(app).get('/api/driver/duty/wait')).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get('/api/driver/duty/wait').set(auth(acc))).status).toBe(403);
    // No trip running yet.
    expect((await request(app).get('/api/driver/duty/wait').set(auth(driver))).status).toBe(409);
  });

  it('registry: a parked driver that never answers times out as "unreachable"', async () => {
    const busId = 'bus-unit-test';
    void park(busId, 2_000);
    await tick(20);
    expect(await requestPosition(busId, 150)).toEqual({ state: 'unreachable' });
    clearAllDuty();
  });

  it('registry: a position for an expired request is dropped, not delivered late', async () => {
    const busId = 'bus-unit-test-2';
    void park(busId, 2_000);
    await tick(20);
    const outcome = requestPosition(busId, 150);
    await tick(300); // let it time out
    expect(await outcome).toEqual({ state: 'unreachable' });
    expect(submitPosition(busId, 'stale-req-id', { lat: 1, lng: 2, at: Date.now() })).toBe(false);
    clearAllDuty();
  });
});
