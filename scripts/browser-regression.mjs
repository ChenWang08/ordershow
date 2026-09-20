import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Run after the isolated Java E2E fixtures have been created. Never point at business services.
assert.equal(process.env.ORDER_SHOW_E2E, "order-show-e2e", "Only the isolated test stack is allowed");
const base = "http://localhost:3100";
const api = "http://localhost:8180/api/v1";
const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
const errors = [];
const track = (page) => page.on("pageerror", (error) => errors.push(error.message));
const output = new URL("../outputs/refactor-regression/", import.meta.url);
await mkdir(output, { recursive: true });

try {
  const admin = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await admin.newPage();
  track(page);
  await page.goto(`${base}/admin`);
  await page.getByLabel("用户名").fill("e2e_admin");
  await page.getByLabel("密码", { exact: true }).fill("E2eChanged456!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".admin-sidebar").getByRole("button", { name: /商品导入$/ }).waitFor();
  const response = await admin.request.get(`${api}/admin/activities`);
  assert.equal(response.status(), 200);
  const activities = (await response.json()).data;
  const activity = activities.filter((item) => item.status === "ACTIVE").sort((a, b) => b.id - a.id)[0];
  assert.ok(activity, "Java E2E must leave an active fixture");
  const customers = (await (await admin.request.get(`${api}/admin/activities/${activity.id}/customers?size=200`)).json()).data;
  const orders = (await (await admin.request.get(`${api}/admin/activities/${activity.id}/orders?size=200`)).json()).data;
  const usedNames = new Set(orders.map((order) => order.dealerFullName));
  const customer = customers.find((item) => item.customerType === "GENERAL" && !usedNames.has(item.dealerFullName));
  assert.ok(customer, "Use a fresh isolated fixture with a customer who has not ordered");
  const publicActivity = (await (await admin.request.get(`${api}/public/activities/${activity.code}`)).json()).data;
  const regionName = publicActivity.regions.find((item) => item.code === customer.regionCode)?.name;
  assert.ok(regionName);
  console.log("PASS admin login and activity initialization");

  const otherActivity = activities.find((item) => item.id !== activity.id);
  if (otherActivity) {
    for (const target of [otherActivity, activity]) {
      await page.getByRole("button", { name: /当前活动/ }).click();
      await page.locator(".activity-switcher-menu > button").filter({ hasText: target.code }).click();
      await page.waitForFunction((code) => document.querySelector('input[aria-label="活动编号，只读"]')?.value === code, target.code);
    }
    console.log("PASS activity switching restores the selected activity workspace");
  }

  for (const tab of ["商品导入", "白名单", "现场到场", "订单管理", "抽奖规则", "部门与账号", "活动概览"]) {
    await page.locator(".admin-sidebar").getByRole("button", { name: new RegExp(`${tab}$`) }).click();
    await page.locator(".admin-heading > strong").filter({ hasText: tab }).waitFor();
  }
  await page.screenshot({ path: new URL("admin.png", output).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
  console.log("PASS all admin tabs render");

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const h5 = await mobile.newPage();
  track(h5);
  async function verify(expectCatalog = true) {
    await h5.getByRole("button", { name: /综合客户订货/ }).click();
    await h5.getByRole("button", { name: new RegExp(`${regionName}综合经销商`) }).click();
    await h5.getByLabel("手机号", { exact: true }).fill(customer.phone);
    await h5.getByRole("button", { name: /^验证并/ }).click();
    if (expectCatalog) await h5.getByRole("spinbutton", { name: "AUTOTEST_综合商品一订货箱数" }).waitFor();
    else await h5.locator(".submitted-page").waitFor();
  }
  await h5.goto(`${base}/h5/${activity.code}`);
  await verify();
  assert.equal(await h5.locator(".product-card").count(), 2);
  await h5.getByRole("tab", { name: "非返利产品", exact: true }).click();
  assert.equal(await h5.locator(".product-card").count(), 1);
  assert.match(await h5.locator(".product-card").innerText(), /AUTOTEST_综合商品三/);
  await h5.getByRole("tab", { name: "返利产品", exact: true }).click();
  await h5.getByPlaceholder("搜索商品", { exact: true }).fill("P001");
  assert.equal(await h5.locator(".product-card").count(), 1);
  const descriptionStyle = await h5.locator(".product-description").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { overflowY: style.overflowY, maxHeight: parseFloat(style.maxHeight), fontSize: parseFloat(style.fontSize) };
  });
  assert.equal(descriptionStyle.overflowY, "auto");
  assert.ok(Math.abs(descriptionStyle.maxHeight - descriptionStyle.fontSize * 3.9) < 0.1);
  await h5.getByPlaceholder("搜索商品", { exact: true }).fill("");
  console.log("PASS H5 product filters and bounded description layout");
  const quantity = () => h5.getByRole("spinbutton", { name: "AUTOTEST_综合商品一订货箱数" });
  const savedDraft = h5.waitForResponse((r) => r.url().endsWith("/order-draft") && r.request().method() === "PUT" && r.status() === 200);
  await quantity().fill("3");
  await savedDraft;
  await h5.reload();
  await verify();
  assert.equal(await quantity().inputValue(), "3");
  console.log("PASS H5 verification and draft restoration after reload");

  await h5.getByRole("button", { name: "确认订单", exact: true }).click();
  await h5.getByRole("button", { name: "确认提交订单", exact: true }).click();
  await h5.getByRole("button", { name: "查看订单", exact: true }).click();
  await h5.getByRole("button", { name: "修改订单", exact: true }).waitFor();
  const firstResponse = await mobile.request.get(`${api}/h5/activities/${activity.code}/order`);
  assert.equal(firstResponse.status(), 200);
  const first = (await firstResponse.json()).data;
  assert.equal(first.currentVersion, 1);
  assert.equal(first.totalQuantity, 3);
  console.log("PASS H5 first submission");

  await h5.getByRole("button", { name: "修改订单", exact: true }).click();
  await quantity().fill("4");
  await h5.getByRole("button", { name: "确认订单", exact: true }).click();
  await h5.getByRole("button", { name: "确认修改并提交", exact: true }).click();
  await h5.getByRole("button", { name: "查看订单", exact: true }).click();
  await h5.getByRole("button", { name: "修改订单", exact: true }).click();
  await quantity().fill("0");
  await h5.getByRole("button", { name: "取消本次订货", exact: true }).click();
  await h5.getByRole("button", { name: "确认取消", exact: true }).click();
  await h5.getByRole("button", { name: "继续订货", exact: true }).waitFor();
  const withdrawn = (await (await mobile.request.get(`${api}/h5/activities/${activity.code}/order`)).json()).data;
  assert.equal(withdrawn.status, "WITHDRAWN");
  assert.equal(withdrawn.currentVersion, 2);
  assert.equal(withdrawn.totalQuantity, 4);
  assert.equal(withdrawn.orderNo, first.orderNo);
  console.log("PASS H5 modification and withdrawal preserve order and version history");

  await h5.getByRole("button", { name: "继续订货", exact: true }).click();
  assert.equal(await quantity().inputValue(), "4");
  await quantity().fill("5");
  await h5.getByRole("button", { name: "确认订单", exact: true }).click();
  await h5.getByRole("button", { name: "重新提交订单", exact: true }).click();
  await h5.getByRole("button", { name: "查看订单", exact: true }).click();
  await h5.getByRole("button", { name: "修改订单", exact: true }).waitFor();
  const resubmitted = (await (await mobile.request.get(`${api}/h5/activities/${activity.code}/order`)).json()).data;
  assert.equal(resubmitted.status, "SUBMITTED");
  assert.equal(resubmitted.currentVersion, 3);
  assert.equal(resubmitted.totalQuantity, 5);
  assert.equal(resubmitted.orderNo, first.orderNo);
  await h5.screenshot({ path: new URL("h5.png", output).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
  console.log("PASS H5 resubmission");

  await page.locator(".admin-sidebar").getByRole("button", { name: /订单管理$/ }).click();
  await page.getByPlaceholder("搜索订单号、经销商名称或手机号（完整号码/后四位）").fill(first.orderNo);
  await page.locator(".order-table .clickable-row").filter({ hasText: first.orderNo }).click();
  await page.getByRole("button", { name: "查看商品明细", exact: true }).first().click();
  await page.locator(".order-version-detail").waitFor();
  await page.getByRole("button", { name: "调整订单", exact: true }).click();
  const editor = page.locator(".order-editor-drawer");
  await editor.getByRole("spinbutton", { name: "AUTOTEST_综合商品一箱数" }).fill("6");
  await editor.getByLabel("操作原因").fill("浏览器回归验证订单调整");
  await editor.getByRole("button", { name: "保存并生成新版本", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  const adjusted = (await (await admin.request.get(`${api}/admin/activities/${activity.id}/orders/${first.id}`)).json()).data;
  assert.equal(adjusted.currentVersion, 4);
  assert.equal(adjusted.totalQuantity, 6);
  assert.equal(adjusted.orderNo, first.orderNo);
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await h5.reload();
  await verify(false);
  assert.match(await h5.locator(".submitted-meta").innerText(), /V4/);
  console.log("PASS admin order search, version detail and adjustment; H5 sees V4");

  const screen = await admin.newPage();
  track(screen);
  for (const route of ["dashboard", "ranking", "report", "lottery"]) {
    await screen.goto(`${base}/screen/${activity.code}/${route}`);
    await screen.locator(".prototype-status").filter({ hasText: "服务已连接" }).waitFor();
    const body = await screen.locator("body").innerText();
    if (route === "lottery") assert.match(body, /暂无已发布抽奖轮次/);
    else assert.ok(body.length > 100);
    if (route === "dashboard") {
      const refreshed = screen.waitForResponse((response) => response.url() === `${api}/screen/activities/${activity.code}/dashboard` && response.status() === 200);
      await screen.getByRole("button", { name: /手动刷新/ }).click();
      await refreshed;
      await screen.locator(".order-trend-point").first().click();
      await screen.locator(".order-trend-detail").waitFor();
      assert.match(await screen.locator(".order-trend-detail").innerText(), /订单金额/);
      await screen.getByRole("button", { name: "关闭时间点详情", exact: true }).click();
      assert.equal(await screen.locator(".order-dashboard-kpis").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 6);
      await screen.setViewportSize({ width: 390, height: 844 });
      assert.equal(await screen.locator(".order-dashboard-kpis").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 2);
      await screen.screenshot({ path: new URL("screen-mobile.png", output).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
      await screen.setViewportSize({ width: 1440, height: 1000 });
      console.log("PASS dashboard manual refresh, trend detail and responsive KPI layout");
    }
    if (route === "ranking") {
      const changed = screen.waitForResponse((response) => response.url().includes("/ranking?") && new URL(response.url()).searchParams.get("customerType") === "SPECIAL" && response.status() === 200);
      await screen.locator(".ranking-heading select").selectOption("SPECIAL");
      await changed;
      await screen.getByRole("heading", { name: "特渠专业客户订货排行", exact: true }).waitFor();
      await screen.locator(".ranking-heading select").selectOption("ALL");
      console.log("PASS ranking customer-type switching");
    }
    if (route === "report") {
      const reportName = "综合客户大区金额与产品线金额同屏展示";
      const changed = screen.waitForResponse((response) => response.url().endsWith(`/reports/${encodeURIComponent(reportName)}`) && response.status() === 200);
      await screen.locator(".report-header select").selectOption({ label: reportName });
      await changed;
      assert.equal(await screen.locator(".report-content.dual .metric-table").count(), 2);
      await screen.screenshot({ path: new URL("report-dual.png", output).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
      await screen.locator(".report-header select").selectOption({ label: "总战绩" });
      await screen.locator(".total-performance").waitFor();
      console.log("PASS report selection and dual-table layout");
    }
    if (route === "dashboard") await screen.screenshot({ path: new URL("screen.png", output).pathname.replace(/^\/(\w:)/, "$1"), fullPage: true });
  }
  console.log("PASS four screen routes");
  await page.locator(".admin-sidebar").getByRole("button", { name: /活动概览$/ }).click();
  page.on("dialog", (dialog) => dialog.accept(dialog.type() === "prompt" ? "浏览器回归验证截止只读" : undefined));
  await page.getByRole("button", { name: "立即截止订货", exact: true }).click();
  await page.getByText("订货已截止", { exact: true }).first().waitFor();
  await h5.reload();
  await verify(false);
  assert.equal(await h5.getByRole("button", { name: "修改订单", exact: true }).count(), 0);
  assert.match(await h5.locator(".submitted-note").innerText(), /活动已截止/);
  console.log("PASS activity close and H5 read-only order");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByRole("button", { name: "登录", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS logout; no uncaught browser errors");
} catch (error) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      console.error("BROWSER FAILURE", page.url(), (await page.locator("body").innerText().catch(() => "")).slice(0, 2000));
    }
  }
  console.error("PAGE ERRORS", errors);
  throw error;
} finally {
  await browser.close();
}
