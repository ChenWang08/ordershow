import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Mount the real H5 in StrictMode; all API reads and writes use synthetic HTTP fixtures.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../outputs/h5-manual-refresh/", import.meta.url);
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: false, plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_ACTIVITY_CODE": JSON.stringify("PHONE-TEST"), "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
  server: { host: "127.0.0.1", port: 4188, strictPort: true },
  cacheDir: fileURLToPath(new URL("../outputs/h5-manual-refresh/vite-cache", import.meta.url)) });
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_PATH ? { executablePath: process.env.ORDER_SHOW_BROWSER_PATH } : {}) });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), calls = [], errors = [], unexpected = [];
    const item = quantity => ({ id: 1, productId: 1, materialName: "合成商品", productLine: "调味品", quantity, casePrice: 10, lineAmount: quantity * 10 });
    const makeOrder = (version, quantity) => ({ id: 101, activityId: 1, activityCustomerId: 1, orderNo: "SYNTHETIC-1",
      currentVersion: version, lockVersion: version, status: "SUBMITTED", items: [item(quantity)], totalAmount: quantity * 10,
      totalQuantity: quantity, operations: [], lastModifiedAt: "2026-10-30T01:00:00Z" });
    let formal = makeOrder(1, 10), failure = false, releaseRead, holdRead = false, draft = null;
    let application = { id: 501, orderId: 101, requestType: "MODIFY", status: "PENDING", baseVersion: 1, currentVersion: 1,
      originalOrder: formal, items: [item(5)], requestedTotalAmount: 50, requestedTotalQuantity: 5, requestedAt: "2026-10-30T01:00:00Z" };
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method();
      if (url.origin !== "http://127.0.0.1:4188") { unexpected.push(url.href); return route.abort(); }
      if (!url.pathname.startsWith("/api/v1/")) return route.continue();
      const path = url.pathname, body = req.postDataJSON(); calls.push({ path, method });
      let data;
      if (path.endsWith("/verify-phone")) data = { selectionRequired: false, csrfToken: "test", customer: {
        activityId: 1, activityCode: "PHONE-TEST", customerId: 1, customerType: "GENERAL", dealerFullName: "合成经销商", phoneMasked: "139****0001" } };
      else if (path.endsWith("/products")) data = [{ id: 1, materialName: "合成商品", casePrice: 10, images: [],
        customerType: "ALL", rebateStatus: "ALL", orderable: true, dataStatus: "VALID" }];
      else if (path.endsWith("/order") && method === "GET") {
        if (holdRead) await new Promise(resolve => { releaseRead = resolve; });
        if (failure) return route.fulfill({ status: 503, json: { code: "SERVICE_UNAVAILABLE", message: "合成服务繁忙" } });
        data = formal;
      } else if (path.endsWith("/order-change-requests/current")) data = application;
      else if (path.endsWith("/order-draft")) {
        if (method === "PUT") draft = { ...body, updatedAt: "2026-10-30T02:00:00Z" };
        if (method === "DELETE") draft = null;
        data = draft;
      } else { unexpected.push(`${method} ${path}`); return route.fulfill({ status: 500, json: { message: "Unexpected fixture request" } }); }
      return route.fulfill({ json: { data, traceId: "synthetic-h5-refresh" } });
    });
    await page.clock.install();
    await page.goto("http://127.0.0.1:4188/tests/fixtures/h5-phone-entry/index.html");
    await page.getByLabel("手机号", { exact: true }).fill("13900000001");
    await page.getByRole("button", { name: "验证并进入订货" }).click();
    await page.getByRole("heading", { name: "修改申请待审核" }).waitFor();
    const count = () => calls.filter(c => /\/(order|order-change-requests\/current)$/.test(c.path)).length;
    const loaded = count(); await page.clock.fastForward(65_000);
    assert.equal(count(), loaded, "A pending application must not poll");
    await page.screenshot({ path: fileURLToPath(new URL(`pending-${width}.png`, output)) });

    // Approval is discovered by the edit action, even without clicking refresh.
    formal = makeOrder(2, 5); application = { ...application, status: "APPROVED", currentVersion: 2 };
    await page.getByRole("button", { name: "继续修改订单", exact: true }).click();
    await page.getByLabel("合成商品订货箱数", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("合成商品订货箱数").inputValue(), "5");
    await page.locator(".order-header > button").click();
    await page.getByRole("heading", { name: "订货已成功提交" }).waitFor();

    // A direct admin edit is also checked, bypassing the ordinary refresh cooldown.
    formal = makeOrder(3, 8); application = null;
    assert.equal(await page.locator(".h5-order-refresh button").isDisabled(), true);
    await page.getByRole("button", { name: "修改订单", exact: true }).click();
    await page.getByLabel("合成商品订货箱数").waitFor();
    assert.equal(await page.getByLabel("合成商品订货箱数").inputValue(), "8");
    await page.getByLabel("合成商品订货箱数").fill("9");
    await page.getByLabel("合成商品订货箱数").blur();
    formal = makeOrder(4, 6); const editingCount = count();
    await page.clock.fastForward(65_000);
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    assert.equal(count(), editingCount, "Returning while editing must not replace the cart");
    assert.equal(await page.getByLabel("合成商品订货箱数").inputValue(), "9");

    // Entering details reads once; failure preserves V3 and the previous success time.
    failure = true; await page.locator(".order-header > button").click();
    await page.getByRole("alert").filter({ hasText: "刷新失败" }).waitFor();
    assert.match(await page.locator(".submitted-meta").innerText(), /V3/);
    const lastSuccess = await page.locator(".h5-order-refresh small").innerText();
    await page.clock.fastForward(15_000); failure = false; holdRead = true;
    const beforeShared = count(); await page.locator(".h5-order-refresh button").click();
    await page.getByRole("button", { name: "刷新中…", exact: true }).waitFor();
    await page.getByRole("button", { name: "修改订单", exact: true }).click();
    await page.getByRole("button", { name: "正在核对最新订单…", exact: true }).waitFor();
    assert.equal(count(), beforeShared + 1, "The edit action must join the in-flight order read");
    assert.equal(await page.locator(".h5-order-refresh small").innerText(), lastSuccess);
    holdRead = false; releaseRead();
    await page.getByLabel("合成商品订货箱数").waitFor();
    assert.equal(await page.getByLabel("合成商品订货箱数").inputValue(), "6");
    assert.equal(count(), beforeShared + 2); assert.match(await page.locator(".h5-draft-status").innerText(), /旧草稿未恢复/);
    await page.screenshot({ path: fileURLToPath(new URL(`latest-cart-${width}.png`, output)) });
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    await context.close();
  }
  console.log("PASS: 390px/1440px StrictMode H5; 65s idle, approval/direct edit preflight, cooldown bypass, shared reads, 503 preservation and stale draft handling. Synthetic HTTP only.");
} finally { if (browser) await browser.close(); await server.close(); }
