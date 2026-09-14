/**
 * Verifies the deployed API against the endpoints the mysmartcampus-erp web
 * clients actually call — grouped per feature domain, one by one.
 *
 *   node scripts/verify-live.mjs                       # https://api.mysmartcampus.in/api
 *   API=http://localhost:3001/api node scripts/verify-live.mjs
 */
const BASE = process.env.API || 'https://api.mysmartcampus.in/api';

const tokens = {};
let pass = 0, fail = 0;
const failures = [];

async function req(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: data };
}

async function login(username, password = 'demo1234') {
  const { body } = await req('POST', '/auth/login', undefined, { username, password, captcha: 'x' });
  return body?.tokens?.accessToken ?? '';
}

/** Assert a GET returns 200 and (optionally) satisfies a shape predicate. */
async function check(path, role, predicate) {
  const t = tokens[role];
  const { status, body } = await req('GET', path, t);
  const ok = status === 200 && (!predicate || predicate(body));
  if (ok) { pass++; console.log(`    ✓ ${path}`); }
  else {
    fail++; failures.push(`${path} (${role}) → ${status}`);
    console.log(`    ✗ ${path}  → HTTP ${status}${predicate && status === 200 ? ' (unexpected shape)' : ''}`);
  }
}

const nonEmpty = (b) => Array.isArray(b) ? b.length > 0 : Array.isArray(b?.rows) ? b.rows.length > 0 : !!b;
const isArr = (b) => Array.isArray(b);
const isObj = (b) => !!b && typeof b === 'object';

