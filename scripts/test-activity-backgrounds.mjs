import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import sharp from "sharp";

// Only the disposable test stack; never point this at a business environment.
const base = "http://localhost:8180/api/v1";
async function request(session, method, path, body, expected = 200) {
  const multipart = body instanceof FormData;
  const response = await fetch(base + path, { method, headers: {
    ...(multipart ? {} : { "Content-Type": "application/json" }),
    ...(session ? { Cookie: session.cookie, "X-CSRF-Token": session.csrf } : {}),
  }, body: body == null ? undefined : multipart ? body : JSON.stringify(body) });
  const text = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  return { data: json.data, cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") };
}
async function login(username, password) {
  const result = await request(null, "POST", "/admin/auth/login", { username, password });
  return { cookie: result.cookie, csrf: result.data.csrfToken, identity: result.data };
}
let root;
for (const password of ["E2eChanged456!", "E2eChangeMe123!"]) {
  try { root = await login("e2e_admin", password); break; } catch { /* fresh or previously tested stack */ }
}
assert.ok(root, "isolated test administrator must be available");
if (root.identity.mustChangePassword) {
  await request(root, "POST", "/admin/auth/change-password", { currentPassword: "E2eChangeMe123!", newPassword: "E2eChanged456!" });
  root = await login("e2e_admin", "E2eChanged456!");
}
const suffix = Date.now();
const credentials = { username: `bg_manager_${suffix}`, password: "BackgroundTest123!" };
await request(root, "POST", "/admin/departments", { name: `背景验收${suffix}`, ...credentials });
const manager = await login(credentials.username, credentials.password);
const input = { name: "活动背景验收", timezone: "Asia/Shanghai", customerScope: "ALL",
  startsAt: new Date(Date.now() + 600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString(),
  eventEndsAt: new Date(Date.now() + 10800000).toISOString(), companyRankingTopN: 20, branchRankingTopN: 20, tonDisplayScale: 3 };
const a = (await request(manager, "POST", "/admin/activities", input)).data;
const b = (await request(manager, "POST", "/admin/activities", input)).data;
const path = `/admin/activities/${a.id}`;
const png = await sharp({ create: { width: 750, height: 1500, channels: 3, background: "#14425a" } }).png().toBuffer();
const jpg = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: "#17334d" } }).jpeg().toBuffer();
const webp = await sharp(jpg).webp().toBuffer();
async function upload(kind, bytes, name, expected = 200, session = manager, activityPath = path) {
  const body = new FormData(); body.append("file", new Blob([bytes]), name);
  return (await request(session, "POST", `${activityPath}/backgrounds/${kind}`, body, expected)).data;
}
assert.equal(a.h5BackgroundUrl, undefined);
const h5 = await upload("h5", png, "h5.png");
assert.ok(h5.h5BackgroundUrl);
let desktop = await upload("desktop", jpg, "desktop.jpg");
assert.equal(desktop.h5BackgroundUrl, h5.h5BackgroundUrl);
assert.ok(desktop.desktopBackgroundUrl);
const publicView = (await request(null, "GET", `/public/activities/${a.code}`)).data;
assert.equal(publicView.desktopBackgroundUrl, desktop.desktopBackgroundUrl);
const file = await fetch(new URL(desktop.desktopBackgroundUrl, base));
assert.equal(file.status, 200);
assert.equal(file.headers.get("content-type"), "image/jpeg");
assert.deepEqual(Buffer.from(await file.arrayBuffer()), jpg);
assert.equal((await request(manager, "GET", `/admin/activities/${b.id}`)).data.desktopBackgroundUrl, undefined);
await upload("h5", Buffer.alloc(5 * 1024 * 1024 + 1), "large.png", 400);
await upload("desktop", Buffer.alloc(10 * 1024 * 1024 + 1), "large.jpg", 400);
await upload("h5", Buffer.from("<svg/>"), "disguised.png", 400);
await upload("h5", png, "wrong.gif", 400);
const replaced = await upload("desktop", webp, "desktop.webp");
assert.notEqual(replaced.desktopBackgroundUrl, desktop.desktopBackgroundUrl);
assert.equal((await fetch(new URL(desktop.desktopBackgroundUrl, base))).status, 404);
const reset = (await request(manager, "DELETE", `${path}/backgrounds/desktop`)).data;
assert.equal(reset.desktopBackgroundUrl, undefined);
assert.equal(reset.h5BackgroundUrl, h5.h5BackgroundUrl);
assert.equal((await fetch(new URL(replaced.desktopBackgroundUrl, base))).status, 404);
desktop = await upload("desktop", jpg, "desktop.jpg");
const outsiderCredentials = { username: `bg_outsider_${suffix}`, password: "BackgroundTest123!" };
await request(root, "POST", "/admin/departments", { name: `背景隔离${suffix}`, ...outsiderCredentials });
const outsider = await login(outsiderCredentials.username, outsiderCredentials.password);
await upload("h5", png, "h5.png", 404, outsider);
const memberCredentials = { username: `bg_member_${suffix}`, password: "BackgroundTest123!" };
await request(manager, "POST", "/admin/members", { ...memberCredentials, displayName: "背景测试成员", permissions: ["OVERVIEW"] });
const member = await login(memberCredentials.username, memberCredentials.password);
await upload("h5", png, "h5.png", 403, member);
writeFileSync("work/background-e2e-result.json", JSON.stringify({ activityCode: a.code, activityId: a.id, otherCode: b.code, ...credentials }, null, 2));
console.log("PASS: JPG/PNG/WebP upload, public image bytes, independent activities, replacement/reset, size/type rejection and department/member permissions.");
console.log(`Preview activity: ${a.code}`);
