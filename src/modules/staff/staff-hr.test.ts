import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';

// HR document uploads go to Cloudflare R2; stub the transport so the multipart
// endpoint is testable without network/credentials.
vi.mock('../../lib/storage', () => ({
  uploadToR2: vi.fn().mockResolvedValue({ url: 'https://r2.test/staff-doc.pdf', key: 'test-key' }),
}));

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

describe('Staff HR extras API', () => {
  let admin: string;
  let staffId: string; // Rahul (EMP0002) — has seeded HR data
  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
    const list = await request(app).get('/api/staff').set(auth(admin));
    const rows = list.body.rows ?? list.body;
    staffId = rows.find((r: { employeeId: string }) => r.employeeId === 'EMP0002').id;
  });

  it('requires auth (401) and forbids non-HR roles (403)', async () => {
    expect((await request(app).get(`/api/staff/${staffId}/leave-balance`)).status).toBe(401);
    const acc = await token('accountant');
    expect((await request(app).get(`/api/staff/${staffId}/leave-balance`).set(auth(acc))).status).toBe(403);
  });

  it('leave: balance, seeded history, apply, review escalates/​rejects', async () => {
    const balance = await request(app).get(`/api/staff/${staffId}/leave-balance`).set(auth(admin));
    expect(balance.body.length).toBe(6);
    expect(balance.body.find((b: { type: string }) => b.type === 'casual')).toMatchObject({ allotted: 12, used: 0, remaining: 12 });

    const history = await request(app).get(`/api/staff/${staffId}/leave-history`).set(auth(admin));
    expect(history.body.length).toBe(1);
    const leaveId = history.body[0].id;

    const apply = await request(app)
      .post(`/api/staff/${staffId}/leave-apply`)
      .set(auth(admin))
      .send({ type: 'sick', fromDate: '2025-07-01', toDate: '2025-07-02', days: 2, reason: 'Flu' });
    expect(apply.status).toBe(201);
    expect(apply.body).toMatchObject({ status: 'pending', currentLevel: 1, type: 'sick' });

    // Approve at L1 escalates to L2 (stays pending).
    const review = await request(app).patch(`/api/staff/${staffId}/leave/${leaveId}/review`).set(auth(admin)).send({ action: 'approve', remarks: 'ok' });
    expect(review.body).toMatchObject({ status: 'pending' });
    const rej = await request(app).patch(`/api/staff/${staffId}/leave/${apply.body.id}/review`).set(auth(admin)).send({ action: 'reject', remarks: 'no' });
    expect(rej.body).toMatchObject({ status: 'rejected' });
  });

  it('salary: revise updates basic + revisions; save structure reflects on profile', async () => {
    const revise = await request(app).post(`/api/staff/${staffId}/salary-revise`).set(auth(admin)).send({ newBasic: 40000, reason: 'Annual hike' });
    expect(revise.body).toMatchObject({ ok: true });
    const profile = await request(app).get(`/api/staff/${staffId}`).set(auth(admin));
    expect(profile.body.basic).toBe(40000);
    expect(profile.body.salaryRevisions.length).toBeGreaterThanOrEqual(1);

    const save = await request(app)
      .put(`/api/staff/${staffId}/salary-structure`)
      .set(auth(admin))
      .send({ basic: 41000, paymentMode: 'bank', allowances: [{ id: 'a1', type: 'hra', amount: 5000, taxable: true }], deductions: [] });
    expect(save.status).toBe(204);
    const profile2 = await request(app).get(`/api/staff/${staffId}`).set(auth(admin));
    expect(profile2.body.salaryStructure).toMatchObject({ basic: 41000, paymentMode: 'bank' });

    const badSave = await request(app)
      .put(`/api/staff/${staffId}/salary-structure`)
      .set(auth(admin))
      .send({ basic: -100 });
    expect(badSave.status).toBe(400);
  });

  it('documents: seeded list, upload, generate HR document', async () => {
    const docs = await request(app).get(`/api/staff/${staffId}/documents`).set(auth(admin));
    expect(docs.body.length).toBe(1);
    const upload = await request(app)
      .post(`/api/staff/${staffId}/documents`)
      .set(auth(admin))
      .field('category', 'pan')
      .attach('document', Buffer.from('%PDF-1.4 test'), 'pan.pdf');
    expect(upload.status).toBe(201);
    expect((await request(app).get(`/api/staff/${staffId}/documents`).set(auth(admin))).body.length).toBe(2);

    const gen = await request(app).post('/api/staff/documents/generate').set(auth(admin)).send({ staffId, documentType: 'experience_certificate', data: {} });
    expect(gen.status).toBe(201);
    expect(gen.body).toMatchObject({ referenceNumber: expect.stringMatching(/^HR-/), generatedAt: expect.any(String) });
  });

  it('activity log + notice period', async () => {
    const activity = await request(app).get(`/api/staff/${staffId}/activity-log`).set(auth(admin));
    expect(activity.body.length).toBe(1);
    expect(activity.body[0]).toMatchObject({ action: 'Profile created', module: 'staff' });

    const np = await request(app).get('/api/staff/notice-period/permanent').set(auth(admin));
    expect(np.body).toMatchObject({ noticeDays: 60 });
  });

  it('activity log: real actions (leave, salary revise, salary structure) get logged', async () => {
    await request(app)
      .post(`/api/staff/${staffId}/leave-apply`)
      .set(auth(admin))
      .send({ type: 'sick', fromDate: '2025-07-01', toDate: '2025-07-02', days: 2, reason: 'Flu' });
    await request(app).post(`/api/staff/${staffId}/salary-revise`).set(auth(admin)).send({ newBasic: 40000, reason: 'Annual hike' });
    await request(app)
      .put(`/api/staff/${staffId}/salary-structure`)
      .set(auth(admin))
      .send({ basic: 41000, paymentMode: 'bank', allowances: [], deductions: [] });

    const activity = await request(app).get(`/api/staff/${staffId}/activity-log`).set(auth(admin));
    const actions = activity.body.map((a: { action: string }) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['Profile created', 'Leave applied', 'Salary revised', 'Salary structure updated']),
    );
  });

  it('payroll: generate slips, list, mark paid + hold, per-staff history, kpi', async () => {
    const gen = await request(app).post('/api/payroll/generate').set(auth(admin)).send({ month: 'June', year: 2025 });
    expect(gen.status).toBe(201);
    expect(gen.body).toMatchObject({ month: 'June', year: 2025, status: 'generated' });
    expect(gen.body.rows.length).toBe(4); // 4 active staff

    const list = await request(app).get('/api/payroll?month=June&year=2025').set(auth(admin));
    expect(list.body.rows.length).toBe(4);
    const [s1, s2] = list.body.rows;

    const paid = await request(app).patch(`/api/payroll/${s1.id}/mark-paid`).set(auth(admin)).send({ paymentDate: '2025-06-30', paymentMode: 'bank', reference: 'NEFT-1' });
    expect(paid.body).toMatchObject({ status: 'paid', paymentMode: 'bank' });
    const hold = await request(app).patch(`/api/payroll/${s2.id}/hold`).set(auth(admin)).send({ reason: 'Under review' });
    expect(hold.body).toMatchObject({ status: 'on_hold', holdReason: 'Under review' });

    const after = await request(app).get('/api/payroll?month=June&year=2025').set(auth(admin));
    expect(after.body.status).toBe('partially_paid');

    const staffSlip = (list.body.rows as { staffId: string; id: string }[]).find((r) => r.staffId === staffId);
    const hist = await request(app).get(`/api/staff/${staffId}/payroll-history`).set(auth(admin));
    expect(hist.body.length).toBe(1);
    expect(hist.body[0]).toMatchObject({
      month: 'June',
      year: 2025,
      netPaid: expect.any(Number),
      allowances: expect.any(Number),
      absentDeduction: expect.any(Number),
      otherDeductions: expect.any(Number),
    });
    expect(hist.body[0].gross).toBe(hist.body[0].basic + hist.body[0].allowances);
    expect(hist.body[0].netPaid).toBe(hist.body[0].gross - hist.body[0].absentDeduction - hist.body[0].otherDeductions);
    expect(staffSlip).toBeTruthy();

    const kpi = await request(app).get('/api/payroll/stats').set(auth(admin));
    expect(kpi.body).toMatchObject({ totalPayroll: expect.any(Number), paidCount: 1, pendingCount: expect.any(Number) });
  });

  it('payroll: absences dock pay proportionally', async () => {
    await request(app)
      .post('/api/staff/attendance/save')
      .set(auth(admin))
      .send({ date: '2025-07-02', attendance: [{ staffId, status: 'absent' }] });
    await request(app)
      .post('/api/staff/attendance/save')
      .set(auth(admin))
      .send({ date: '2025-07-03', attendance: [{ staffId, status: 'half_day' }] });

    const gen = await request(app).post('/api/payroll/generate').set(auth(admin)).send({ month: 'July', year: 2025 });
    expect(gen.status).toBe(201);
    const slip = (gen.body.rows as { staffId: string; gross: number; absentDeduction: number; otherDeductions: number; netPayable: number }[]).find((r) => r.staffId === staffId);
    expect(slip).toBeTruthy();
    const expectedDeduction = Math.round((slip!.gross / 31) * 1.5); // July has 31 days; 1 absent + 1 half-day
    expect(slip!.absentDeduction).toBe(expectedDeduction);
    expect(slip!.netPayable).toBe(slip!.gross - expectedDeduction - slip!.otherDeductions);
  });

  it('advances: seeded requests, create, approve → active advance', async () => {
    const requests = await request(app).get('/api/payroll/advance-requests').set(auth(admin));
    expect(requests.body.length).toBe(1);
    expect(requests.body[0]).toMatchObject({ amountRequested: 20000, status: 'pending' });

    const create = await request(app)
      .post('/api/payroll/advance-requests')
      .set(auth(admin))
      .send({ staffId, staffName: 'Rahul Verma', amountRequested: 10000, reason: 'Travel', repaymentMonths: 2, monthlyRecovery: 5000 });
    expect(create.status).toBe(201);

    const approve = await request(app).patch(`/api/payroll/advance-requests/${create.body.id}/review`).set(auth(admin)).send({ action: 'approve' });
    expect(approve.body).toMatchObject({ status: 'approved' });
    const active = await request(app).get('/api/payroll/active-advances').set(auth(admin));
    expect(active.body.length).toBe(1);
    expect(active.body[0]).toMatchObject({ totalAdvance: 10000, remaining: 10000, status: 'active' });
  });

  it('exit: rejects invalid exitType and missing reason', async () => {
    const badType = await request(app)
      .post(`/api/staff/${staffId}/exit`)
      .set(auth(admin))
      .send({ exitType: 'quit', lastWorkingDate: '2025-08-31', reason: 'x' });
    expect(badType.status).toBe(400);

    const missingReason = await request(app)
      .post(`/api/staff/${staffId}/exit`)
      .set(auth(admin))
      .send({ exitType: 'resignation', lastWorkingDate: '2025-08-31' });
    expect(missingReason.status).toBe(400);
  });

  it('exit: submit relieves the staff, exit-record returns it', async () => {
    const before = await request(app).get(`/api/staff/${staffId}`).set(auth(admin));
    expect(before.body.status).toBe('active');
    const exit = await request(app)
      .post(`/api/staff/${staffId}/exit`)
      .set(auth(admin))
      .send({ exitType: 'resignation', lastWorkingDate: '2025-08-31', noticePeriodDays: 30, reason: 'New opportunity', clearanceItems: [{ id: 'c1', label: 'Laptop', checked: true }] });
    expect(exit.status).toBe(201);
    expect(exit.body).toMatchObject({ exitType: 'resignation', staffName: expect.any(String) });

    const record = await request(app).get(`/api/staff/${staffId}/exit-record`).set(auth(admin));
    expect(record.body).toMatchObject({ exitType: 'resignation', lastWorkingDate: '2025-08-31' });
    const after = await request(app).get(`/api/staff/${staffId}`).set(auth(admin));
    expect(after.body.status).toBe('relieved');

    const activity = await request(app).get(`/api/staff/${staffId}/activity-log`).set(auth(admin));
    expect(activity.body.map((a: { action: string }) => a.action)).toContain('Exit submitted');
  });
});
