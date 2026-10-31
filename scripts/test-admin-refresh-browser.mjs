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
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_EXECUTABLE ? { executablePath: process.env.ORDER_SHOW_BROWSER_EXECUTABLE } : {}) });
  for (const width of [1440, 440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const requests = [], requestUrls = [], finishedRequests = [], errors = [], unexpected = [];
    let rankingFailure = false, detailFailure = false, identityFailure = false;
    const activity = { id: 987, code: "ADMIN_REFRESH_TEST", name: "手动刷新测试活动", status: "DRAFT", version: 1,
      startsAt: "2099-01-01T00:00:00Z", endsAt: "2099-01-02T00:00:00Z", eventEndsAt: "2099-01-03T00:00:00Z",
      departmentId: 1, departmentName: "测试部门", regions: [], companyRankingTopN: 90, branchRankingTopN: 30 };
    const identity = { id: 1, username: "fixture", displayName: "合成测试管理员", roleCode: "SUPER_ADMIN", departmentId: 1, departmentName: "测试部门", mustChangePassword: false, csrfToken: "fixture" };
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:4186") { unexpected.push(url.href); return route.abort(); }
      if (!url.pathname.startsWith("/api/v1/")) return route.continue();
      const path = url.pathname.slice("/api/v1".length);
      requests.push(path);
      requestUrls.push(path + url.search);
      const reply = (data, status = 200) => route.fulfill({ status, json: { data } });
      if (path.endsWith("/lottery/candidates/preview") && request.method() === "POST") {
        const input=request.postDataJSON();assert.equal(input.probabilityMode,"ORDER_TONS_WEIGHTED");assert.equal(input.qualificationMetric,"TONS");assert.equal(input.minimumOrderTons,0.5);
        return reply({ candidateCount: 20, configuredWinnerCount: 10, actualWinnerCount: 10, unawardedCount: 0, totalCandidateOrderAmount: 2000, weightMetric:"TONS",totalCandidateWeight:2,
          candidates: [{ activityCustomerId: 1, dealerFullName: "抽奖合成客户", customerType: "GENERAL",qualifyingOrderTons:0.000001,probabilityPercent:0.00005 }] });
      }
      if (path.endsWith("/lottery/product-options")) return reply([{ productLine: "食用油", varietyName: "花生油" }, { productLine: "食用油", varietyName: "玉米油" }, { productLine: "大米", varietyName: "长粒米" }]);
      if (request.method() !== "GET") { unexpected.push(`${request.method()} ${path}`); return route.fulfill({ status: 500, json: { message: "Unexpected write" } }); }
      if (path === "/admin/me") return identityFailure ? route.fulfill({ status: 503, json: { message: "服务繁忙" } }) : reply(identity);
      if (path === "/admin/activities") return reply([activity]);
      if (path === "/admin/departments") return reply([{ id: 1, name: "测试部门", code: "DEFAULT", status: "ACTIVE", activityCount: 1 }]);
      if (path === "/admin/users" || path === "/admin/members") return reply([]);
      if (path === "/admin/activities/987") return detailFailure ? route.fulfill({ status: 503, json: { message: "服务繁忙" } }) : reply(activity);
      if (path.endsWith("/overview")) return rankingFailure ? route.fulfill({ status: 503, json: { message: "统计繁忙" } }) : reply({
        totals: { order_count: 10, total_amount: 12345, total_quantity: 120, total_tons: 2.5 },
        submittedByType: { GENERAL: 8, SPECIAL: 2 }, customerCount: 20,
        customersByType: { GENERAL: 15, SPECIAL: 5 }, customerTypeMode: "TYPED" });
      if (path.endsWith("/module-context")) return reply({ customerCount: 20, customersByType: { GENERAL: 15, SPECIAL: 5 }, customerTypeMode: "TYPED", attendeeCount: 4, whitelistPublished: true });
      if (/\/(customers|attendees|orders|order-change-requests\/page)$/.test(path)) return route.fulfill({ json: { data: [], page: { totalPages: 1, totalElements: 0 } } });
      if (path.endsWith("/product-dealer-scopes")) return reply({});
      if (path.endsWith("/products")) return reply([1, 2].map(id => ({ id, materialName: `测试商品${id}`, materialCode: `SKU${id}`, images: [], sortNo: id, customerType: "GENERAL", rebateStatus: "YES", casePrice: 100, tonConversionFactor: 50, version: 1, status: "ACTIVE" })));
      if (path.endsWith("/lottery/statistics")) return reply({ validWinnerRecords: 0, validWinnerCustomers: 0, invalidatedWinnerRecords: 0 });
      if (/\/(products|product-image-reviews|imports|audit-logs|lottery\/rules|order-change-requests\/pending)$/.test(path)) return reply([]);
      unexpected.push(path); return route.fulfill({ status: 500, json: { message: "Unexpected fixture request" } });
    });
    const page = await context.newPage();
    page.on("requestfinished", request => finishedRequests.push(new URL(request.url()).pathname));
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.install();
    await page.goto("http://127.0.0.1:4186/tests/fixtures/admin-refresh.html");
    await page.getByRole("button", { name: "刷新统计", exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    const count = suffix => requests.filter(path => path.endsWith(suffix)).length;
    assert.equal(count("/ranking"), 0);
    assert.equal(count("/overview"), 0);
    assert.equal(count("/module-context"), 0);
    for (const suffix of ["/products", "/product-image-reviews", "/customers", "/attendees", "/imports", "/orders", "/lottery/rules", "/audit-logs", "/members", "/departments", "/users"]) {
      assert.equal(count(suffix), 0, `unopened module must not read ${suffix}`);
    }
    assert.equal(finishedRequests.filter(path => path === "/api/v1/admin/activities").length, 1,
      "activity summaries are shared with the switcher; StrictMode aborts the discarded initial read");
    assert.ok(requestUrls.includes("/admin/activities?summary=true"));
    assert.equal(count("/987"), 1, "overview cards reuse the selected activity detail");
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
    assert.equal(count("/products"), 0); assert.equal(count("/attendees"), 0);
    assert.ok(requestUrls.includes("/admin/activities/987/imports?importType=WHITELIST"));
    const whitelistReads = count("/customers");
    await nav.getByRole("button", { name: /商品导入/ }).click();
    const productSearch = page.getByRole("searchbox", { name: "搜索物料代码或物料名称" });
    await productSearch.waitFor(); await page.waitForLoadState("networkidle");
    assert.equal(count("/products"), 1); assert.equal(count("/product-image-reviews"), 1);
    assert.equal(count("/product-dealer-scopes"), 1);
    assert.equal(count("/customers"), whitelistReads); assert.equal(count("/attendees"), 0);
    assert.ok(requestUrls.includes("/admin/activities/987/imports?importType=PRODUCT"));
    await productSearch.fill("SKU1");
    await nav.getByRole("button", { name: /白名单/ }).click(); await page.waitForLoadState("networkidle");
    assert.equal(count("/customers"), whitelistReads);
    await nav.getByRole("button", { name: /商品导入/ }).click(); await productSearch.waitFor();
    assert.equal(await productSearch.inputValue(), "SKU1"); assert.equal(count("/products"), 1);
    const moduleDialogs = [];
    const unexpectedDialog = async dialog => { moduleDialogs.push(dialog.message()); await dialog.dismiss(); };
    page.on("dialog", unexpectedDialog);
    const refreshedProducts = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/products"), { timeout: 5000 });
    await page.getByRole("button", { name: "刷新当前模块", exact: true }).click();
    page.off("dialog", unexpectedDialog); assert.deepEqual(moduleDialogs, [], "a loaded module has no unsaved changes");
    await refreshedProducts;
    await page.waitForLoadState("networkidle");
    assert.equal(count("/products"), 2); assert.equal(count("/customers"), whitelistReads);
    assert.equal(await productSearch.inputValue(), "SKU1");
    const attendanceLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/attendees"));
    await nav.getByRole("button", { name: /现场到场/ }).click(); await attendanceLoaded; await page.waitForLoadState("networkidle");
    assert.equal(count("/attendees"), 1); assert.ok(requestUrls.includes("/admin/activities/987/imports?importType=ATTENDANCE"));
    await nav.getByRole("button", { name: /抽奖规则/ }).click();
    await page.getByRole("heading", { name: "抽奖规则工作台", exact: true }).waitFor(); await page.waitForLoadState("networkidle");
    await page.clock.fastForward(65_000); await page.waitForLoadState("networkidle");
    assert.equal(count("/lottery/statistics"), 0); assert.equal(count("/lottery/candidates/preview"), 0);
    await page.getByRole("button", { name: "有效下单客户", exact: false }).click();
    await page.getByLabel("抽奖项目组").selectOption("value:食用油");
    await page.locator(".lottery-varieties summary").click();
    assert.equal(await page.locator(".lottery-varieties").getByText("长粒米", { exact: true }).count(), 0);
    await page.locator(".lottery-varieties").getByLabel("花生油", { exact: true }).check();
    await page.locator(".lottery-varieties summary").click();
    for(const [mode,metric] of [["ORDER_BOX_COUNT_WEIGHTED","BOX_COUNT"],["ORDER_AMOUNT_WEIGHTED","AMOUNT"],["ORDER_TONS_WEIGHTED","TONS"]]) {
      await page.getByLabel("抽取方式",{exact:true}).selectOption(mode);
      assert.equal(await page.getByLabel("门槛依据",{exact:true}).inputValue(),metric);
      assert.equal(await page.getByLabel("门槛依据",{exact:true}).isDisabled(),true);
      assert.equal(count("/lottery/candidates/preview"),0);
    }
    await page.getByLabel("最低订货吨数", { exact: true }).fill("0.5");
    assert.equal(count("/lottery/candidates/preview"), 0);
    await page.getByRole("button", { name: "手动试算", exact: true }).click();
    await page.getByRole("button", { name: "查看候选名单", exact: true }).waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle");
    assert.equal(count("/lottery/candidates/preview"), 1);
    await page.getByRole("button", { name: "查看候选名单", exact: true }).click();
    await page.getByText("抽奖合成客户", { exact: true }).waitFor();
    assert.ok((await page.locator(".candidate-drawer").innerText()).includes("0.000001 吨"));
    assert.ok((await page.locator(".candidate-drawer").innerText()).includes("抽取权重占比"));
    await page.screenshot({ path: fileURLToPath(new URL(`lottery-candidates-${width}.png`, output)), fullPage: true });
    assert.equal(count("/lottery/candidates/preview"), 1);
    await page.locator(".candidate-drawer").getByRole("button", { name: "关闭", exact: true }).click();
    await page.screenshot({ path: fileURLToPath(new URL(`lottery-${width}.png`, output)), fullPage: true });
    await page.getByRole("button", { name: "刷新中奖统计", exact: true }).click(); await page.waitForLoadState("networkidle");
    assert.equal(count("/lottery/rules"), 1); assert.equal(count("/lottery/statistics"), 1);
    const candidateReads = count("/lottery/candidates/preview"); assert.ok(candidateReads >= 1);
    await nav.getByRole("button", { name: /活动概览/ }).click();
    await page.clock.fastForward(2000); await page.waitForLoadState("networkidle");
    assert.equal(count("/lottery/candidates/preview"), candidateReads);
    await nav.getByRole("button", { name: /抽奖规则/ }).click(); await page.waitForLoadState("networkidle");
    assert.equal(count("/lottery/rules"), 1); assert.equal(count("/lottery/statistics"), 1);
    assert.equal(count("/lottery/candidates/preview"), candidateReads);
    const membersLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/admin/members"));
    await nav.getByRole("button", { name: /成员管理/ }).click(); await membersLoaded; await page.waitForLoadState("networkidle");
    assert.equal(count("/members"), 1); assert.equal(count("/departments"), 1); assert.equal(count("/users"), 0);
    const accountsLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/admin/users"));
    await nav.getByRole("button", { name: /部门与账号/ }).click(); await accountsLoaded; await page.waitForLoadState("networkidle");
    assert.equal(count("/users"), 1); const departmentReads = count("/departments");
    await nav.getByRole("button", { name: /成员管理/ }).click(); await page.waitForLoadState("networkidle");
    assert.equal(count("/members"), 1); assert.equal(count("/departments"), departmentReads);
    const logsButton = page.getByRole("button", { name: "操作日志", exact: true });
    const logsLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/audit-logs"));
    await logsButton.click(); await logsLoaded; await page.waitForLoadState("networkidle"); assert.equal(count("/audit-logs"), 1);
    await logsButton.click(); await logsButton.click(); await page.waitForLoadState("networkidle");
    assert.equal(count("/audit-logs"), 1); await logsButton.click();
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
    console.log(`PASS ${width}px: lazy whole modules, retained filters, scoped imports, members/departments/logs, idle 65s, manual statistics, review refresh, dirty drafts, 503 recovery`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); }
