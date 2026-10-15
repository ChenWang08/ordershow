import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.H5_ENTRY_TEST_URL || "http://localhost:3200";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
await mkdir("outputs/h5-entry", { recursive: true });
try {
  // All API calls are fulfilled with synthetic fixtures; no business requests are sent.
  for (const width of [390, 1440]) {
    for (const mode of ["general", "general-unassigned", "special", "mixed", "untyped", "empty"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390 });
      const requests = [];
      const types = mode.startsWith("general") ? ["GENERAL"] : mode === "special" ? ["SPECIAL"] : mode === "mixed" ? ["GENERAL", "SPECIAL"] : [];
      const activity = { id: 987, code: "ENTRY_TEST", name: "入口测试", status: "ACTIVE", configuredStatus: "ACTIVE", timezone: "Asia/Shanghai",
        startsAt: "2026-01-01T00:00:00Z", endsAt: "2030-01-01T00:00:00Z", eventEndsAt: "2030-01-02T00:00:00Z",
        whitelistCustomerTypeMode: mode === "untyped" ? "UNSPECIFIED" : "TYPED", availableCustomerTypes: types,
        regions: [{ code: "EAST", name: "东区", sortNo: 1 }], hasUnassignedGeneralCustomers: mode === "general-unassigned" };
      await context.route("**/api/v1/**", async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        const headers = { "access-control-allow-origin": new URL(base).origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type" };
        const reply = (data, status = 200) => route.fulfill({ status, headers, json: { data } });
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        if (path.endsWith("/verify-phone")) {
          const body = request.postDataJSON(); requests.push(body);
          if (body.phone === "13900000999") return route.fulfill({ status: 404, headers, json: { code: "WHITELIST_IDENTITY_NOT_FOUND", message: "该手机号不在本次活动白名单中" } });
          return reply({ customer: { activityId: 987, activityCode: "ENTRY_TEST", customerId: 1, customerType: body.customerType,
            regionCode: body.customerType === "GENERAL" && mode !== "general-unassigned" ? "EAST" : null,
            dealerFullName: "测试经销商", branchName: "测试分公司", phoneMasked: "139****0001" }, csrfToken: "fixture" });
        }
        assert.equal(request.method(), "GET", `Unexpected write: ${path}`);
        if (path.endsWith("/lottery")) return reply({ rules: [], winners: [] });
        if (path.endsWith("/products")) return reply([]);
        if (path.endsWith("/order") || path.endsWith("/order-draft")) return reply(null);
        if (path.includes("/public/activities/")) { await new Promise(resolve => setTimeout(resolve, 150)); return reply(activity); }
        throw new Error(`Unexpected API: ${path}`);
      });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${base}/h5/ENTRY_TEST`);
      if (mode === "empty") {
        await page.getByRole("heading", { name: "暂无可验证客户" }).waitFor();
        assert.equal(await page.getByRole("textbox").count(), 0);
      } else {
        if (mode === "mixed") {
          await page.getByRole("button", { name: /综合客户订货/ }).click();
          await page.getByRole("button", { name: /东区/ }).click();
        }
        await page.getByRole("heading", { name: "输入白名单手机号" }).waitFor();
        if (mode !== "mixed") assert.equal(await page.getByRole("button", { name: "重新选择" }).count(), 0);
        const expected = mode === "untyped" ? "不区分客户类型" : mode === "special" ? "特渠专业客户" : mode === "mixed" ? "综合客户 · 东区" : "综合客户";
        assert.equal(await page.locator('.verify-context .step-tag').textContent(), expected);
        await page.screenshot({ path: `outputs/h5-entry/${width}-${mode}.png` });
        await page.getByRole("textbox").fill("13900000999");
        await page.getByRole("button", { name: "验证并进入订货" }).click();
        await page.getByRole("alert").filter({ hasText: "白名单" }).waitFor();
        await page.getByRole("textbox").fill("13900000001");
        await page.getByRole("button", { name: "验证并进入订货" }).click();
        await page.locator('.order-page').waitFor();
        const identity = await page.locator('.order-page').innerText();
        assert.match(identity, /测试经销商/);
        if (mode === "general") assert.match(identity, /综合客户 · 东区/);
        if (mode === "general-unassigned") assert.doesNotMatch(identity, /东区/);
        assert.equal(requests.at(-1).regionCode, mode === "mixed" ? "EAST" : null);
      }
      await context.close();
      console.log(`PASS ${width}px ${mode}: entry, label, navigation and verification`);
    }
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
