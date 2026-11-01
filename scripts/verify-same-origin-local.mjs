import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Read-only checks: no real orders, imports, reviews or account changes.
const base = process.env.ORDER_SHOW_BASE || "http://localhost:3000";
const code = process.env.ORDER_SHOW_ACTIVITY_CODE || "HD20261101013";
const api = `${base}/api/v1`;
const activityPath = `/public/activities/${encodeURIComponent(code)}`;
const first = await fetch(`${api}${activityPath}`);
assert.equal(first.status, 200);
const activity = (await first.json()).data;
assert.equal(activity.code, code);
assert(first.headers.get("etag"));
const conditional = await fetch(`${api}${activityPath}`, { headers: { "If-None-Match": first.headers.get("etag") } });
assert.equal(conditional.status, 304);
assert.equal((await conditional.arrayBuffer()).byteLength, 0);

const imagePath = "/public/files/37/thumbnail?v=1";
const image = await fetch(`${api}${imagePath}`);
assert.equal(image.status, 200);
assert.match(image.headers.get("cache-control"), /max-age=2592000.*immutable/);
const imageBytes = Buffer.from(await image.arrayBuffer());
const directImage = await fetch(`http://localhost:8080/api/v1${imagePath}`);
assert.equal(directImage.status, 200);
assert.equal(createHash("sha256").update(imageBytes).digest("hex"),
  createHash("sha256").update(Buffer.from(await directImage.arrayBuffer())).digest("hex"));
const image304 = await fetch(`${api}${imagePath}`, { headers: { "If-None-Match": image.headers.get("etag") } });
assert.equal(image304.status, 304);
const protectedRead = await fetch(`${api}/admin/me`);
assert.equal(protectedRead.status, 401, "The entry must preserve backend authentication");

const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
const errors = [], requests = [], pages = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.route("**/api/v1/**", route => ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
    ? route.continue() : route.abort());
  for (const [index, path] of [`/h5/${code}`, `/screen/${code}/ranking`, `/screen/${code}/dashboard`, "/admin"].entries()) {
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", event => {
      if (new URL(event.request.url).pathname.startsWith("/api/v1/")) {
        requests.push({ page: path, method: event.request.method, url: event.request.url, type: event.type });
      }
    });
    if (index === 0) await page.clock.install();
    const activityResponse = path === "/admin" ? null
      : page.waitForResponse(response => response.url() === `${api}${activityPath}` && response.status() === 200);
    const screenPath = path.endsWith("/ranking") ? `/screen/activities/${code}/ranking/options`
      : path.endsWith("/dashboard") ? `/screen/activities/${code}/dashboard` : null;
    const screenResponse = screenPath ? page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1${screenPath}`) : null;
    assert.equal((await page.goto(`${base}${path}`)).status(), 200);
    if (activityResponse) await activityResponse;
    if (screenResponse) assert.equal((await screenResponse).status(), 200);
    if (index === 0) {
      const nextCheck = page.waitForResponse(response => response.url() === `${api}${activityPath}` && response.status() === 304);
      await page.clock.fastForward(35_000);
      await nextCheck;
      const cached = await page.evaluate(async path => {
        const image = new Image();
        const loaded = new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error("Image failed to load"));
        });
        image.src = path; document.body.append(image); await loaded;
        return { width: image.naturalWidth, height: image.naturalHeight };
      }, `/api/v1${imagePath}`);
      assert(Math.max(cached.width, cached.height) <= 320);
    }
    if (path === "/admin") await page.getByRole("heading", { name: "管理后台登录", exact: true }).waitFor();
    pages.push(path);
    await page.close();
  }
  assert(requests.length > 0);
  assert(requests.every(request => new URL(request.url).origin === new URL(base).origin), "All browser APIs and images must use the page origin");
  assert.equal(requests.filter(request => request.method === "OPTIONS" || request.type === "Preflight").length, 0);
  assert.deepEqual(errors, []);
  await context.close();
} finally { await browser.close(); }

const report = { activity: { firstStatus: first.status, unchangedStatus: conditional.status },
  image: { status: image.status, unchangedStatus: image304.status, bytesUnchangedByProxy: true },
  unauthenticatedStatus: protectedRead.status, pages, browserRequestCount: requests.length,
  browserPreflights: 0, allBrowserRequestsSameOrigin: true, browserErrors: errors };
await mkdir("outputs/same-origin", { recursive: true });
await writeFile("outputs/same-origin/verification.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
