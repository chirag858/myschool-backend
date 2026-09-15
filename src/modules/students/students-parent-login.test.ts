import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';
import { UserModel } from '../user/user.model';
import { StudentModel } from './student.model';

async function token(username: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ identifier: username, password: 'demo1234', captcha: 'x' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/**
 * "Create login" on the student's Login tab (principal / director). Each case
 * below failed before the fix on data that exists in real schools — the seeded
 * demo students all happen to avoid them.
 */
describe('Student parent login — create/reset on real-world data', () => {
  let principal: string;
  let schoolId: unknown;
  beforeEach(async () => {
    await seedDemo();
    principal = await token('principal');
    schoolId = (await StudentModel.findOne({}).lean())!.schoolId;
  });

  let n = 0;
  const student = (extra: Record<string, unknown>) =>
    StudentModel.create({
      schoolId, admissionNumber: `PL-${String(++n)}`, name: `Login Kid ${String(n)}`, className: '6', section: 'E',
      classKey: '6-E', admissionType: 'new', admittedAt: new Date('2025-08-01'), gender: 'male', ...extra,
    });
  const create = (id: unknown, as = principal) =>
    request(app).post(`/api/students/${String(id)}/parent-credentials/reset`).set(auth(as));
  const creds = (id: unknown) => request(app).get(`/api/students/${String(id)}/parent-credentials`).set(auth(principal));

  it('uses the mother\'s number when the father\'s is saved blank (was 400)', async () => {
    const s = await student({ mobile: '', parents: { fatherMobile: '', motherMobile: '9990101010' } });
    const res = await create(s._id);
    expect(res.status).toBe(200);
    expect(res.body.tempPassword).toEqual(expect.any(String));
    expect((await creds(s._id)).body).toMatchObject({ hasLogin: true, mobile: '9990101010' });
  });

  it('creates a login when the linked parent account was deleted (was 404)', async () => {
    const s = await student({ mobile: '9990202020', parents: { fatherMobile: '9990202020' }, parentUserId: '64b000000000000000000001' });
    expect((await creds(s._id)).body).toEqual({ hasLogin: false });
    const res = await create(s._id);
    expect(res.status).toBe(200);
    expect(res.body.tempPassword).toEqual(expect.any(String));
    expect((await creds(s._id)).body.hasLogin).toBe(true);
  });

  it('does not collide with a staff login already using the mobile as username (was 409)', async () => {
    await UserModel.create({ name: 'Clerk', username: '9990303030', mobile: '9990303030', role: 'accountant', schoolId, passwordHash: 'x', active: true });
    const s = await student({ mobile: '9990303030', parents: { fatherMobile: '9990303030' } });
    const res = await create(s._id);
    expect(res.status).toBe(200);
    const after = (await creds(s._id)).body;
    expect(after).toMatchObject({ hasLogin: true, mobile: '9990303030' });
    expect(after.username).not.toBe('9990303030');

    // …and the parent can actually sign in with the issued password, by mobile.
    const login = await request(app).post('/api/auth/login').send({ identifier: after.username, password: res.body.tempPassword, captcha: 'x' });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe('parent');
  });

  it('a sibling sharing the number is linked, and says so instead of a silent success', async () => {
    const a = await student({ mobile: '9990404040', parents: { fatherMobile: '9990404040' } });
    const b = await student({ mobile: '9990404040', parents: { fatherMobile: '9990404040' } });
    expect((await create(a._id)).body.tempPassword).toEqual(expect.any(String));
    const second = await create(b._id);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ linked: true });
    expect((await creds(b._id)).body.userId).toBe((await creds(a._id)).body.userId);
  });

  it('director (school_admin) can create too; a student with no number at all gets a clear 400', async () => {
    const director = await token('schooladmin');
    const ok = await student({ mobile: '', parents: { guardianMobile: '9990505050' } });
    expect((await create(ok._id, director)).status).toBe(200);

    const none = await student({ mobile: '', parents: { fatherMobile: '', motherMobile: '' } });
    const res = await create(none._id, director);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no parent mobile/i);
  });
});
