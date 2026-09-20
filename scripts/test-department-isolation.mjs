import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Fixed disposable environment: never connect this test to business ports/databases.
const base = 'http://localhost:8180/api/v1';
const password = 'IsolationTest123!';
const suffix = Date.now();
async function request(session, method, path, body) {
  const response = await fetch(base + path, { method, headers: {
    'Content-Type': 'application/json', ...(session?.cookie ? { Cookie: session.cookie } : {}),
    ...(session?.csrf ? { 'X-CSRF-Token': session.csrf } : {}),
  }, body: body == null ? undefined : JSON.stringify(body) });
  const data = await response.json();
  return { status: response.status, data: data.data, cookie: response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
}
async function login(username, secret) {
  const result = await request(null, 'POST', '/admin/auth/login', { username, password: secret });
  assert.equal(result.status, 200, 'login must succeed');
  return { cookie: result.cookie, csrf: result.data.csrfToken, identity: result.data };
}
let root;
for (const secret of ['E2eChangeMe123!', 'E2eChanged456!']) {
  try { root = await login('e2e_admin', secret); break; } catch {}
}
assert.ok(root, 'isolated bootstrap login');
if (root.identity.mustChangePassword) assert.equal((await request(root, 'POST', '/admin/auth/change-password', {
  currentPassword: 'E2eChangeMe123!', newPassword: 'E2eChanged456!',
})).status, 200);
const departments = [];
for (const label of ['A', 'B']) {
  const username = `isolation_${label}_${suffix}`;
  const created = await request(root, 'POST', '/admin/departments', { name: `Isolation ${label} ${suffix}`, username, password });
  assert.equal(created.status, 200);
  const session = await login(username, password);
  assert.equal(session.identity.mustChangePassword, false);
  assert.deepEqual((await request(session, 'GET', '/admin/activities')).data, []);
  departments.push({ ...created.data, session });
}
const [a, b] = departments;
const startsAt = new Date(Date.now() + 86400000).toISOString();
const body = { name: 'Isolation activity', startsAt, endsAt: new Date(Date.now() + 172800000).toISOString(),
  eventEndsAt: new Date(Date.now() + 180000000).toISOString(), timezone: 'Asia/Shanghai', customerScope: 'ALL', companyRankingTopN: 20, branchRankingTopN: 20, tonDisplayScale: 3 };
const created = await request(root, 'POST', '/admin/activities', { ...body, departmentId: a.id });
assert.equal(created.status, 200);
const id = created.data.id;
assert.ok((await request(a.session, 'GET', '/admin/activities')).data.some(v => v.id === id));
for (const path of ['', '/ranking', '/products', '/customers', '/orders', '/lottery/rules', '/audit-logs']) {
  assert.equal((await request(b.session, 'GET', `/admin/activities/${id}${path}`)).status, 404, `cross department ${path}`);
}
assert.equal((await request(a.session, 'GET', `/admin/activities/${id}/ranking`)).status, 200);
// Mark only the activity created above as historical in the disposable test DB.
assert.ok(Number.isSafeInteger(id));
execFileSync('docker', ['compose', '--project-name', 'order-show-e2e', '--file', 'docker-compose.test.yml',
  'exec', '-T', '-e', 'MYSQL_PWD=e2e_mysql_only_not_for_business', 'mysql-test', 'mysql', '-uorder_show_e2e', 'order_show_e2e',
  '-e', `UPDATE activity SET status='FINISHED', finished_at=UTC_TIMESTAMP(3) WHERE id=${id}`], { stdio: 'pipe' });
assert.ok((await request(a.session, 'GET', '/admin/activities')).data.some(v => v.id === id && v.status === 'FINISHED'));
assert.equal((await request(a.session, 'GET', `/admin/activities/${id}`)).status, 200);
assert.equal((await request(b.session, 'GET', `/admin/activities/${id}`)).status, 404);
assert.ok((await request(root, 'GET', '/admin/activities')).data.some(v => v.id === id));
assert.equal((await request(b.session, 'POST', '/admin/activities', { ...body, departmentId: a.id })).status, 403);
assert.equal((await request(b.session, 'POST', '/admin/activities', body)).data.departmentId, b.id);
console.log('PASS: empty departments, administrator-assigned activities, own history, cross-department reads/writes and authenticated statistics');
