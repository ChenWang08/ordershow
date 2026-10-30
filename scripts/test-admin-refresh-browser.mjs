import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Real admin components, synthetic HTTP fixtures only. No business credentials or backend.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../outputs/admin-manual-refresh/", import.meta.url);
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: false, plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_ACTIVITY_CODE": JSON.stringify("ADMIN_REFRESH_TEST"), "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
  server: { host: "127.0.0.1", port: 4186, strictPort: true },
  cacheDir: fileURLToPath(new URL("../work/admin-refresh-vite", import.meta.url)) });
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const requests = [], errors = [], unexpected = [];
    let rankingFailure = false, detailFailure = false, identityFailure = false;
    const activity = { id: 987, code: "ADMIN_REFRESH_TEST", name: "手动刷新测试活动", status: "DRAFT", version: 1,
      startsAt: "2099-01-01T00:00:00Z", endsAt: "2099-01-02T00:00:00Z", eventEndsAt: "2099-01-03T00:00:00Z",
      departmentId: 1, departmentName: "测试部门", regions: [], companyRankingTopN: 90, branchRankingTopN: 30 };
    const identity = { id: 1, username: "fixture", displayName: "合成测试管理员", roleCode: "DEPARTMENT_ADMIN", departmentId: 1, departmentName: "测试部门", mustChangePassword: false, csrfToken: "fixture" };
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:4186") { unexpected.push(url.href); return route.abort(); }
      if (!url.pathname.startsWith("/api/v1/")) return route.continue();
      const path = url.pathname.slice("/api/v1".length);
      requests.push(path);
      const reply = (data, status = 200) => route.fulfill({ status, json: { data } });
      if (request.method() !== "GET") { unexpected.push(`${request.method()} ${path}`); return route.fulfill({ status: 500, json: { message: "Unexpected write" } }); }
      if (path === "/admin/me") return identityFailure ? route.fulfill({ status: 503, json: { message: "服务繁忙" } }) : reply(identity);
      if (path === "/admin/activities") return reply([activity]);
      if (path === "/admin/activities/987") return detailFailure ? route.fulfill({ status: 503, json: { message: "服务繁忙" } }) : reply(activity);
      if (path.endsWith("/overview")) return rankingFailure ? route.fulfill({ status: 503, json: { message: "统计繁忙" } }) : reply({
        totals: { order_count: 10, total_amount: 12345, total_quantity: 120, total_tons: 2.5 },
        submittedByType: { GENERAL: 8, SPECIAL: 2 }, customerCount: 20,
        customersByType: { GENERAL: 15, SPECIAL: 5 }, customerTypeMode: "TYPED" });
      if (path.endsWith("/module-context")) return reply({ customerCount: 20, customersByType: { GENERAL: 15, SPECIAL: 5 }, customerTypeMode: "TYPED", attendeeCount: 4, whitelistPublished: true });
      if (/\/(customers|attendees|orders|order-change-requests\/page)$/.test(path)) return route.fulfill({ json: { data: [], page: { totalPages: 1, totalElements: 0 } } });
      if (path.endsWith("/product-dealer-scopes")) return reply({});
      if (/\/(products|product-image-reviews|imports|audit-logs|lottery\/rules|order-change-requests\/pending)$/.test(path)) return reply([]);
      unexpected.push(path); return route.fulfill({ status: 500, json: { message: "Unexpected fixture request" } });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.install();
    await page.goto("http://127.0.0.1:4186/tests/fixtures/admin-refresh.html");
    await page.getByRole("button", { name: "刷新统计", exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    const count = suffix => requests.filter(path => path.endsWith(suffix)).length;
    assert.equal(count("/ranking"), 0);
    assert.equal(count("/overview"), 0);
    assert.equal(count("/module-context"), 0);
    assert.ok((await page.locator(".admin-stats").innerText()).includes("尚未加载"));
    let before = requests.length;
    await page.clock.fastForward(65_000); await page.waitForTimeout(100);
    assert.equal(requests.length, before, "idle admin must not send periodic requests");
    await page.screenshot({ path: fileURLToPath(new URL(`empty-${width}.png`, output)), fullPage: true });
    await page.getByRole("button", { name: "刷新统计", exact: true }).click();
    await page.getByText("¥12,345.00", { exact: true }).waitFor();
    assert.equal(count("/overview"), 1); assert.equal(count("/ranking"), 0); assert.equal(count("/module-context"), 0);
    const nav = page.getByRole("navigation", { name: "后台导航" });
    await nav.getByRole("button", { name: /白名单/ }).click();
    await page.getByRole("button", { name: "刷新基础信息" }).waitFor();
    await page.waitForLoadState("networkidle");
    assert.equal(count("/module-context"), 1);
    await nav.getByRole("button", { name: /活动概览/ }).click();
    await page.getByText("¥12,345.00", { exact: true }).waitFor();
    assert.equal(count("/overview"), 1, "returning to overview must reuse the snapshot");
    assert.equal(count("/ranking"), 0);
    rankingFailure = true;
    await page.getByRole("button", { name: "刷新统计", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "统计刷新失败" }).waitFor();
    assert.ok(await page.getByText("¥12,345.00", { exact: true }).isVisible());
    rankingFailure = false;
    const name = page.getByPlaceholder("例如：2026 年中秋订货会");
    await name.fill("尚未保存的名称");
    let dialogCount = 0;
    const dismiss = async dialog => { dialogCount++; await dialog.dismiss(); };
    page.on("dialog", dismiss);
    before = count("/987");
    await page.getByRole("button", { name: "刷新活动信息", exact: true }).click();
    assert.equal(dialogCount, 1); assert.equal(count("/987"), before);
    assert.equal(await name.inputValue(), "尚未保存的名称");
    page.off("dialog", dismiss); page.on("dialog", dialog => dialog.accept());
    detailFailure = true;
    await page.getByRole("button", { name: "刷新活动信息", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "活动信息刷新失败" }).waitFor();
    assert.equal(await name.inputValue(), "尚未保存的名称");
    detailFailure = false;
    await page.getByRole("button", { name: "刷新活动信息", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[placeholder="例如：2026 年中秋订货会"]')?.value === "手动刷新测试活动");
    await nav.getByRole("button", { name: /订单管理/ }).click();
    await page.getByRole("button", { name: "订单列表", exact: true }).waitFor();
    assert.equal(count("/order-change-requests/page"), 0);
    const reviewLoaded = page.waitForResponse(response => response.url().includes("/order-change-requests/page"));
    await page.getByRole("button", { name: /变更审核/ }).click();
    await page.getByRole("heading", { name: "订单变更审核" }).waitFor();
    await reviewLoaded;
    await page.getByRole("button", { name: "刷新", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll("button")).find(button => button.textContent === "刷新")?.disabled);
    assert.equal(count("/order-change-requests/page"), 1);
    before = requests.length;
    await page.clock.fastForward(65_000); await page.waitForTimeout(100);
    assert.equal(requests.length, before);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.waitForLoadState("networkidle");
    assert.equal(count("/order-change-requests/page"), 2);
    identityFailure = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForLoadState("networkidle");
    assert.ok(await nav.isVisible(), "503 must preserve the authenticated workspace");
    identityFailure = false;
    await nav.getByRole("button", { name: /活动概览/ }).click();
    await page.screenshot({ path: fileURLToPath(new URL(`loaded-${width}.png`, output)), fullPage: true });
    await page.reload();
    await page.getByRole("button", { name: "刷新统计", exact: true }).waitFor();
    assert.ok((await page.locator(".admin-stats").innerText()).includes("尚未加载"));
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log(`PASS ${width}px: idle 65s, manual statistics, module entry, review refresh, dirty drafts, 503 recovery, reload reset`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); }
