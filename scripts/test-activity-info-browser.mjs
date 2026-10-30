import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// A real EventSource and real React workspace; the HTTP server contains only synthetic test data.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../outputs/activity-info/", import.meta.url);
await mkdir(output, { recursive: true });
const peers = new Set(), calls = [];
let version = 1;
let activity = { id: 1, departmentId: 1, code: "ACTIVITY-TEST", name: "活动同步合成测试", status: "ACTIVE", configuredStatus: "ACTIVE",
  timezone: "Asia/Shanghai", startsAt: "2026-01-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z", eventEndsAt: "2099-01-02T00:00:00Z",
  whitelistCustomerTypeMode: "TYPED", availableCustomerTypes: ["GENERAL"], regions: [], companyRankingTopN: 90, branchRankingTopN: 30, version: 1 };
const frame = () => ({ activityId: 1, version: String(version), serverTime: new Date().toISOString(), heartbeatIntervalMs: 30_000, activity });
function send(event, data) { for (const peer of peers) peer.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function update(changes) { version++; activity = { ...activity, ...changes }; send("activity", frame()); }
const server = await createServer({ root, configFile: false, plugins: [react(), { name: "synthetic-activity-http", configureServer(vite) {
  vite.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith("/api/v1/")) return next();
    const path = req.url.split("?")[0]; calls.push({ path, method: req.method });
    if (path.endsWith("/events")) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
      peers.add(res); res.on("close", () => peers.delete(res));
      res.write(`event: activity\ndata: ${JSON.stringify(frame())}\n\n`); return;
    }
    res.setHeader("Content-Type", "application/json");
    let data;
    if (path.endsWith("/lottery")) { res.statusCode = 503; return res.end(JSON.stringify({ message: "合成抽奖接口失败" })); }
    if (path.endsWith("/verify-phone")) data = { selectionRequired: false, csrfToken: "test", customer: {
      activityId: 1, activityCode: "ACTIVITY-TEST", customerId: 1, customerType: "GENERAL", dealerFullName: "合成经销商", phoneMasked: "139****0001" } };
    else if (path.endsWith("/products")) data = [{ id: 1, materialName: "合成商品", casePrice: 10, images: [],
      customerType: "ALL", rebateStatus: "ALL", orderable: true, dataStatus: "VALID" }];
    else if (path.endsWith("/order") || path.endsWith("/order-draft")) data = null;
    else if (path.endsWith("/ranking")) data = { activityId: 1, status: "ACTIVE", totals: { total_amount: 0, total_quantity: 0, total_tons: 0, order_count: 0 },
      companies: [], branches: [], productLines: [], generatedAt: new Date().toISOString() };
    else { res.statusCode = 500; return res.end(JSON.stringify({ message: `Unexpected synthetic request: ${path}` })); }
    res.end(JSON.stringify({ data, traceId: "synthetic-activity-info" }));
  });
} }], define: { "process.env.NEXT_PUBLIC_ACTIVITY_CODE": JSON.stringify("ACTIVITY-TEST"), "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
server: { host: "127.0.0.1", port: 4189, strictPort: true }, cacheDir: fileURLToPath(new URL("vite-cache", output)) });
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_PATH ? { executablePath: process.env.ORDER_SHOW_BROWSER_PATH } : {}) });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), errors = [], unexpected = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin !== "http://127.0.0.1:4189") { unexpected.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const count = suffix => calls.filter(call => call.path.endsWith(suffix)).length;
    const dataReads = () => calls.filter(call => call.method === "GET" && !call.path.endsWith("/events")).length;
    const before = count("/events");
    await page.clock.install();
    await page.goto("http://127.0.0.1:4189/tests/fixtures/activity-info/index.html");
    await page.getByLabel("手机号", { exact: true }).fill("13900000001");
    assert.equal(count("/events"), before + 1, "StrictMode must establish one activity connection");
    await page.getByRole("button", { name: "验证并进入订货", exact: true }).click();
    const quantity = page.getByLabel("合成商品订货箱数", { exact: true });
    await quantity.fill("7"); await quantity.blur();
    const initial = dataReads();
    send("heartbeat", { heartbeatIntervalMs: 30_000 }); await page.clock.fastForward(65_000);
    assert.equal(dataReads(), initial, "Idle time and product changes must not query activity/order data");
    update({ name: "更新后的活动名称" });
    await page.getByText("更新后的活动名称", { exact: true }).first().waitFor({ state: "attached" });
    assert.equal(await quantity.inputValue(), "7"); assert.equal(dataReads(), initial);

    // The ranking's first load remains normal; subsequent activity messages cannot refresh statistics.
    await page.locator(".surface-tabs button").filter({ hasText: "订货排行" }).click();
    await page.getByRole("button", { name: /手动刷新/ }).waitFor();
    await page.waitForFunction(() => document.querySelector(".screen-refresh-controls")?.textContent?.includes("最近")
      || document.querySelector(".ranking-board")?.textContent?.includes("上次"));
    const rankingReads = count("/ranking");
    assert.equal(rankingReads, 1 + (width === 1440 ? 1 : 0));
    update({ status: "CLOSED", configuredStatus: "CLOSED" });
    update({ status: "ACTIVE", configuredStatus: "ACTIVE", endsAt: "2099-01-02T00:00:00Z" });
    send("invalidate", { eventType: "ORDER_SUBMITTED" });
    await page.clock.fastForward(1000);
    assert.equal(count("/ranking"), rankingReads);
    const expand = page.getByRole("button", { name: "展开顶部栏", exact: true });
    await expand.focus(); await expand.press("Enter");
    await page.locator(".surface-tabs button").filter({ hasText: "订货 H5" }).click();
    assert.equal(await quantity.inputValue(), "7");

    for (const peer of peers) peer.destroy();
    await page.getByRole("status").filter({ hasText: "活动信息正在重新同步" }).waitFor();
    assert.equal(await quantity.inputValue(), "7");
    const reconnect = count("/events");
    await page.clock.fastForward(2500);
    await page.waitForFunction(() => !document.querySelector(".activity-sync-status"));
    assert.equal(count("/events"), reconnect + 1);
    assert.equal(count("/ranking"), rankingReads); assert.equal(await quantity.inputValue(), "7");

    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    update({ name: "隐藏期间更新的活动" });
    const hidden = count("/events"); await page.clock.fastForward(120_000); assert.equal(count("/events"), hidden);
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); });
    await page.getByText("隐藏期间更新的活动", { exact: true }).first().waitFor({ state: "attached" });
    assert.equal(count("/events"), hidden + 1); assert.equal(await quantity.inputValue(), "7");
    assert.equal(calls.filter(call => call.path === "/api/v1/public/activities/ACTIVITY-TEST").length, 0);
    // The standalone phone shell is fixed to the viewport: the notice must be inside it, not behind it.
    await page.goto("http://127.0.0.1:4189/tests/fixtures/activity-info/index.html?standalone=1");
    await page.getByLabel("手机号", { exact: true }).fill("13900000001");
    await page.getByRole("button", { name: "验证并进入订货", exact: true }).click();
    await quantity.fill("7"); await quantity.blur();
    for (const peer of peers) peer.destroy();
    await page.locator(".phone-screen > .activity-sync-status").waitFor();
    assert.equal(await quantity.inputValue(), "7");
    await page.screenshot({ path: fileURLToPath(new URL(`activity-disconnected-${width}.png`, output)) });
    await page.clock.fastForward(2500);
    await page.waitForFunction(() => !document.querySelector(".activity-sync-status"));
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await page.screenshot({ path: fileURLToPath(new URL(`activity-stream-${width}.png`, output)) });
    await context.close();
  }
  console.log("PASS: 390px/1440px real EventSource and StrictMode workspace; independent initial snapshot, 65s idle, cart preservation, no statistics reload, disconnect/recovery and hidden-page resync. Synthetic HTTP only.");
} finally { if (browser) await browser.close(); for (const peer of peers) peer.destroy(); await server.close(); }
