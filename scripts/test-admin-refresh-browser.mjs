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
  server: { host: "127.0.0.1", port: 4186, strictPort: true, hmr: false, forwardConsole: false },
  cacheDir: fileURLToPath(new URL("../work/admin-refresh-vite", import.meta.url)) });
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_EXECUTABLE ? { executablePath: process.env.ORDER_SHOW_BROWSER_EXECUTABLE } : {}) });
  for (const width of [1440, 440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const requests = [], requestUrls = [], finishedRequests = [], errors = [], unexpected = [];
    let rankingFailure = false, detailFailure = false, identityFailure = false, productFailure = false;
    let productPrice = 100, productName = "测试商品";
    const activity = { id: 987, code: "ADMIN_REFRESH_TEST", name: "手动刷新测试活动", status: "DRAFT", version: 1,
      startsAt: "2099-01-01T00:00:00Z", endsAt: "2099-01-02T00:00:00Z", eventEndsAt: "2099-01-03T00:00:00Z",
      departmentId: 1, departmentName: "测试部门", regions: [], companyRankingTopN: 90, branchRankingTopN: 30 };
    const identity = { id: 1, username: "fixture", displayName: "合成测试管理员", roleCode: "SUPER_ADMIN", departmentId: 1, departmentName: "测试部门", mustChangePassword: false, csrfToken: "fixture" };
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:4186") { unexpected.push(url.href); return route.abort(); }
      // Activity switching navigates to the real admin path; serve the same fixture entry there.
      if (url.pathname === "/admin" && request.isNavigationRequest()) {
        return route.fulfill({ response: await route.fetch({ url: "http://127.0.0.1:4186/tests/fixtures/admin-refresh.html" }) });
      }
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
      if (path === "/admin/activities/987" && request.method() === "PUT") {
        return reply({ ...activity, ...request.postDataJSON(), version: activity.version + 1 });
      }
      if (request.method() !== "GET") { unexpected.push(`${request.method()} ${path}`); return route.fulfill({ status: 500, json: { message: "Unexpected write" } }); }
      if (path === "/admin/me") return identityFailure ? route.fulfill({ status: 503, json: { message: "服务繁忙" } }) : reply(identity);
      if (path === "/admin/activities") return reply([activity, { ...activity, id: 988, code: "SECOND", name: "另一个活动" }]);
      if (path === "/admin/departments") return reply([{ id: 1, name: "测试部门", code: "DEFAULT", status: "ACTIVE", activityCount: 1 }]);
      if (path === "/admin/users" || path === "/admin/members") return reply([]);
      if (path === "/admin/activities/987") return detailFailure ? route.fulfill({ status: 503, json: { message: "服务繁忙" } }) : reply(activity);
      if (path === "/admin/activities/988") return reply({ ...activity, id: 988, code: "SECOND", name: "另一个活动" });
      if (path.endsWith("/overview")) return rankingFailure ? route.fulfill({ status: 503, json: { message: "统计繁忙" } }) : reply({
        totals: { order_count: 10, total_amount: 12345, total_quantity: 120, total_tons: 2.5 },
        submittedByType: { GENERAL: 8, SPECIAL: 2 }, customerCount: 20,
        customersByType: { GENERAL: 15, SPECIAL: 5 }, customerTypeMode: "TYPED" });
      if (path.endsWith("/module-context")) return reply({ customerCount: 20, customersByType: { GENERAL: 15, SPECIAL: 5 }, customerTypeMode: "TYPED", attendeeCount: 4, whitelistPublished: true });
      if (/\/(customers|attendees|orders|order-change-requests\/page)$/.test(path)) return route.fulfill({ json: { data: [], page: { totalPages: 1, totalElements: 0 } } });
      if (path.endsWith("/product-dealer-scopes")) return reply({});
      if (path.endsWith("/products")) return productFailure ? route.fulfill({ status: 503, json: { message: "商品暂时无法读取" } }) : reply([1, 2].map(id => ({ id, materialName: `${productName}${id}`, materialCode: `SKU${id}`, images: [], sortNo: id, customerType: "GENERAL", rebateStatus: "YES", casePrice: productPrice, tonConversionFactor: 50, version: 1, status: "ACTIVE" })));
      if (path.endsWith("/lottery/statistics")) return reply({ validWinnerRecords: 0, validWinnerCustomers: 0, invalidatedWinnerRecords: 0 });
      if (/\/(products|product-image-reviews|imports|audit-logs|lottery\/rules|order-change-requests\/pending)$/.test(path)) return reply([]);
      unexpected.push(path); return route.fulfill({ status: 500, json: { message: "Unexpected fixture request" } });
    });
    const page = await context.newPage();
    page.on("requestfinished", request => finishedRequests.push(new URL(request.url()).pathname));
    page.on("pageerror", error => {
      const detail = error.stack || error.message;
      if (!errors.includes(detail)) errors.push(detail);
    });
    const dialogs = [];
    page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.clock.install();
    await page.goto("http://127.0.0.1:4186/tests/fixtures/admin-refresh.html");
    await page.getByRole("button", { name: "刷新统计", exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    const count = suffix => requests.filter(path => path.endsWith(suffix)).length;
    const assertRequestCount = async (suffix, expected, message) => {
      const deadline = Date.now() + 10_000;
      while (count(suffix) < expected && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(count(suffix), expected, message);
    };
    await assertRequestCount("/ranking", 0);
    await assertRequestCount("/overview", 0);
    await assertRequestCount("/module-context", 0);
    for (const suffix of ["/products", "/product-image-reviews", "/customers", "/attendees", "/imports", "/orders", "/lottery/rules", "/audit-logs", "/members", "/departments", "/users"]) {
      assert.equal(count(suffix), 0, `unopened module must not read ${suffix}`);
    }
    assert.equal(finishedRequests.filter(path => path === "/api/v1/admin/activities").length, 1,
      "activity summaries are shared with the switcher; StrictMode aborts the discarded initial read");
    assert.ok(requestUrls.includes("/admin/activities?summary=true"));
    await assertRequestCount("/987", 1, "overview cards reuse the selected activity detail");
    assert.ok((await page.locator(".admin-stats").innerText()).includes("尚未加载"));
    await page.getByText("尚未加载统计，请点击刷新统计", { exact: true }).waitFor();
    let before = requests.length;
    await page.clock.fastForward(65_000); await page.waitForTimeout(100);
    assert.equal(requests.length, before, "idle admin must not send periodic requests");
    await page.screenshot({ path: fileURLToPath(new URL(`empty-${width}.png`, output)), fullPage: true });
    const settingsSaved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/admin/activities/987" && response.request().method() === "PUT");
    await page.getByRole("button", { name: "保存活动设置", exact: true }).click();
    await settingsSaved;
    await page.getByRole("status").filter({ hasText: "活动名称和时间配置已保存" }).waitFor();
    await page.waitForLoadState("networkidle");
    await assertRequestCount("/overview", 0, "saving activity settings does not load statistics");
    await page.getByRole("button", { name: "刷新统计", exact: true }).click();
    await page.getByText("¥12,345.00", { exact: true }).waitFor();
    await assertRequestCount("/overview", 1); await assertRequestCount("/ranking", 0); await assertRequestCount("/module-context", 0);
    const nav = page.getByRole("navigation", { name: "后台导航" });
    await nav.getByRole("button", { name: /白名单/ }).click();
    await page.getByRole("heading", { name: "客户白名单导入", exact: true }).waitFor();
    await page.waitForLoadState("networkidle");
    await assertRequestCount("/module-context", 1);
    await assertRequestCount("/products", 0); await assertRequestCount("/attendees", 0);
    assert.ok(requestUrls.includes("/admin/activities/987/imports?importType=WHITELIST"));
    const whitelistReads = count("/customers");
    await nav.getByRole("button", { name: /商品导入/ }).click();
    const productSearch = page.getByRole("searchbox", { name: "搜索物料代码或物料名称" });
    await productSearch.waitFor(); await page.waitForLoadState("networkidle");
    await assertRequestCount("/products", 1); await assertRequestCount("/product-image-reviews", 1);
    await assertRequestCount("/product-dealer-scopes", 1);
    await assertRequestCount("/customers", whitelistReads); await assertRequestCount("/attendees", 0);
    assert.ok(requestUrls.includes("/admin/activities/987/imports?importType=PRODUCT"));
    await productSearch.fill("SKU1");
    await nav.getByRole("button", { name: /白名单/ }).click(); await page.waitForLoadState("networkidle");
    await assertRequestCount("/customers", whitelistReads + 1);
    productPrice = 125.5; productName = "最新商品";
    await nav.getByRole("button", { name: /商品导入/ }).click(); await productSearch.waitFor();
    await page.waitForLoadState("networkidle");
    assert.equal(await productSearch.inputValue(), "SKU1"); await assertRequestCount("/products", 2);
    await page.getByText("最新商品1", { exact: true }).waitFor();
    assert.ok((await page.locator(".product-import-table").innerText()).includes("125.5"));
    await page.screenshot({ path: fileURLToPath(new URL(`products-${width}.png`, output)), fullPage: true });
    productFailure = true;
    await nav.getByRole("button", { name: /白名单/ }).click(); await page.waitForLoadState("networkidle");
    await nav.getByRole("button", { name: /商品导入/ }).click(); await page.waitForLoadState("networkidle");
    const productError = page.getByRole("alert").filter({ hasText: "当前页面加载失败" });
    await productError.waitFor();
    assert.ok(await page.getByText("最新商品1", { exact: true }).isVisible());
    productFailure = false;
    await productError.getByRole("button", { name: "重试", exact: true }).click(); await page.waitForLoadState("networkidle");
    assert.equal(await productError.count(), 0);
    const attendanceLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/attendees"));
    await nav.getByRole("button", { name: /现场到场/ }).click(); await attendanceLoaded; await page.waitForLoadState("networkidle");
    await assertRequestCount("/attendees", 1); assert.ok(requestUrls.includes("/admin/activities/987/imports?importType=ATTENDANCE"));
    await nav.getByRole("button", { name: /抽奖规则/ }).click();
    await page.getByRole("heading", { name: "抽奖规则工作台", exact: true }).waitFor(); await page.waitForLoadState("networkidle");
    await page.clock.fastForward(65_000); await page.waitForLoadState("networkidle");
    await assertRequestCount("/lottery/statistics", 1); await assertRequestCount("/lottery/candidates/preview", 0);
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
    await assertRequestCount("/lottery/candidates/preview", 0);
    await page.getByRole("button", { name: "手动试算", exact: true }).click();
    await page.getByRole("button", { name: "查看候选名单", exact: true }).waitFor({ state: "visible" });
    await page.waitForLoadState("networkidle");
    await assertRequestCount("/lottery/candidates/preview", 1);
    await page.getByRole("button", { name: "查看候选名单", exact: true }).click();
    await page.getByText("抽奖合成客户", { exact: true }).waitFor();
    assert.ok((await page.locator(".candidate-drawer").innerText()).includes("0.000001 吨"));
    assert.ok((await page.locator(".candidate-drawer").innerText()).includes("抽取权重占比"));
    await page.screenshot({ path: fileURLToPath(new URL(`lottery-candidates-${width}.png`, output)), fullPage: true });
    await assertRequestCount("/lottery/candidates/preview", 1);
    await page.locator(".candidate-drawer").getByRole("button", { name: "关闭", exact: true }).click();
    await page.screenshot({ path: fileURLToPath(new URL(`lottery-${width}.png`, output)), fullPage: true });
    assert.equal(await page.getByRole("button", { name: "刷新中奖统计", exact: true }).count(), 0);
    await assertRequestCount("/lottery/rules", 1); await assertRequestCount("/lottery/statistics", 1);
    const candidateReads = count("/lottery/candidates/preview"); assert.ok(candidateReads >= 1);
    await nav.getByRole("button", { name: /活动概览/ }).click();
    await page.clock.fastForward(2000); await page.waitForLoadState("networkidle");
    await assertRequestCount("/lottery/candidates/preview", candidateReads);
    await nav.getByRole("button", { name: /抽奖规则/ }).click(); await page.waitForLoadState("networkidle");
    await assertRequestCount("/lottery/rules", 1, "unsaved rule edits survive module navigation"); await assertRequestCount("/lottery/statistics", 2);
    assert.equal(await page.getByLabel("最低订货吨数", { exact: true }).inputValue(), "0.5");
    await assertRequestCount("/lottery/candidates/preview", candidateReads);
    const membersLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/admin/members"));
    await nav.getByRole("button", { name: /成员管理/ }).click(); await membersLoaded; await page.waitForLoadState("networkidle");
    await assertRequestCount("/members", 1); await assertRequestCount("/departments", 1); await assertRequestCount("/users", 0);
    const accountsLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/admin/users"));
    await nav.getByRole("button", { name: /部门与账号/ }).click(); await accountsLoaded; await page.waitForLoadState("networkidle");
    await assertRequestCount("/users", 1); const departmentReads = count("/departments");
    await nav.getByRole("button", { name: /成员管理/ }).click(); await page.waitForLoadState("networkidle");
    await assertRequestCount("/members", 2); await assertRequestCount("/departments", departmentReads + 1);
    const logsButton = page.getByRole("button", { name: /^操作日志/ });
    const logsLoaded = page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/audit-logs"));
    await logsButton.click(); await logsLoaded; await page.waitForLoadState("networkidle"); await assertRequestCount("/audit-logs", 1);
    await logsButton.click(); await logsButton.click(); await page.waitForLoadState("networkidle");
    await assertRequestCount("/audit-logs", 2); await logsButton.click();
    const overviewReads = count("/overview");
    await nav.getByRole("button", { name: /活动概览/ }).click();
    await page.getByText("¥12,345.00", { exact: true }).waitFor(); await page.waitForLoadState("networkidle");
    await assertRequestCount("/overview", overviewReads, "returning to overview retains the manual snapshot without a read");
    await assertRequestCount("/ranking", 0);
    rankingFailure = true;
    await page.getByRole("button", { name: "刷新统计", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "统计刷新失败" }).waitFor();
    assert.ok(await page.getByText("¥12,345.00", { exact: true }).isVisible());
    rankingFailure = false;
    const name = page.getByPlaceholder("例如：2026 年中秋订货会");
    await name.fill("尚未保存的名称");
    detailFailure = true;
    await nav.getByRole("button", { name: /白名单/ }).click(); await page.waitForLoadState("networkidle");
    const detailError = page.getByRole("alert").filter({ hasText: "活动信息加载失败" });
    await detailError.waitFor(); detailFailure = false;
    await detailError.getByRole("button", { name: "重试", exact: true }).click(); await page.waitForLoadState("networkidle");
    await nav.getByRole("button", { name: /活动概览/ }).click(); await page.waitForLoadState("networkidle");
    assert.equal(await name.inputValue(), "尚未保存的名称");
    await assertRequestCount("/overview", overviewReads + 1, "activity information retry must not refresh statistics");
    assert.deepEqual(dialogs, [], "automatic reads preserve drafts without prompts");
    await page.clock.resume();
    const waitForOrders = async expected => {
      const deadline = Date.now() + 10_000;
      while (count("/orders") < expected && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await assertRequestCount("/orders", expected, JSON.stringify({ errors, recentRequests: requestUrls.slice(-12) }));
      await page.getByRole("button", { name: "刷新订单", exact: true }).click({ trial: true });
    };
    await nav.getByRole("button", { name: /订单管理/ }).click();
    await page.getByRole("button", { name: "订单列表", exact: true }).waitFor();
    await waitForOrders(5);
    await assertRequestCount("/order-change-requests/page", 0);
    await page.getByRole("button", { name: "刷新订单", exact: true }).click();
    await waitForOrders(10);
    await nav.getByRole("button", { name: /白名单/ }).click(); await page.waitForLoadState("networkidle");
    await nav.getByRole("button", { name: /订单管理/ }).click();
    await waitForOrders(15);
    const reviewLoaded = page.waitForResponse(response => response.url().includes("/order-change-requests/page"));
    await page.getByRole("button", { name: /变更审核/ }).click();
    await page.getByRole("heading", { name: "订单变更审核" }).waitFor();
    await reviewLoaded;
    await page.getByRole("button", { name: "刷新审核", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => !Array.from(document.querySelectorAll("button")).find(button => button.textContent === "刷新审核")?.disabled);
    await assertRequestCount("/order-change-requests/page", 1);
    before = requests.length;
    await page.clock.fastForward(65_000); await page.waitForTimeout(100);
    assert.equal(requests.length, before);
    await page.getByRole("button", { name: "刷新审核", exact: true }).click();
    await page.waitForLoadState("networkidle");
    await assertRequestCount("/order-change-requests/page", 2);
    await page.getByRole("button", { name: "订单列表", exact: true }).click(); await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: /变更审核/ }).click(); await page.waitForLoadState("networkidle");
    await assertRequestCount("/order-change-requests/page", 3);
    identityFailure = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForLoadState("networkidle");
    assert.ok(await nav.isVisible(), "503 must preserve the authenticated workspace");
    identityFailure = false;
    await nav.getByRole("button", { name: /活动概览/ }).click();
    await page.screenshot({ path: fileURLToPath(new URL(`loaded-${width}.png`, output)), fullPage: true });
    for (const label of ["刷新活动信息", "刷新当前模块", "刷新基础信息", "刷新中奖统计", "更新商品选项"]) {
      assert.equal(await page.getByRole("button", { name: label, exact: true, includeHidden: true }).count(), 0, label);
    }
    await page.reload();
    await page.getByRole("button", { name: "刷新统计", exact: true }).waitFor();
    await page.getByText("尚未加载统计，请点击刷新统计", { exact: true }).waitFor(); await page.waitForLoadState("networkidle");
    await assertRequestCount("/overview", overviewReads + 1, "reload clears the snapshot without reading statistics");
    assert.equal(await page.getByText("¥12,345.00", { exact: true }).count(), 0);
    assert.equal(await name.inputValue(), "手动刷新测试活动", "reload discards unsaved settings");
    await name.fill("切换活动时放弃的内容");
    await page.locator(".activity-switcher > button").click();
    await page.locator(".activity-switcher-menu button").filter({ hasText: "另一个活动" }).click();
    await page.waitForLoadState("networkidle");
    assert.equal(await name.inputValue(), "另一个活动");
    await page.getByText("尚未加载统计，请点击刷新统计", { exact: true }).waitFor();
    await assertRequestCount("/overview", overviewReads + 1, "switching activities does not read statistics");
    await page.getByRole("button", { name: "刷新统计", exact: true }).click();
    await page.getByText("¥12,345.00", { exact: true }).waitFor();
    assert.equal(requests.at(-1), "/admin/activities/988/overview", "manual statistics use only the selected activity");
    await assertRequestCount("/overview", overviewReads + 2);
    assert.deepEqual(dialogs, [], "reload and activity switch must not prompt");

    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log(`PASS ${width}px: manual-only overview, no statistics on entry/return/reload/activity switch, module reentry reads, latest prices, three refresh controls, current-round manual preview, draft preservation, no exit prompt, idle 65s, 503 retry`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); }
