import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';
import { UserModel } from '../user/user.model';
import { StaffModel } from './staff.models';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier: username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/**
 * The staff profile "Assignments" tab as the mobile app drives it for a
 * principal / director: a non-teacher login's supervised classes through the
 * `/coordinator/*` endpoints, read back through `/staff/:id/credentials` — with
 * the school taken from the caller's JWT (no `?schoolId=`).
 */
describe('Staff assignments — supervised classes (principal / director)', () => {
  beforeEach(async () => {
    await seedDemo();
  });

  it.each(['principal', 'schooladmin'])('%s: list class keys, assign, read back on the staff profile, clear', async (who) => {
    const as = await token(who);
    const coord = await UserModel.findOne({ username: 'coordinator' }).lean();
    // Link a staff record to the coordinator login — the profile reads through it.
    const staff = await StaffModel.findOne({ schoolId: coord!.schoolId }).lean();
    await StaffModel.updateOne({ _id: staff!._id }, { $set: { userId: coord!._id } });

    const keys = await request(app).get('/api/coordinator/class-keys').set(auth(as));
    expect(keys.status).toBe(200);
    expect(keys.body.length).toBeGreaterThanOrEqual(2);
    const pick = keys.body.slice(0, 2) as string[];

    const set = await request(app).patch(`/api/coordinator/assigned-classes/${String(coord!._id)}`).set(auth(as)).send({ classKeys: pick });
    expect(set.status).toBe(200);
    expect(set.body.assignedClasses).toEqual(pick);

    const creds = await request(app).get(`/api/staff/${String(staff!._id)}/credentials`).set(auth(as));
    expect(creds.status).toBe(200);
    expect(creds.body).toMatchObject({ hasLogin: true, role: 'coordinator', assignedClasses: pick });

    const cleared = await request(app).patch(`/api/coordinator/assigned-classes/${String(coord!._id)}`).set(auth(as)).send({ classKeys: [] });
    expect(cleared.body.assignedClasses).toEqual([]);
  });

  it('rejects a teacher target and an unknown class with a readable 400', async () => {
    const as = await token('principal');
    const teacher = await UserModel.findOne({ username: 'teacher' }).lean();
    const coord = await UserModel.findOne({ username: 'coordinator' }).lean();
    const t = await request(app).patch(`/api/coordinator/assigned-classes/${String(teacher!._id)}`).set(auth(as)).send({ classKeys: [] });
    expect(t.status).toBe(400);
    const bad = await request(app).patch(`/api/coordinator/assigned-classes/${String(coord!._id)}`).set(auth(as)).send({ classKeys: ['Nope-Z'] });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/Unknown class/);
  });
});
