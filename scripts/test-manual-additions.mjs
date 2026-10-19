import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import JSZip from "jszip";

// Fixed disposable environment. Never accepts a business URL or customer workbook.
const ackSmoke = process.argv.includes('--ack-smoke');
const base = ackSmoke ? "http://127.0.0.1:18081/api/v1" : "http://localhost:8180/api/v1";
const initialPassword = ackSmoke ? "SmokeInitial123!" : "E2eChangeMe123!";
const changedPassword = ackSmoke ? "SmokeChanged456!" : "E2eChanged456!";
const rootUsername = ackSmoke ? "smoke_admin" : "e2e_admin";
const suffix = Date.now();
const password = "ManualTest123!";
let assertions = 0;
async function request(session, method, path, body, expected = 200, headers = {}) {
  const multipart = body instanceof FormData;
  const response = await fetch(base + path, { method, headers: {
    ...(multipart ? {} : { "Content-Type": "application/json" }),
    ...(session?.cookie ? { Cookie: session.cookie } : {}),
    ...(session?.csrf ? { "X-CSRF-Token": session.csrf } : {}), ...headers,
  }, body: body == null ? undefined : multipart ? body : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
  assertions++;
  return { ...result, cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
async function login(username, secret) {
  const result = await request(null, "POST", "/admin/auth/login", { username, password: secret });
  return { cookie: result.cookie, csrf: result.data.csrfToken, identity: result.data };
}
let root;
for (const secret of [changedPassword, initialPassword]) {
  try { root = await login(rootUsername, secret); break; } catch { /* fresh or previously tested stack */ }
}
assert.ok(root, "Requires the isolated administrator");
if (root.identity.mustChangePassword) {
  await request(root, "POST", "/admin/auth/change-password", { currentPassword: initialPassword, newPassword: changedPassword });
}

async function workbook(rows) {
  const zip = new JSZip();
  const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  zip.file("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="合成测试数据" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/worksheets/sheet1.xml", `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, i) => `<row r="${i + 1}">${row.map(value => `<c t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`);
  return new Blob([await zip.generateAsync({ type: "uint8array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

async function fixture(label, untyped = false) {
  const username = `manual_${label}_${suffix}`;
  await request(root, "POST", "/admin/departments", { name: `手动新增验收${label}${suffix}`, username, password });
  const session = await login(username, password);
  const config = { name: `手动新增验收${label}`, timezone: "Asia/Shanghai", customerScope: "ALL",
    startsAt: new Date(Date.now() + 600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString(),
    eventEndsAt: new Date(Date.now() + 10800000).toISOString(), companyRankingTopN: 20, branchRankingTopN: 20, tonDisplayScale: 3 };
  let activity = (await request(session, "POST", "/admin/activities", config)).data;
  const path = `/admin/activities/${activity.id}`;
  for (const [kind, rows] of [
    ["PRODUCT", [["客户类型", "是否返利", "产品大类", "项目组", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否为标品礼盒", "分公司定制品", "产品说明"],
      ["", "", "", "", "MANUALSEED", "手动新增种子商品", "", "", "", "", "", "100", "10", "否", "", ""]]],
    ["WHITELIST", [["客户类型", "大区", "分公司名称", "经销商名称（简）", "经销商名称（全）", "经销商姓名", "经销商电话", "分公司确认人姓名", "分公司确认人电话"],
      [untyped ? "" : "综合客户", "", "测试分公司", "种子客户", `合成种子客户${label}${suffix}`, "测试人", "13900000500", "", ""]]],
  ]) {
    const form = new FormData();
    form.set("importType", kind); form.set("file", await workbook(rows), "synthetic-manual-test.xlsx");
    const task = (await request(session, "POST", `${path}/imports`, form, 201)).data;
    assert.equal(task.errorCount, 0, JSON.stringify(task));
    await request(session, "POST", `${path}/imports/${task.id}/confirm`, null, 202);
    let completed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = (await request(session, "GET", `${path}/imports/${task.id}`)).data;
      assert.notEqual(current.status, "FAILED", JSON.stringify(current));
      if (current.status === "COMPLETED") { completed = true; break; }
      await delay(200);
    }
    assert.ok(completed, "Import must complete");
  }
  const customer = (type, number, extra = {}) => ({ customerType: type, branchName: "测试分公司", dealerShortName: `合成${number}`,
    dealerFullName: `合成手动客户${label}${suffix}${number}`, phone: `13900000${String(number).padStart(3, "0")}`, reason: "隔离新增测试", ...extra });
  const product = extra => ({ customerType: "ALL", rebateStatus: "ALL", materialCode: `MANUAL${suffix}`, materialName: `合成手动商品${suffix}`,
    casePrice: 100, tonCaseFactor: 10, reason: "隔离新增测试", ...extra });
  const total = async () => (await request(session, "GET", `${path}/customers?size=200`)).page.totalElements;
  const initialCount = await total();
  const general = (await request(session, "POST", `${path}/customers`, customer(untyped ? "ALL" : "GENERAL", 501))).data;
  assert.ok(general.id > 0); assert.ok(general.excelSequence > 0); assert.equal(general.lockVersion, 0);
  assert.equal(general.phone, "13900000501"); assert.equal(general.regionCode ?? null, null);
  assert.equal(await total(), initialCount + 1);
  const duplicate = await request(session, "POST", `${path}/customers`, customer(untyped ? "ALL" : "GENERAL", 502, { phone: general.phone }), 409);
  assert.equal(duplicate.code, "CUSTOMER_EXISTS"); assert.equal(await total(), initialCount + 1);
  await request(session, "POST", `${path}/customers`, customer(untyped ? "ALL" : "GENERAL", 503, { dealerFullName: general.dealerFullName }), 409);
  // The failed insert's master identity must roll back, and a corrected retry must work.
  await request(session, "POST", `${path}/customers`, customer(untyped ? "ALL" : "GENERAL", 502));
  if (!untyped) {
    const special = (await request(session, "POST", `${path}/customers`, customer("SPECIAL", 504, { phone: general.phone }))).data;
    assert.equal(special.phone, general.phone); assert.notEqual(special.id, general.id);
  }
  const createdProduct = (await request(session, "POST", `${path}/products`, product({}))).data;
  assert.ok(createdProduct.id > 0); assert.equal(createdProduct.version, 0);
  await request(session, "POST", `${path}/products`, product({}), 409);
  const tiered = (await request(session, "POST", `${path}/products`, product({ materialCode: `TIER${suffix}`, materialName: `合成阶梯商品${suffix}`,
    priceTierMinQuantity: 10, priceTierCasePrice: 90, priceTierPricingMode: "INCREMENTAL", branchScope: "测试分公司",
    dealerScope: [{ branchName: "测试分公司", customerIds: [general.id] }] }))).data;
  assert.equal(tiered.priceTier.pricingMode, "INCREMENTAL"); assert.equal(tiered.branchScope.length, 1);
  const attendee = { participantName: "合成参会人", dealerName: general.dealerFullName, branchName: "测试分公司", participantType: untyped ? "" : "综合经销商", phone: general.phone };
  const matched = (await request(session, "POST", `${path}/attendees`, attendee)).data;
  assert.equal(matched.activityCustomerId, general.id); assert.equal(matched.matchStatus, "MATCHED");
  const unmatched = (await request(session, "POST", `${path}/attendees`, { ...attendee, dealerName: "不存在的合成经销商" })).data;
  assert.equal(unmatched.matchStatus, "UNMATCHED");
  await request(session, "POST", `${path}/customers`, customer(untyped ? "ALL" : "GENERAL", 507,
    { dealerShortName: general.dealerFullName }));
  const pending = (await request(session, "POST", `${path}/attendees`, attendee)).data;
  assert.equal(pending.matchStatus, "PENDING_CONFIRMATION");
  assert.equal(pending.activityCustomerId ?? null, null);
  activity = (await request(session, "GET", path)).data;
  const activeConfig = { ...config, startsAt: new Date(Date.now() + 5000).toISOString() };
  activity = (await request(session, "PUT", path, activeConfig, 200, { "If-Match": String(activity.version) })).data;
  activity = (await request(session, "POST", `${path}/publish`, null, 200, { "If-Match": String(activity.version) })).data;
  await request(session, "POST", `${path}/customers`, customer(untyped ? "ALL" : "GENERAL", 505), 409);
  await request(session, "POST", `${path}/products`, product({ materialName: "待开始禁止新增" }), 409);
  await delay(6000);
  await request(session, "POST", `${path}/customers`, customer(untyped ? "ALL" : "GENERAL", 505, { reason: "" }), 400);
  const activeCustomer = (await request(session, "POST", `${path}/customers`, customer(untyped ? "ALL" : "GENERAL", 505))).data;
  const verify = await request(null, "POST", `/public/activities/${activity.code}/verify-phone`, { customerType: untyped ? "ALL" : "GENERAL", phone: activeCustomer.phone });
  assert.equal(verify.data.customer.customerId, activeCustomer.id);
  await request(session, "POST", `${path}/products`, product({ materialCode: `ACTIVE${suffix}`, materialName: "订货中新增合成商品" }));
  await request(session, "POST", `${path}/attendees`, { ...attendee, dealerName: activeCustomer.dealerFullName, phone: activeCustomer.phone });
  // A different activity must never expose these records.
  const other = (await request(session, "POST", "/admin/activities", { ...config, name: "新增数据隔离校验" })).data;
  assert.equal((await request(session, "GET", `/admin/activities/${other.id}/customers?size=200`)).data.length, 0);
  assert.equal((await request(session, "GET", `/admin/activities/${other.id}/products`)).data.length, 0);
  assert.equal((await request(session, "GET", `/admin/activities/${other.id}/attendees`)).data.length, 0);
  console.log(`PASS ${label}: customer/product/attendance creation, validation, H5 and activity isolation`);
  return { session, activity: (await request(session, "GET", path)).data, path, customer, product, attendee, username, password };
}

const typed = await fixture("typed");
const untyped = await fixture("untyped", true);
const closed = (await request(untyped.session, "POST", `${untyped.path}/close`, { reason: "隔离只读校验" }, 200, { "If-Match": String(untyped.activity.version) })).data;
assert.equal(closed.status, "CLOSED");
await request(untyped.session, "POST", `${untyped.path}/customers`, untyped.customer("ALL", 506), 409);
await request(untyped.session, "POST", `${untyped.path}/products`, untyped.product({}), 409);
await request(untyped.session, "POST", `${untyped.path}/attendees`, untyped.attendee, 409);
const output = new URL(ackSmoke ? "../outputs/ack-manual-additions/" : "../outputs/manual-additions/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("fixtures.json", output), JSON.stringify({ activity: typed.activity, username: typed.username, password: typed.password }, null, 2));
console.log(`PASS manual additions: ${assertions} API status assertions plus identity, persistence and rejection checks`);
