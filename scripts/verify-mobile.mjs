/** Live verification of the MOBILE app endpoints against the deployed API. */
const BASE = process.env.API || 'https://api.mysmartcampus.in/api';
let pass = 0, fail = 0;
const fails = [];

async function req(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch { /* */ }
  return { status: res.status, body: data };
}
async function login(identifier, password = 'demo1234') {
  const { body } = await req('POST', '/auth/login', undefined, { identifier, password, captcha: 'x' });
  return body?.tokens?.accessToken ?? '';
}
async function check(path, token, ok = (b) => b != null) {
  const r = await req('GET', path, token);
  const good = r.status === 200 && ok(r.body);
  if (good) { pass++; console.log(`    ✓ ${path}`); }
  else { fail++; fails.push(`${path} → ${r.status}`); console.log(`    ✗ ${path} → ${r.status}`); }
  return r.body;
}
const arr = (b) => Array.isArray(b);
const obj = (b) => b && typeof b === 'object';

async function main() {
  console.log(`\nMobile verify: ${BASE}\n${'='.repeat(56)}`);

  console.log('\n[auth] mobile login shapes');
  const par = await login('parent'), stu = await login('student'), tea = await login('teacher'),
        dri = await login('driver'), adm = await login('schooladmin');
  for (const [r, t] of [['parent', par], ['student', stu], ['teacher', tea], ['driver', dri], ['admin', adm]]) {
    if (t) { pass++; console.log(`    ✓ login ${r}`); } else { fail++; fails.push(`login ${r}`); console.log(`    ✗ login ${r}`); }
  }
  // parent-login (by mobile) + detect
  const pl = await req('POST', '/auth/parent-login', undefined, { identifier: '9990000001', password: 'demo1234' });
  if (pl.status === 200) { pass++; console.log('    ✓ parent-login by mobile'); } else { fail++; fails.push('parent-login'); console.log('    ✗ parent-login'); }

  console.log('\n[student]');
  await check('/student/me', stu, (b) => b.className === 'Class 1');
  await check('/student/dashboard-summary', stu, obj);
  await check('/student/assignments', stu, arr);
  await check('/student/notices', stu, arr);
  await check('/student/id-card', stu, (b) => String(b.qrValue).startsWith('MSC:'));
  await check('/student/library', stu, obj);

  console.log('\n[admin]');
  await check('/admin/dashboard', adm, (b) => obj(b.collections));
  await check('/admin/approvals', adm, arr);
  await check('/admin/fee-summary', adm, obj);
  await check('/admin/attendance-summary', adm, obj);

  console.log('\n[teacher]');
  await check('/teacher/teaching', tea, (b) => arr(b.classTeacher));
  await check('/teacher/roster?classSectionId=Class%201-A', tea, arr);
  await check('/teacher/dashboard', tea, obj);
  await check('/teacher/assessments?subjectId=Mathematics', tea, arr);
  await check('/teacher/performance?classSectionId=Class%201-A', tea, arr);

  console.log('\n[parent]');
  const kids = await check('/parent/app-children', par, (b) => b.length === 2);
  const cid = kids?.[0]?.id;
  await check(`/parent/dashboard-summary?childId=${cid}`, par, obj);
  await check(`/parent/app-attendance?childId=${cid}`, par, obj);
  await check(`/parent/exam/marks?childId=${cid}`, par, obj);
  await check(`/parent/fees/dues?childId=${cid}`, par, obj);
  await check(`/parent/outpass?childId=${cid}`, par, arr);
  await check(`/parent/messenger/conversations?childId=${cid}`, par, arr);
  await check(`/parent/rewards?childId=${cid}`, par, (b) => arr(b.entries));
  await check(`/parent/requests?childId=${cid}`, par, arr);

  console.log('\n[driver]');
  const a = await check('/driver/assignment', dri, (b) => arr(b.routes));
  await check('/driver/trips', dri, arr);
  await check('/driver/alerts', dri, arr);
  if (a?.routes?.[0]) {
    const rid = a.routes[0].id, tid = a.routes[0].trips[0].id;
    const start = await req('POST', '/driver/trip/start', dri, { routeId: rid, tripId: tid });
    const emit = await req('POST', '/driver/location/emit', dri, { tripId: tid, position: { lat: 30.35, lng: 76.39 }, tripType: 'pickup', updatedAt: Date.now() });
    const preview = await req('GET', `/driver/location/preview?routeId=${rid}`, dri);
    if (start.status === 200 && emit.body?.ok && preview.body?.tripStatus === 'active') { pass++; console.log('    ✓ trip start → GPS emit → preview (parity)'); }
    else { fail++; fails.push('driver GPS round-trip'); console.log('    ✗ driver GPS round-trip'); }
  }

  console.log('\n[security]');
  for (const [label, r] of [['unauth → 401', await req('GET', '/student/me')], ['wrong role → 403', await req('GET', '/driver/assignment', par)]]) {
    const want = label.includes('403') ? 403 : 401;
    if (r.status === want) { pass++; console.log(`    ✓ ${label}`); } else { fail++; fails.push(label); console.log(`    ✗ ${label} → ${r.status}`); }
  }

  console.log(`\n${'='.repeat(56)}\nMOBILE RESULT: ${pass} passed, ${fail} failed`);
  if (fails.length) { console.log('FAILURES:'); fails.forEach((f) => console.log(`  - ${f}`)); }
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error('harness error:', e); process.exit(2); });
