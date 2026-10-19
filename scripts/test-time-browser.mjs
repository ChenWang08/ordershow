import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";

assert.equal(process.env.ORDER_SHOW_E2E, "order-show-e2e", "Only the disposable test stack is allowed");
const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
const base = "http://localhost:3100";
const api = "http://localhost:8180/api/v1";
const outputDirectory=process.env.ORDER_SHOW_TIME_OUTPUT_DIRECTORY||"outputs/utc-time";
assert.match(outputDirectory,/^outputs\/[a-z0-9-]+$/);
const output = new URL(`../${outputDirectory}/`, import.meta.url);
await mkdir(output, { recursive: true });
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(`${base}/admin`, { signal: AbortSignal.timeout(2000) });
    if (response.status === 200) { ready = true; break; }
  } catch { /* The freshly recreated frontend may not have bound its port yet. */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert.ok(ready, "The isolated frontend did not become ready on port 3100");
const browser = await chromium.launch({ headless: true });
const results = [], errors = [];
const beijing = value => new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" });
const formValue = value => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16);
const screenshotPath = name => new URL(name, output).pathname.replace(/^\/(\w:)/, "$1");
let fixture;
try {
  for (const timezoneId of ["Asia/Shanghai", "UTC", "America/Los_Angeles"]) {
    const context = await browser.newContext({ timezoneId, locale: "zh-CN", viewport: { width: 1440, height: 1000 } });
    const sessionFile=process.env.ORDER_SHOW_TIME_SESSION_FILE;
    if(sessionFile){
      const session=JSON.parse(await readFile(sessionFile,'utf8'));
      await context.addCookies([{name:'ORDER_SHOW_ADMIN_SESSION',value:session.token,url:base,httpOnly:true},{name:'ORDER_SHOW_ADMIN_CSRF',value:session.csrf,url:base}]);
    }
    const page = await context.newPage();
    page.on("pageerror", error => errors.push({ timezoneId, message: error.message }));
    await page.goto(`${base}/admin`);
    if(!sessionFile){
      await page.getByLabel("用户名").fill("e2e_admin");
      await page.getByLabel("密码", { exact: true }).fill("E2eChanged456!");
      await page.getByRole("button", { name: "登录", exact: true }).click();
    }
    await page.locator(".admin-sidebar").waitFor();
    if (!fixture) {
      const response = await context.request.get(`${api}/admin/activities`);
      assert.equal(response.status(), 200);
      for (const activity of (await response.json()).data) {
        if(process.env.ORDER_SHOW_TIME_ACTIVITY_ID&&activity.id!==Number(process.env.ORDER_SHOW_TIME_ACTIVITY_ID))continue;
        const requests = await context.request.get(`${api}/admin/activities/${activity.id}/order-change-requests/page?status=ALL&size=20`);
        assert.equal(requests.status(), 200);
        const rows = (await requests.json()).data;
        const chosen=process.env.ORDER_SHOW_TIME_REQUEST_ID?rows.find(row=>row.id===Number(process.env.ORDER_SHOW_TIME_REQUEST_ID)):rows[0];
        if (chosen) { fixture = { activity, request: chosen }; break; }
      }
      assert.ok(fixture, "Run isolated Java API E2E first to generate reviewed requests");
    }
    const { activity, request } = fixture;
    await page.getByRole("button", { name: /当前活动/ }).click();
    await page.locator(".activity-switcher-menu > button").filter({ hasText: activity.code }).click();
    await page.locator(".admin-sidebar").getByRole("button", { name: /活动概览$/ }).click();
    await page.waitForFunction(expected => document.querySelector('input[aria-label="活动编号，只读"]')?.value === expected, activity.code);
    for (const [label, key] of [["订货开始时间（北京时间）", "startsAt"], ["订货截止时间（北京时间）", "endsAt"], ["整场活动结束时间（北京时间）", "eventEndsAt"]]) {
      assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), formValue(activity[key]));
    }
    await page.locator(".admin-sidebar").getByRole("button", { name: /订单管理$/ }).click();
    await page.getByRole("button", { name: /变更审核/ }).click();
    await page.getByLabel("申请状态", { exact: true }).selectOption("ALL");
    const row = page.locator(".review-workbench tbody > tr").filter({hasText:beijing(request.requestedAt)}).first();
    await row.getByRole("button", { name: request.orderNo, exact: true }).waitFor();
    assert.equal(await row.locator("td").first().innerText(), beijing(request.requestedAt));
    await row.getByRole("button", { name: /查看详情|查看并审核/ }).click();
    const drawer = page.getByRole("dialog", { name: "变更申请详情" });
    await drawer.waitFor();
    assert.ok((await drawer.innerText()).includes(`申请时间：${beijing(request.requestedAt)}`));
    await page.screenshot({ path: screenshotPath(`review-${timezoneId.replaceAll("/", "-")}.png`), fullPage: true });

    const orderResponse = await context.request.get(`${api}/admin/activities/${activity.id}/orders/${request.orderId}`);
    assert.equal(orderResponse.status(), 200);
    const order = (await orderResponse.json()).data;
    const customersResponse = await context.request.get(`${api}/admin/activities/${activity.id}/customers?size=200`);
    const customer = (await customersResponse.json()).data.find(item => item.id === order.activityCustomerId);
    assert.ok(customer);
    const publicActivity = (await (await context.request.get(`${api}/public/activities/${activity.code}`)).json()).data;
    assert.ok(["ACTIVE", "CLOSED"].includes(publicActivity.status), "The fixture must allow H5 verification");
    const h5 = await context.newPage();
    h5.on("pageerror", error => errors.push({ timezoneId, message: error.message }));
    await h5.setViewportSize({ width: 390, height: 844 });
    await h5.goto(`${base}/h5/${activity.code}`);
    await h5.waitForFunction(() => Boolean(document.querySelector(".channel-options, .verify-card input")));
    if (await h5.locator(".channel-options").isVisible()) {
      await h5.getByRole("button", { name: customer.customerType === "SPECIAL" ? /特渠专业客户订货/ : /综合客户订货/ }).click();
      await h5.waitForFunction(() => Boolean(document.querySelector(".region-options, .verify-card input")));
      if (await h5.locator(".region-options").isVisible()) {
        const region = publicActivity.regions.find(item => item.code === customer.regionCode)?.name || "未分大区";
        await h5.locator(".region-options button").filter({ hasText: region }).click();
      }
    }
    await h5.getByLabel("手机号", { exact: true }).fill(customer.phone);
    await h5.getByRole("button", { name: /^验证并/ }).click();
    await h5.locator(".submitted-page").waitFor();
    const currentRequest = (await (await context.request.get(`${api}/h5/activities/${activity.code}/order-change-requests/current`)).json()).data;
    const pending = currentRequest?.status === "PENDING";
    const h5Time = h5.locator(".submitted-meta p").filter({ hasText: pending ? "申请时间" : "最后修改时间" }).locator("b");
    assert.equal(await h5Time.innerText(), beijing(pending ? currentRequest.requestedAt : order.lastModifiedAt));
    await h5.screenshot({ path: screenshotPath(`h5-${timezoneId.replaceAll("/", "-")}.png`), fullPage: true });

    const screen = await context.newPage();
    screen.on("pageerror", error => errors.push({ timezoneId, message: error.message }));
    const dashboardResponse = screen.waitForResponse(response => response.url().endsWith(`/screen/activities/${activity.code}/dashboard`) && response.status() === 200);
    await screen.goto(`${base}/screen/${activity.code}/dashboard`);
    const dashboard = (await (await dashboardResponse).json()).data.dashboard;
    await screen.locator(".order-dashboard-live small").filter({ hasText: beijing(dashboard.generatedAt) }).waitFor();
    await screen.screenshot({ path: screenshotPath(`dashboard-${timezoneId.replaceAll("/", "-")}.png`), fullPage: true });
    results.push({ timezoneId, activityId: activity.id, requestId: request.id, requestedAt: request.requestedAt,
      displayedAt: beijing(request.requestedAt), checks: ["Beijing activity form", "review list", "review detail", "H5 order time", "dashboard update time"] });
    console.log("PASS timezone browser", timezoneId);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(new URL("browser-results.json", output), JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}
