import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import JSZip from 'jszip';

// Fixed disposable test stack only. No configurable production URL or real customer files.
const base = 'http://localhost:8180/api/v1';
const suffix = Date.now();
const password = 'MemberTest123!';
const all = ['OVERVIEW', 'PRODUCT', 'WHITELIST', 'ATTENDANCE', 'ORDER', 'LOTTERY'];
let assertions = 0;
async function request(session, method, path, body, expected = 200, extra = {}) {
  const multipart = body instanceof FormData;
  const response = await fetch(base + path, { method, headers: {
    ...(multipart ? {} : { 'Content-Type': 'application/json' }),
    ...(session?.cookie ? { Cookie: session.cookie } : {}),
    ...(session?.csrf ? { 'X-CSRF-Token': session.csrf } : {}), ...extra,
  }, body: body == null ? undefined : multipart ? body : JSON.stringify(body) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 1000)}`); assertions++;
  return { data: data.data, body: data, cookie: response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
}
async function login(username, secret = password) {
  const result = await request(null, 'POST', '/admin/auth/login', { username, password: secret });
  return { cookie: result.cookie, csrf: result.data.csrfToken, identity: result.data };
}
let root;
for (const secret of ['E2eChanged456!', 'E2eChangeMe123!']) {
  try { root = await login('e2e_admin', secret); break; } catch { /* supports fresh and previously tested stack */ }
}
assert.ok(root, 'requires isolated bootstrap administrator');
if (root.identity.mustChangePassword) await request(root, 'POST', '/admin/auth/change-password', { currentPassword: 'E2eChangeMe123!', newPassword: 'E2eChanged456!' });

async function department(label) {
  const username = `member_manager_${label}_${suffix}`;
  const result = await request(root, 'POST', '/admin/departments', { name: `成员验收${label}${suffix}`, username, password });
  return { ...result.data, session: await login(username) };
}
const a = await department('A'), b = await department('B');
const activityBody = { name: '成员权限验收', timezone: 'Asia/Shanghai', customerScope: 'ALL',
  startsAt: new Date(Date.now() + 600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString(),
  eventEndsAt: new Date(Date.now() + 10800000).toISOString(), companyRankingTopN: 20, branchRankingTopN: 20, tonDisplayScale: 3 };
let activity = (await request(a.session, 'POST', '/admin/activities', activityBody)).data;
const other = (await request(b.session, 'POST', '/admin/activities', activityBody)).data;
const path = `/admin/activities/${activity.id}`;
let member = (await request(a.session, 'POST', '/admin/members', { username: `member_${suffix}`, displayName: '成员张三', password, permissions: [] })).data;
const actor = await login(member.username);
assert.equal(actor.identity.roleCode, 'DEPARTMENT_MEMBER');
assert.equal(actor.identity.mustChangePassword, false);
assert.deepEqual(actor.identity.permissions, []);
assert.equal(member.departmentId, a.id);
// A second member must be allowed under the same administrator.
await request(a.session, 'POST', '/admin/members', { username: `second_${suffix}`, displayName: '第二位成员', password, permissions: ['ORDER'] });
await request(a.session, 'POST', '/admin/members', { departmentId: b.id, username: `cross_${suffix}`, displayName: '越权', password }, 403);
await request(b.session, 'PATCH', `/admin/members/${member.id}`, { lockVersion: member.lockVersion, permissions: all }, 404);
await request(actor, 'GET', '/admin/members', null, 403);
await request(actor, 'POST', '/admin/auth/change-password', { currentPassword: password, newPassword: 'OtherPassword123!' }, 403);
await request(a.session, 'POST', '/admin/auth/change-password', { currentPassword: password, newPassword: 'OtherPassword123!' }, 403);
await request(root, 'POST', `/admin/departments/${a.id}/account`, { username: `duplicate_${suffix}`, password }, 409);

async function grant(permissions, additional = {}) {
  member = (await request(a.session, 'PATCH', `/admin/members/${member.id}`, { lockVersion: member.lockVersion, permissions, ...additional })).data;
  return member;
}
const modules = ['ranking', 'products', 'customers', 'attendees', 'orders', 'lottery/rules'];
for (let i = 0; i < all.length; i++) {
  await grant([all[i]]);
  // Same session sees grants immediately, without signing in again.
  assert.deepEqual((await request(actor, 'GET', '/admin/me')).data.permissions, [all[i]]);
  for (let j = 0; j < modules.length; j++) await request(actor, 'GET', `${path}/${modules[j]}`, null, i === j ? 200 : 403);
  await request(actor, 'GET', `/admin/activities/${other.id}/${modules[i]}`, null, 404);
}
await grant(all);
for (const endpoint of ['/admin/members', '/admin/users', '/admin/departments', `${path}/audit-logs`]) await request(actor, 'GET', endpoint, null, 403);
await request(actor, 'POST', '/admin/activities', activityBody, 403);
for (const operation of ['publish', 'withdraw-publication', 'close', 'finish']) await request(actor, 'POST', `${path}/${operation}`, { reason: '成员不能管理活动' }, 403, { 'If-Match': String(activity.version) });
await request(actor, 'PUT', path, activityBody, 403, { 'If-Match': String(activity.version) });
const visible = (await request(actor, 'GET', '/admin/activities')).data;
assert.ok(visible.some(row => row.id === activity.id));
assert.ok(visible.every(row => row.departmentId === a.id));

async function workbook(name, rows) {
  const zip = new JSZip();
  const xml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file('xl/workbook.xml', `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`);
  return new Blob([await zip.generateAsync({ type: 'uint8array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
async function upload(type, rows) {
  const form = new FormData(); form.set('importType', type); form.set('file', await workbook(type, rows), 'members-test.xlsx');
  const task = (await request(actor, 'POST', `${path}/imports`, form, 201)).data;
  assert.equal(task.errorCount, 0, JSON.stringify(task));
  return task;
}
await grant(['PRODUCT']);
const productTask = await upload('PRODUCT', [
  ['客户类型', '是否返利', '产品大类', '项目组', '物料代码', '物料名称', '品牌', '品种', '规格', '箱规', '元/瓶', '元/箱', '吨箱转换系数', '是否为标品礼盒', '分公司定制品', '产品说明'],
  ['综合', '是', '调味品', '酱油', 'MEMBER001', '成员权限测试商品', '测试', '原味', '500ml', '12瓶', '8', '100', '10', '否', '', '测试'],
]);
await grant(['WHITELIST']);
await request(actor, 'GET', `${path}/imports/${productTask.id}`, null, 403);
await request(actor, 'POST', `${path}/imports/${productTask.id}/confirm`, null, 403);
assert.ok((await request(actor, 'GET', `${path}/imports`)).data.every(task => task.importType === 'WHITELIST'));
await grant(['PRODUCT']);
async function confirm(task) {
  await request(actor, 'POST', `${path}/imports/${task.id}/confirm`, null, 202);
  for (let i = 0; i < 100; i++) {
    const current = (await request(actor, 'GET', `${path}/imports/${task.id}`)).data;
    if (current.status === 'COMPLETED') return;
    assert.notEqual(current.status, 'FAILED', JSON.stringify(current));
    await delay(200);
  }
  assert.fail('import did not publish');
}
await confirm(productTask);
await grant(['WHITELIST']);
const whitelistTask = await upload('WHITELIST', [
  ['客户类型', '大区', '分公司名称', '经销商名称（简）', '经销商名称（全）', '经销商姓名', '经销商电话', '分公司确认人姓名', '分公司确认人电话'],
  ['综合客户', '东区', '测试分公司', '成员测试客户', '成员权限测试经销商', '测试客户', '13900000123', '确认人', '13800000123'],
]);
await confirm(whitelistTask);
await grant(['ATTENDANCE']);
await request(actor, 'POST', `${path}/attendees`, { participantName: '测试客户', dealerName: '成员权限测试经销商', branchName: '测试分公司', phone: '13900000123' });
await grant(['LOTTERY']);
assert.equal((await request(actor, 'GET', `${path}/module-context`)).data.customerCount, 1);
await request(actor, 'GET', `${path}/customers`, null, 403);
await request(actor, 'GET', `${path}/attendees`, null, 403);

activity = (await request(a.session, 'GET', path)).data;
activity = (await request(a.session, 'PUT', path, { ...activityBody, startsAt: new Date(Date.now() + 5000).toISOString() }, 200, { 'If-Match': String(activity.version) })).data;
await request(a.session, 'POST', `${path}/publish`, null, 200, { 'If-Match': String(activity.version) });
await delay(6000);
await grant(['ORDER']);
const products = (await request(actor, 'GET', `${path}/orders/product-options`)).data;
const customers = (await request(actor, 'GET', `${path}/orders/customer-options?keyword=成员`)).data;
assert.equal(products.length, 1); assert.equal(customers.length, 1);
const writeHeaders = () => ({ 'Idempotency-Key': randomUUID() });
let order = (await request(actor, 'POST', `${path}/orders`, { activityCustomerId: customers[0].id, items: [{ productId: products[0].id, quantity: 2 }], reason: '成员代建订单验收' }, 200, writeHeaders())).data;
const originalIdentity = `成员张三（${member.username}）`;
assert.equal(order.versions[0].submittedByAdminName, originalIdentity);
assert.ok(order.operations.some(operation => operation.adminName === originalIdentity));
activity = (await request(actor, 'GET', path)).data;
const verified = await request(null, 'POST', `/public/activities/${activity.code}/verify-phone`, { customerType: 'GENERAL', regionCode: activity.regions[0].code, phone: '13900000123' });
const h5 = { cookie: verified.cookie, csrf: verified.data.csrfToken };
const change = (await request(h5, 'POST', `/h5/activities/${activity.code}/order-change-requests`, { expectedVersion: order.currentVersion, requestType: 'MODIFY', items: [{ productId: products[0].id, quantity: 1 }], customerNote: '成员审核测试' }, 200, writeHeaders())).data;
const approved = (await request(actor, 'POST', `${path}/order-change-requests/${change.id}/approve`, { reason: '成员审核通过' }, 200, writeHeaders())).data;
assert.equal(approved.reviewedByName, originalIdentity);
await grant(['ORDER'], { displayName: '成员张三已改名' });
assert.equal((await request(actor, 'GET', `${path}/order-change-requests/${change.id}`)).data.reviewedByName, originalIdentity);
order = (await request(actor, 'GET', `${path}/orders/${order.id}`)).data;
assert.ok(order.versions.some(version => version.submittedByAdminName === originalIdentity));
order = (await request(actor, 'POST', `${path}/orders/${order.id}/void`, { expectedVersion: order.currentVersion, expectedLockVersion: order.lockVersion, reason: '成员作废验收' }, 200, writeHeaders())).data;
assert.equal(order.status, 'VOIDED');
assert.ok(order.operations.some(operation => operation.adminName === `成员张三已改名（${member.username}）`));
const audit = (await request(a.session, 'GET', `${path}/audit-logs`)).data;
assert.ok(audit.some(entry => entry.actorName === originalIdentity && entry.actionCode === 'ORDER_CHANGE_APPROVED'));

await grant([]);
await request(actor, 'GET', `${path}/orders`, null, 403);
await request(actor, 'GET', `${path}/module-context`, null, 403);
await request(actor, 'POST', `${path}/orders/${order.id}/void`, { reason: '已收回权限' }, 403, writeHeaders());
await request(actor, 'GET', '/admin/me');
await grant(['ORDER'], { password: 'ResetMember456!' });
await request(actor, 'GET', '/admin/me', null, 401);
const resetActor = await login(member.username, 'ResetMember456!');
await grant(['ORDER'], { status: 'DISABLED' });
await request(resetActor, 'GET', '/admin/me', null, 401);
await request(null, 'POST', '/admin/auth/login', { username: member.username, password: 'ResetMember456!' }, 401);
await grant(['ORDER'], { status: 'ACTIVE' });
const reenabled = await login(member.username, 'ResetMember456!');
await request(reenabled, 'GET', `${path}/orders/${order.id}`);
// The other department has only a draft, so disabling it is permitted and must revoke every member.
const otherMember = (await request(b.session, 'POST', '/admin/members', { username: `b_member_${suffix}`, displayName: 'B成员', password, permissions: ['ORDER'] })).data;
const bActor = await login(otherMember.username);
await request(root, 'PATCH', `/admin/departments/${b.id}`, { status: 'DISABLED' });
await request(bActor, 'GET', '/admin/me', null, 401);
await request(b.session, 'GET', '/admin/me', null, 401);
console.log(`PASS: ${assertions} API assertions; six independent modules, imports, department isolation, lifecycle denial, order creation/approval/void identity snapshots, immediate revocation and password/session lifecycle.`);
