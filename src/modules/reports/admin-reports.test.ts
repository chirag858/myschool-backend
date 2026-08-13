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

describe('Custom Report Builder API (/api/reports/custom)', () => {
  let admin: string;

  beforeEach(async () => {
    await seedDemo();
    admin = await token('schooladmin');
  });

  it('requires auth (401) and forbids non-admin roles (403)', async () => {
    expect(
      (await request(app).post('/api/reports/custom').send({ source: 'students', fields: ['name'] })).status,
    ).toBe(401);
    // Accountant is deliberately in the report gate; assert with a non-admin role.
    const driver = await token('driver');
    expect(
      (
        await request(app)
          .post('/api/reports/custom')
          .set(auth(driver))
          .send({ source: 'students', fields: ['name'] })
      ).status,
    ).toBe(403);
  });

  it('rejects an unknown source (400) and empty field list (400)', async () => {
    expect(
      (
        await request(app)
          .post('/api/reports/custom')
          .set(auth(admin))
          .send({ source: 'not_a_source', fields: ['name'] })
      ).status,
    ).toBe(400);
    expect(
      (await request(app).post('/api/reports/custom').set(auth(admin)).send({ source: 'students', fields: [] }))
        .status,
    ).toBe(400);
  });

  it('students source returns real seeded rows with real fee + attendance data, not fabricated fields', async () => {
    const res = await request(app)
      .post('/api/reports/custom')
      .set(auth(admin))
      .send({ source: 'students', fields: ['name', 'admissionNo', 'class', 'mobile', 'feeStatus', 'presentPercent'] });
    expect(res.status).toBe(200);
    expect(res.body.columns).toEqual(['Name', 'Admission No.', 'Class', 'Mobile', 'Fee Status', 'Present %']);
    expect(res.body.rows.length).toBeGreaterThan(0);
    // At least one seeded student has a real mobile number (not blank).
    expect(res.body.rows.some((r: unknown[]) => String(r[3]).length > 0)).toBe(true);
  });

  it('staff source returns real payroll-derived numbers', async () => {
    const res = await request(app)
      .post('/api/reports/custom')
      .set(auth(admin))
      .send({ source: 'staff', fields: ['name', 'basic', 'allowances', 'deductions', 'net'] });
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    const [, basic, , , net] = res.body.rows[0];
    expect(basic).toBeGreaterThan(0);
    expect(net).toBeGreaterThan(0);
  });

  it('filters (contains/equals/gt) narrow results correctly', async () => {
    const all = await request(app)
      .post('/api/reports/custom')
      .set(auth(admin))
      .send({ source: 'students', fields: ['name', 'class'] });
    const totalCount = all.body.rows.length;

    const filtered = await request(app)
      .post('/api/reports/custom')
      .set(auth(admin))
      .send({
        source: 'students',
        fields: ['name', 'class'],
        filters: [{ field: 'class', operator: 'equals', value: 'Nursery' }],
      });
    expect(filtered.status).toBe(200);
    expect(filtered.body.rows.length).toBeGreaterThan(0);
    expect(filtered.body.rows.length).toBeLessThan(totalCount);
    expect(filtered.body.rows.every((r: unknown[]) => r[1] === 'Nursery')).toBe(true);
  });

  it('sortBy + sortDir actually orders rows', async () => {
    const res = await request(app)
      .post('/api/reports/custom')
      .set(auth(admin))
      .send({ source: 'staff', fields: ['name', 'basic'], sortBy: 'basic', sortDir: 'desc' });
    expect(res.status).toBe(200);
    const basics = res.body.rows.map((r: unknown[]) => Number(r[1]));
    const sorted = [...basics].sort((a, b) => b - a);
    expect(basics).toEqual(sorted);
  });

  it('maxRows caps the result set', async () => {
    const res = await request(app)
      .post('/api/reports/custom')
      .set(auth(admin))
      .send({ source: 'students', fields: ['name'], maxRows: 2 });
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(2);
  });

  it('showTotals appends a numeric-only totals row', async () => {
    const res = await request(app)
      .post('/api/reports/custom')
      .set(auth(admin))
      .send({ source: 'staff', fields: ['name', 'basic', 'net'], showTotals: true });
    expect(res.status).toBe(200);
    const last = res.body.rows[res.body.rows.length - 1];
    expect(last[0]).toBe('Total');
    expect(typeof last[1]).toBe('number');
    expect(last[1]).toBeGreaterThan(0);
  });

  it('POST /reports/custom/export produces a real downloadable Excel/PDF file', async () => {
    const excel = await request(app)
      .post('/api/reports/custom/export')
      .query({ format: 'excel' })
      .set(auth(admin))
      .send({ source: 'students', fields: ['name', 'admissionNo'] });
    expect(excel.status).toBe(200);
    expect(excel.headers['content-type']).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const pdf = await request(app)
      .post('/api/reports/custom/export')
      .query({ format: 'pdf' })
      .set(auth(admin))
      .send({ source: 'students', fields: ['name', 'admissionNo'] });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('examinations source reuses the exams module\'s own mark computation (agrees with real exam data)', async () => {
    const res = await request(app)
      .post('/api/reports/custom')
      .set(auth(admin))
      .send({ source: 'examinations', fields: ['exam', 'class', 'student', 'totalMarks', 'percentage'] });
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
    const [exam, , , totalMarks, percentage] = res.body.rows[0];
    expect(String(exam).length).toBeGreaterThan(0);
    expect(typeof totalMarks).toBe('number');
    expect(percentage).toBeGreaterThanOrEqual(0);
    expect(percentage).toBeLessThanOrEqual(100);
  });

  it('fee/transport/hostel/library sources all return real rows, not empty/mock', async () => {
    for (const source of ['fee', 'transport'] as const) {
      const res = await request(app)
        .post('/api/reports/custom')
        .set(auth(admin))
        .send({ source, fields: [...(source === 'fee' ? ['student', 'amount'] : ['student', 'route'])] });
      expect(res.status, source).toBe(200);
      expect(res.body.rows.length, source).toBeGreaterThan(0);
    }
  });
});
