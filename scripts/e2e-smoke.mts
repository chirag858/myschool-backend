/**
 * Live end-to-end smoke test. Boots the REAL Express server against an
 * ephemeral MongoDB, seeds the demo world, and drives the exact HTTP flows the
 * mysmartcampus-erp web app makes for each role — login, dashboards, lists,
 * and a few write→read-back mutations. Run: npx tsx scripts/e2e-smoke.mts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { app } from '../src/app';
import { seedDemo } from '../src/seed/seed';

const PORT = 3999;
const BASE = `http://localhost:${PORT}/api`;

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    failures.push(`${name} ${detail}`);
    console.log(`  ✗ ${name} ${detail}`);
  }
}

async function req(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, body: data };
}

async function login(username: string, password = 'demo1234'): Promise<string> {
  const { body } = await req('POST', '/auth/login', undefined, { username, password, captcha: 'x' });
  return body?.tokens?.accessToken ?? '';
}

const len = (x: unknown): number => (Array.isArray(x) ? x.length : Array.isArray((x as any)?.rows) ? (x as any).rows.length : -1);

async function main(): Promise<void> {
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));
  await seedDemo();
  const server = app.listen(PORT);
  await new Promise((r) => server.once('listening', r));

  try {
    // ── Auth: every seeded role logs in ──
    console.log('\n[Auth] login for every role');
    const tokens: Record<string, string> = {};
    for (const [role, user, pw] of [
      ['super_admin', 'superadmin', 'demo1234'],
      ['school_admin', 'schooladmin', 'demo1234'],
      ['principal', 'principal', 'demo1234'],
      ['accountant', 'accountant', 'demo1234'],
      ['teacher', 'teacher', 'demo1234'],
      ['receptionist', 'receptionist', 'demo1234'],
      ['coordinator', 'coordinator', 'demo1234'],
      ['gate_manager', 'amingatemanager@gmail.com', 'Gatemanager@123'],
      ['parent', 'parent', 'demo1234'],
    ] as const) {
      tokens[role] = await login(user, pw);
      check(`login ${role}`, tokens[role].length > 20);
    }
    check('bad credentials rejected (401)', (await req('POST', '/auth/login', undefined, { username: 'schooladmin', password: 'wrong', captcha: 'x' })).status === 401);

    // ── Super admin ──
    console.log('\n[Super Admin] platform dashboards');
    const sa = tokens.super_admin;
    check('dashboard/stats', (await req('GET', '/super-admin/dashboard/stats', sa)).body?.totalSchools >= 1);
    const schools = await req('GET', '/super-admin/schools', sa);
    check('schools list', len(schools.body) >= 1);
    const msc = (schools.body.rows as any[]).find((r) => r.code === 'MSC');
    check('infrastructure', (await req('GET', '/super-admin/dashboard/infrastructure', sa)).body?.cpuPercent >= 0);
    check('tickets/stats', typeof (await req('GET', '/super-admin/tickets/stats', sa)).body?.open === 'number');
    check('subscriptions', len((await req('GET', `/super-admin/schools/${msc.id}/subscriptions`, sa)).body) >= 1);
    const imp = await req('POST', `/super-admin/schools/${msc.id}/impersonate`, sa);
    check('impersonation mints a token', (imp.body?.token ?? '').length > 20);
    check('impersonation token works as school admin', (await req('GET', '/students', imp.body.token)).status === 200);

    // ── School admin: core ERP ──
    console.log('\n[School Admin] core ERP lists');
    const adm = tokens.school_admin;
    check('students list', len((await req('GET', '/students', adm)).body) > 0);
    check('staff list', len((await req('GET', '/staff', adm)).body) > 0);
    check('staff stats', (await req('GET', '/staff/stats', adm)).body?.totalStaff > 0);
    check('attendance dashboard', typeof (await req('GET', '/attendance/dashboard', adm)).body?.overallPercent === 'number');
    check('academics sessions', len((await req('GET', '/sessions', adm)).body) >= 1);
    check('academics classes', len((await req('GET', '/classes', adm)).body) >= 1);
    check('exams list', len((await req('GET', '/exams', adm)).body) >= 1);
    check('library books', len((await req('GET', '/library/books', adm)).body) >= 1);
    check('hostel buildings', len((await req('GET', '/hostel/buildings', adm)).body) >= 1);
    check('inventory items', len((await req('GET', '/inventory/items', adm)).body) >= 1);
    check('transport vehicles', len((await req('GET', '/transport/vehicles', adm)).body) >= 1);
    check('communication circulars', len((await req('GET', '/circulars', adm)).body) >= 1);
    // attendance report matrices
    check('attendance monthly report', len((await req('GET', '/attendance/reports/monthly', adm)).body) > 0);
    check('attendance register matrix', Array.isArray((await req('GET', '/attendance/reports/register?classKey=Nursery-A', adm)).body?.students));

    // ── Accountant: fee + finance ──
    console.log('\n[Accountant] fee + finance');
    const acc = tokens.accountant;
    check('fee heads', len((await req('GET', '/fee/heads', acc)).body) >= 1);
    check('fee receipts', typeof (await req('GET', '/fee/receipts', acc)).body?.total === 'number');
    check('fee stats/today', typeof (await req('GET', '/fee/stats/today', acc)).body?.todayCount === 'number');
    check('fee report daily', Array.isArray((await req('GET', '/fee/reports/daily', acc)).body?.rows));
    check('fee ledger', len((await req('GET', '/fee/ledger', acc)).body) > 0);
    check('payroll stats', typeof (await req('GET', '/payroll/stats', acc)).body?.totalPayroll === 'number');
    check('refund requests', len((await req('GET', '/fee/refund-requests', acc)).body) >= 1);
    check('waive-off queue', len((await req('GET', '/fee/waive-off/queue', acc)).body) >= 1);
    check('bank accounts', len((await req('GET', '/bank/accounts', acc)).body) >= 1);
    check('income list', len((await req('GET', '/expenses/income', acc)).body) >= 0);

    // ── Teacher portal + WRITE flow ──
    console.log('\n[Teacher] portal + write→read-back');
    const tch = tokens.teacher;
    check('my-classes', len((await req('GET', '/teacher/my-classes', tch)).body) === 2);
    check('my-students', len((await req('GET', '/teacher/my-students', tch)).body) > 0);
    const hwBefore = len((await req('GET', '/teacher/homework', tch)).body);
    const hwCreate = await req('POST', '/teacher/homework', tch, { classKey: 'Class 1-A', subject: 'Mathematics', title: 'E2E HW', dueDate: '2026-09-01' });
    check('create homework (201)', hwCreate.status === 201);
    check('homework persisted (count+1)', len((await req('GET', '/teacher/homework', tch)).body) === hwBefore + 1);
    check('leave balance', len((await req('GET', '/teacher/leave/balance', tch)).body) === 4);

    // ── Coordinator ──
    console.log('\n[Coordinator]');
    const co = tokens.coordinator;
    check('dashboard', (await req('GET', '/coordinator/dashboard', co)).body?.supervisedClassesCount >= 1);
    check('student-leaves', len((await req('GET', '/coordinator/student-leaves', co)).body) === 3);
    check('staff-leaves (L1 queue)', len((await req('GET', '/coordinator/staff-leaves', co)).body) === 1);
    check('staff-overview', len((await req('GET', '/coordinator/staff-overview', co)).body) === 4);

    // ── Reception ──
    console.log('\n[Reception]');
    const rec = tokens.receptionist;
    check('dashboard', typeof (await req('GET', '/reception/dashboard', rec)).body === 'object');
    check('appointments', len((await req('GET', '/reception/appointments', rec)).body) >= 0);

    // ── Gate manager + WRITE flow ──
    console.log('\n[Gate Manager] + write→read-back');
    const gm = tokens.gate_manager;
    check('dashboard', typeof (await req('GET', '/gate-manager/dashboard', gm)).body?.visitorsInside === 'number');
    check('search students', len((await req('GET', '/gate-manager/students', gm)).body) > 0);
    const visBefore = len((await req('GET', '/gate-manager/visitors', gm)).body);
    const visCreate = await req('POST', '/gate-manager/visitors', gm, { name: 'E2E Visitor', mobile: '9999999999', purpose: 'Test', whomToMeet: 'Office', takingStudentHome: false });
    check('log visitor (201)', visCreate.status === 201);
    check('visitor persisted (count+1)', len((await req('GET', '/gate-manager/visitors', gm)).body) === visBefore + 1);

    // ── Parent (ownership-scoped) ──
    console.log('\n[Parent] own children only');
    const par = tokens.parent;
    const kids = await req('GET', '/parent/children', par);
    check('children', len(kids.body) === 2);
    const kidId = kids.body[0].id;
    check('fee-summary (own child)', typeof (await req('GET', `/parent/fee-summary?childId=${kidId}`, par)).body?.paid === 'number');
    check('attendance (own child)', Array.isArray((await req('GET', `/parent/attendance?childId=${kidId}`, par)).body));
    check('circulars', len((await req('GET', '/parent/circulars', par)).body) >= 1);
    check('blocked from a non-child (404)', (await req('GET', '/parent/fee-summary?childId=000000000000000000000000', par)).status === 404);

    // ── Cross-role security ──
    console.log('\n[Security] role gating');
    check('accountant blocked from teacher portal (403)', (await req('GET', '/teacher/my-classes', acc)).status === 403);
    check('teacher blocked from payroll (403)', (await req('GET', '/payroll/stats', tch)).status === 403);
    check('unauthenticated request rejected (401)', (await req('GET', '/students')).status === 401);
  } finally {
    server.close();
    await mongoose.disconnect().catch(() => undefined);
    await mongo.stop().catch(() => undefined);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`E2E RESULT: ${pass} passed, ${fail} failed (of ${pass + fail})`);
  if (failures.length) {
    console.log('FAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('='.repeat(50));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('E2E harness crashed:', err);
  process.exit(2);
});
