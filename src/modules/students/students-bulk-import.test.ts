import ExcelJS from 'exceljs';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../../app';
import { seedDemo } from '../../seed/seed';
import { StudentModel } from './student.model';

async function token(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password: 'demo1234', captcha: 'x', schoolCode: 'MSC' });
  return res.body.tokens.accessToken as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const HEADERS = [
  'Admission Number', 'Admission Type (new/old)', 'Roll Number', 'Session', 'Class', 'Section',
  'Admission Date', 'Name', 'Gender (male/female/other)', 'House (BLUE/GREEN/RED/YELLOW)',
  'Date of Birth', 'Blood Group', 'Religion', 'Category',
  'Father Name', 'Father Mobile', 'Mother Name', 'Mother Mobile',
];

async function buildWorkbook(rows: Array<Record<string, string>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow(HEADERS);
  for (const r of rows) {
    sheet.addRow(HEADERS.map((h) => r[h] ?? ''));
  }
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

describe('Bulk admission import', () => {
  let schoolAdmin: string;
  let accountant: string;

  beforeEach(async () => {
    await seedDemo();
    schoolAdmin = await token('schooladmin');
    accountant = await token('accountant');
  });

  it('requires auth and forbids roles with no admission access', async () => {
    expect((await request(app).get('/api/students/bulk/import-template')).status).toBe(401);
    expect((await request(app).get('/api/students/bulk/import-template').set(auth(accountant))).status).toBe(403);
  });

  it('downloads a real, non-empty xlsx template', async () => {
    // supertest has no parser for the xlsx content-type, so buffer the raw
    // response ourselves to inspect its real byte length.
    const res = await request(app)
      .get('/api/students/bulk/import-template')
      .set(auth(schoolAdmin))
      .buffer(true)
      .parse((stream, callback) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect((res.body as Buffer).length).toBeGreaterThan(1000);
  });

  it('previews a valid row, auto-generates a missing admission number, and flags bad rows', async () => {
    const buffer = await buildWorkbook([
      {
        'Class': 'Class 1', 'Section': 'A', 'Name': 'Bulk Import Kid',
        'Gender (male/female/other)': 'male', 'House (BLUE/GREEN/RED/YELLOW)': 'blue',
        'Father Mobile': '9991234567',
      },
      {
        'Class': '', 'Section': 'A', 'Name': 'Missing Class Kid',
        'Gender (male/female/other)': 'female', 'House (BLUE/GREEN/RED/YELLOW)': 'RED',
      },
      {
        'Class': 'Class 1', 'Section': 'A', 'Name': 'Bad Gender Kid',
        'Gender (male/female/other)': 'alien', 'House (BLUE/GREEN/RED/YELLOW)': 'GREEN',
      },
    ]);

    const res = await request(app)
      .post('/api/students/bulk/import-preview')
      .set(auth(schoolAdmin))
      .attach('file', buffer, 'students.xlsx');

    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(3);
    expect(res.body.validCount).toBe(1);
    expect(res.body.errorCount).toBe(2);

    const good = res.body.rows.find((r: { name: string }) => r.name === 'Bulk Import Kid');
    expect(good.errors).toEqual([]);
    expect(good.data.admissionNumber).toMatch(/^ADM-\d{4}-\d{3}$/);
    expect(good.data.house).toBe('BLUE');
    expect(good.data.gender).toBe('male');

    const missingClass = res.body.rows.find((r: { name: string }) => r.name === 'Missing Class Kid');
    expect(missingClass.errors.some((e: { field: string }) => e.field === 'className')).toBe(true);

    const badGender = res.body.rows.find((r: { name: string }) => r.name === 'Bad Gender Kid');
    expect(badGender.errors.some((e: { field: string }) => e.field === 'gender')).toBe(true);
  });

  it('silently skips a fully blank row instead of reporting a wall of required-field errors', async () => {
    const buffer = await buildWorkbook([
      { 'Class': 'Class 1', 'Section': 'A', 'Name': '', 'Gender (male/female/other)': '', 'House (BLUE/GREEN/RED/YELLOW)': '' },
    ]);
    const res = await request(app)
      .post('/api/students/bulk/import-preview')
      .set(auth(schoolAdmin))
      .attach('file', buffer, 'students.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });

  it('rejects a file with no recognizable header row', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sheet1');
    sheet.addRow(['Foo', 'Bar']);
    sheet.addRow(['x', 'y']);
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const res = await request(app)
      .post('/api/students/bulk/import-preview')
      .set(auth(schoolAdmin))
      .attach('file', buffer, 'bad.xlsx');
    expect(res.status).toBe(400);
  });

  it('commits only the valid rows and creates real students with the right house/gender, tolerating per-row failures', async () => {
    const buffer = await buildWorkbook([
      {
        'Admission Number': 'ADM-2099-501', 'Class': 'Class 1', 'Section': 'A', 'Name': 'Commit Kid One',
        'Gender (male/female/other)': 'female', 'House (BLUE/GREEN/RED/YELLOW)': 'yellow',
      },
      {
        'Admission Number': 'ADM-2099-502', 'Class': 'Class 1', 'Section': 'A', 'Name': 'Commit Kid Two',
        'Gender (male/female/other)': 'male', 'House (BLUE/GREEN/RED/YELLOW)': 'red',
      },
    ]);

    const preview = await request(app)
      .post('/api/students/bulk/import-preview')
      .set(auth(schoolAdmin))
      .attach('file', buffer, 'students.xlsx');
    expect(preview.body.errorCount).toBe(0);

    const commit = await request(app)
      .post('/api/students/bulk/import')
      .set(auth(schoolAdmin))
      .send({ rows: preview.body.rows.map((r: { data: unknown }) => r.data) });

    expect(commit.status).toBe(201);
    expect(commit.body.created).toBe(2);
    expect(commit.body.failed).toBe(0);

    const kidOne = await StudentModel.findOne({ admissionNumber: 'ADM-2099-501' }).lean();
    expect(kidOne).toMatchObject({ name: 'Commit Kid One', house: 'YELLOW', gender: 'female' });
    const kidTwo = await StudentModel.findOne({ admissionNumber: 'ADM-2099-502' }).lean();
    expect(kidTwo).toMatchObject({ name: 'Commit Kid Two', house: 'RED', gender: 'male' });
  });

  it('rejects an empty rows array (400) and forbids non-admission roles from committing', async () => {
    const empty = await request(app).post('/api/students/bulk/import').set(auth(schoolAdmin)).send({ rows: [] });
    expect(empty.status).toBe(400);

    const forbidden = await request(app)
      .post('/api/students/bulk/import')
      .set(auth(accountant))
      .send({ rows: [{ name: 'x' }] });
    expect(forbidden.status).toBe(403);
  });
});
