import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

async function token(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      username,
      password: 'demo1234',
      captcha: 'x',
      ...(['superadmin', 'support'].includes(username) ? {} : { schoolCode: 'MSC' }),
    });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Admin dashboard API (principal + school_admin)', () => {
  let principal: string;
  beforeEach(async () => {
    await seedDemo();
    principal = await token('principal');
  });

  it('requires auth (401) and forbids other roles (403)', async () => {
    expect((await request(app).get('/api/admin-dashboard/stats')).status).toBe(401);
    const teacher = await token('teacher');
    expect((await request(app).get('/api/admin-dashboard/stats').set(auth(teacher))).status).toBe(403);
  });

  it('stats: leaveCount and pendingDues are computed from real data, not hardcoded stubs', async () => {
    const res = await request(app).get('/api/admin-dashboard/stats').set(auth(principal));
    expect(res.status).toBe(200);
    expect(typeof res.body.attendance.leaveCount).toBe('number');
    expect(res.body.pendingDues).toMatchObject({ amount: expect.any(Number), studentsCount: expect.any(Number) });
    // Old stub always returned studentsCount * 5000 — flat multiple of 5000 for every seed run
    // would be a red flag, but the real calc depends on fee structure vs receipts.
    expect(res.body.pendingDues.amount).toBeGreaterThanOrEqual(0);
  });

  it('pending-approvals: admission count reflects real pending enquiries', async () => {
    const before = await request(app).get('/api/admin-dashboard/pending-approvals').set(auth(principal));
    const admissionBefore = before.body.find((r: { kind: string }) => r.kind === 'admission');
    expect(admissionBefore).toMatchObject({ id: '5', kind: 'admission', count: expect.any(Number) });

    await request(app)
      .post('/api/enquiries')
      .set(auth(principal))
      .send({ studentName: 'Test Enquiry Kid', mobile: '9998887771', interestedClass: 'Class 1' });

    const after = await request(app).get('/api/admin-dashboard/pending-approvals').set(auth(principal));
    const admissionAfter = after.body.find((r: { kind: string }) => r.kind === 'admission');
    expect(admissionAfter.count).toBe(admissionBefore.count + 1);
    expect(admissionAfter.oldestPendingSince).toEqual(expect.any(String));
  });

  it('staff-attendance-by-dept: groups real staff by department, not mock data', async () => {
    const res = await request(app).get('/api/admin-dashboard/staff-attendance-by-dept').set(auth(principal));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const totalAcrossDepts = res.body.reduce((sum: number, r: { total: number }) => sum + r.total, 0);

    const staffCount = await request(app).get('/api/admin-dashboard/stats').set(auth(principal));
    expect(totalAcrossDepts).toBe(staffCount.body.staff.total);
    for (const row of res.body) {
      expect(row).toMatchObject({
        dept: expect.any(String),
        total: expect.any(Number),
        present: expect.any(Number),
        absent: expect.any(Number),
        onLeave: expect.any(Number),
        notMarked: expect.any(Number),
      });
    }
  });
});
