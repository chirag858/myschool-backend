import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';
import { SchoolModel } from '../school/school.model';

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

describe('Platform modules API (Global Module Controls)', () => {
  let sa: string;
  beforeEach(async () => {
    await seedDemo();
    sa = await token('superadmin');
  });

  it('requires auth (401) and forbids non-super-admin (403)', async () => {
    expect((await request(app).get('/api/super-admin/modules/overview')).status).toBe(401);
    const admin = await token('schooladmin');
    expect(
      (await request(app).get('/api/super-admin/modules/overview').set(auth(admin))).status,
    ).toBe(403);
  });

  it('rejects disabling a core/locked module', async () => {
    const res = await request(app)
      .patch('/api/super-admin/modules/student_mgmt')
      .set(auth(sa))
      .send({ enabled: false });
    expect(res.status).toBe(400);
  });

  it(
    'disabling a module globally actually turns it off for every school currently using it, ' +
      'not just a cosmetic platform flag nothing else reads',
    async () => {
      // Two more tenants beyond the seeded MSC school, so this exercises a
      // real multi-school cascade — not just a single-document coincidence.
      const second = await SchoolModel.create({
        name: 'Second School',
        code: 'SEC',
        status: 'active',
      });
      const third = await SchoolModel.create({
        name: 'Third School',
        code: 'THD',
        // This one already opted out of hostel on its own — the global
        // disable must not need to touch it, and must not report it as
        // newly affected.
        moduleFlags: { hostel: false },
      });

      const before = await request(app).get('/api/super-admin/modules/overview').set(auth(sa));
      const hostelBefore = before.body.find((m: { key: string }) => m.key === 'hostel');
      expect(hostelBefore.enabled).toBe(true);
      // The seed already has other schools using Hostel by default; `second`
      // adds one more (moduleFlags absent -> counts as enabled), `third`
      // already opted out on its own and shouldn't be among the affected.
      const baselineEnabled: number = hostelBefore.enabledInSchools;

      const disable = await request(app)
        .patch('/api/super-admin/modules/hostel')
        .set(auth(sa))
        .send({ enabled: false });
      expect(disable.status).toBe(200);
      expect(disable.body).toMatchObject({ key: 'hostel', enabled: false, affectedSchools: baselineEnabled });

      // The actual per-school flag is now real, not just the platform override.
      const msc = await SchoolModel.findOne({ code: 'MSC' }).lean();
      expect((msc?.moduleFlags as Record<string, boolean> | undefined)?.hostel).toBe(false);
      const secondAfter = await SchoolModel.findById(second._id).lean();
      expect((secondAfter?.moduleFlags as Record<string, boolean> | undefined)?.hostel).toBe(false);
      // Third already had it off — untouched, not double-counted.
      const thirdAfter = await SchoolModel.findById(third._id).lean();
      expect((thirdAfter?.moduleFlags as Record<string, boolean> | undefined)?.hostel).toBe(false);

      const after = await request(app).get('/api/super-admin/modules/overview').set(auth(sa));
      const hostelAfter = after.body.find((m: { key: string }) => m.key === 'hostel');
      expect(hostelAfter.enabled).toBe(false);
      expect(hostelAfter.enabledInSchools).toBe(0);

      // Re-enabling globally lifts the platform-level block but does not
      // silently flip schools back on behind their admins' backs.
      const enable = await request(app)
        .patch('/api/super-admin/modules/hostel')
        .set(auth(sa))
        .send({ enabled: true });
      expect(enable.body).toMatchObject({ key: 'hostel', enabled: true, affectedSchools: 0 });
      const mscAfterEnable = await SchoolModel.findOne({ code: 'MSC' }).lean();
      expect((mscAfterEnable?.moduleFlags as Record<string, boolean> | undefined)?.hostel).toBe(false);

      const final = await request(app).get('/api/super-admin/modules/overview').set(auth(sa));
      const hostelFinal = final.body.find((m: { key: string }) => m.key === 'hostel');
      expect(hostelFinal.enabled).toBe(true);
      expect(hostelFinal.enabledInSchools).toBe(0);
    },
  );

  it('apps overview + toggle still work (unrelated path, unaffected by the modules fix)', async () => {
    const res = await request(app).get('/api/super-admin/apps/overview').set(auth(sa));
    expect(res.status).toBe(200);
    const parentApp = res.body.find((a: { key: string }) => a.key === 'parent_app');
    expect(parentApp.enabled).toBe(true);
    const toggled = await request(app)
      .patch('/api/super-admin/apps/parent_app')
      .set(auth(sa))
      .send({ enabled: false });
    expect(toggled.status).toBe(200);
  });
});