async function main() {
  console.log(`\nVerifying: ${BASE}\n${'='.repeat(60)}`);

  // ── Auth ──
  console.log('\n[auth]');
  for (const [role, user, pw] of [
    ['super_admin', 'superadmin', 'demo1234'],
    ['school_admin', 'schooladmin', 'demo1234'],
    ['accountant', 'accountant', 'demo1234'],
    ['teacher', 'teacher', 'demo1234'],
    ['coordinator', 'coordinator', 'demo1234'],
    ['receptionist', 'receptionist', 'demo1234'],
    ['gate_manager', 'amingatemanager@gmail.com', 'Gatemanager@123'],
    ['parent', 'parent', 'demo1234'],
  ]) {
    tokens[role] = await login(user, pw);
    if (tokens[role]) { pass++; console.log(`    ✓ login ${role}`); }
    else { fail++; failures.push(`login ${role}`); console.log(`    ✗ login ${role}`); }
  }

  const domains = [
    ['students',      'school_admin', [['/students', nonEmpty], ['/students/class-summary', isArr]]],
    ['academics',     'school_admin', [['/sessions', nonEmpty], ['/classes', nonEmpty], ['/holidays', isArr]]],
    ['attendance',    'school_admin', [['/attendance/dashboard', isObj], ['/attendance/reports/daily', isArr],
                                       ['/attendance/reports/monthly', nonEmpty], ['/attendance/reports/register?classKey=Nursery-A', isObj]]],
    ['exams',         'school_admin', [['/exams', nonEmpty]]],
    ['staff + HR',    'school_admin', [['/staff', nonEmpty], ['/staff/stats', isObj], ['/staff/attendance/report', isArr]]],
    ['payroll',       'accountant',   [['/payroll/stats', isObj], ['/payroll/advance-requests', isArr], ['/payroll/active-advances', isArr]]],
    ['fee',           'accountant',   [['/fee/heads', nonEmpty], ['/fee/structure', isObj], ['/fee/receipts', isObj],
                                       ['/fee/stats/today', isObj], ['/fee/ledger', nonEmpty]]],
    ['fee extras',    'accountant',   [['/fee/fine-rules', isArr], ['/fee/concessions', isArr], ['/fee/applied-fines', isArr]]],
    ['fee adjust',    'accountant',   [['/fee/waive-off/queue', nonEmpty], ['/fee/readjustments/history', nonEmpty],
                                       ['/fee/refund-requests', nonEmpty], ['/fee/reports/daily', isObj], ['/fee/reports/defaulters', isObj]]],
    ['finance',       'accountant',   [['/bank/accounts', isArr], ['/bank/deposits', isArr], ['/expenses/income', isArr],
                                       ['/expenses/vendor-payments', isArr]]],
    ['library',       'school_admin', [['/library/books', nonEmpty], ['/library/members', isArr], ['/library/dashboard', isObj]]],
    ['hostel',        'school_admin', [['/hostel/buildings', nonEmpty], ['/hostel/rooms', isArr]]],
    ['transport',     'school_admin', [['/transport/vehicles', nonEmpty], ['/transport/drivers', isArr], ['/transport/routes', isArr]]],
    ['inventory',     'school_admin', [['/inventory/items', nonEmpty], ['/inventory/vendors', isArr]]],
    ['communication', 'school_admin', [['/circulars', nonEmpty], ['/announcements', isArr], ['/notifications', isArr]]],
    ['reception',     'receptionist', [['/reception/dashboard', isObj], ['/reception/appointments', isArr], ['/reception/call-logs', isArr]]],
    ['coordinator',   'coordinator',  [['/coordinator/dashboard', isObj], ['/coordinator/student-leaves', nonEmpty],
                                       ['/coordinator/staff-leaves', isArr], ['/coordinator/staff-overview', nonEmpty]]],
    ['gate-manager',  'gate_manager', [['/gate-manager/dashboard', isObj], ['/gate-manager/students', nonEmpty],
                                       ['/gate-manager/visitors', isArr], ['/gate-manager/teacher-passes', isArr]]],
    ['teacher',       'teacher',      [['/teacher/my-classes', nonEmpty], ['/teacher/my-students', nonEmpty], ['/teacher/my-exams', isArr],
                                       ['/teacher/homework', nonEmpty], ['/teacher/assignments', nonEmpty],
                                       ['/teacher/circulars/received', isArr], ['/teacher/leave/balance', nonEmpty]]],
    ['super-admin',   'super_admin',  [['/super-admin/dashboard/stats', isObj], ['/super-admin/schools', isObj],
                                       ['/super-admin/schools/list', nonEmpty], ['/super-admin/dashboard/infrastructure', isObj],
                                       ['/super-admin/audit-logs', isArr], ['/super-admin/tickets/stats', isObj]]],
  ];

  for (const [name, role, checks] of domains) {
    console.log(`\n[${name}]  (as ${role})`);
    for (const [path, pred] of checks) await check(path, role, pred);
  }

  // ── Parent: ownership-scoped ──
  console.log('\n[parent]  (as parent — own children only)');
  const kids = await req('GET', '/parent/children', tokens.parent);
  if (kids.status === 200 && kids.body?.length) {
    pass++; console.log('    ✓ /parent/children');
    const id = kids.body[0].id;
    for (const p of [`/parent/fee-summary?childId=${id}`, `/parent/fee-monthly?childId=${id}`,
                     `/parent/attendance?childId=${id}`, '/parent/circulars']) {
      await check(p, 'parent', isObj);
    }
    const blocked = await req('GET', '/parent/fee-summary?childId=000000000000000000000000', tokens.parent);
    if (blocked.status === 404) { pass++; console.log('    ✓ blocked from another child (404)'); }
    else { fail++; failures.push('parent ownership gate'); console.log(`    ✗ ownership gate → ${blocked.status}`); }
  } else { fail++; failures.push('/parent/children'); console.log('    ✗ /parent/children'); }

  // ── Write path (proves persistence through the live stack) ──
  console.log('\n[write → read-back]');
  const before = (await req('GET', '/gate-manager/visitors', tokens.gate_manager)).body?.length ?? 0;
  const created = await req('POST', '/gate-manager/visitors', tokens.gate_manager,
    { name: 'Verify Bot', mobile: '9000000000', purpose: 'automated check', whomToMeet: 'Office', takingStudentHome: false });
  const after = (await req('GET', '/gate-manager/visitors', tokens.gate_manager)).body?.length ?? 0;
  if (created.status === 201 && after === before + 1) { pass++; console.log('    ✓ POST /gate-manager/visitors persisted'); }
  else { fail++; failures.push('write persistence'); console.log(`    ✗ write persistence (${created.status}, ${before}→${after})`); }

  // ── Security ──
  console.log('\n[security]');
  for (const [label, r] of [
    ['unauthenticated → 401', await req('GET', '/students')],
    ['wrong role → 403', await req('GET', '/teacher/my-classes', tokens.accountant)],
    ['bad credentials → 401', await req('POST', '/auth/login', undefined, { username: 'schooladmin', password: 'nope', captcha: 'x' })],
  ]) {
    const want = label.includes('403') ? 403 : 401;
    if (r.status === want) { pass++; console.log(`    ✓ ${label}`); }
    else { fail++; failures.push(label); console.log(`    ✗ ${label} → got ${r.status}`); }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${pass} passed, ${fail} failed  (${pass + fail} checks)`);
  if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log(`  - ${f}`)); }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('harness error:', e); process.exit(2); });
