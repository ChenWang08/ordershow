import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Actual React components, mocked HTTP only. This never calls a business backend.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../outputs/h5-phone-entry/", import.meta.url);
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: false, plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_ACTIVITY_CODE": JSON.stringify("PHONE-TEST"), "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
  server: { host: "127.0.0.1", port: 4187, strictPort: true },
  cacheDir: fileURLToPath(new URL("../outputs/h5-phone-entry/vite-cache", import.meta.url)) });
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_PATH ? { executablePath: process.env.ORDER_SHOW_BROWSER_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const calls = [], errors = [];
  let rejectConfirmation = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, "http://127.0.0.1:4187", "No external/business requests allowed");
    if (!url.pathname.startsWith("/api/v1/")) return route.continue();
    const body = request.postDataJSON(); calls.push({ path: url.pathname, body, method: request.method() });
    let data;
    if (url.pathname.endsWith("/verify-phone")) {
      if (body.phone === "13900000009" && !body.customerType) data = { selectionRequired: true, customerTypes: ["GENERAL", "SPECIAL"] };
      else if (rejectConfirmation && body.customerType) return route.fulfill({ status: 404, json: { code: "WHITELIST_IDENTITY_NOT_FOUND", message: "该手机号不在当前活动的有效白名单中" } });
      else data = { selectionRequired: false, csrfToken: "test", customer: { activityId: 1, customerId: body.customerType === "SPECIAL" ? 2 : 1,
        activityCode: "PHONE-TEST", customerType: body.customerType || "GENERAL", regionCode: "EAST", branchName: "测试分公司", dealerFullName: "合成经销商", phoneMasked: "139****0001" } };
    } else if (url.pathname.endsWith("/products")) data = [{ id: 1, materialName: "合成商品", images: [], casePrice: 10, customerType: "ALL", rebateStatus: "ALL", orderable: true, dataStatus: "VALID" }];
    else if (url.pathname.endsWith("/order")) return route.fulfill({ status: 404, json: { code: "ORDER_NOT_FOUND" } });
    else if (url.pathname.endsWith("/order-draft") && request.method() === "GET") data = null;
    else throw Error("Unexpected API request: " + request.method() + " " + url.pathname);
    return route.fulfill({ status: 200, json: { data, traceId: "synthetic-phone-test" } });
  });
  const go = async () => {
    await page.goto("http://127.0.0.1:4187/tests/fixtures/h5-phone-entry/index.html");
    await page.getByRole("heading", { name: "输入白名单手机号" }).waitFor();
  };
  await go();
  assert.equal(await page.getByText("选择您的订货通道").count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL("phone.png", output)) });
  await page.getByLabel("手机号", { exact: true }).fill("13900000001");
  await page.getByRole("button", { name: "验证并进入订货" }).click();
  await page.getByText("合成经销商", { exact: true }).waitFor();
  assert.equal(calls.filter(c => c.path.endsWith("/verify-phone")).length, 1);
  assert.deepEqual(calls[0].body, { phone: "13900000001" });
  assert.match(await page.locator(".dealer-card").innerText(), /综合客户.*东区.*测试分公司/s);
  await page.screenshot({ path: fileURLToPath(new URL("customer.png", output)) });

  await go(); calls.length = 0;
  await page.getByLabel("手机号", { exact: true }).fill("13900000009");
  await page.getByRole("button", { name: "验证并进入订货" }).click();
  const dialog = page.getByRole("dialog"); await dialog.waitFor();
  assert.deepEqual(await dialog.getByRole("button").allTextContents(), ["综合", "特渠", "取消"]);
  assert.equal(calls.length, 1, "No product/order read before choosing a type");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "综合");
  await page.screenshot({ path: fileURLToPath(new URL("choice-mobile.png", output)) });
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  assert.equal(await page.getByLabel("手机号", { exact: true }).isEnabled(), true);
  await page.getByRole("button", { name: "验证并进入订货" }).click(); await dialog.waitFor();
  rejectConfirmation = true;
  await dialog.getByRole("button", { name: "特渠", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(calls.filter(c => c.path.endsWith("/products")).length, 0);
  rejectConfirmation = false;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: fileURLToPath(new URL("choice-desktop.png", output)) });
  await dialog.getByRole("button", { name: "特渠", exact: true }).click();
  await page.getByText("合成经销商", { exact: true }).waitFor();
  assert.match(await page.locator(".dealer-card").innerText(), /特渠专业客户.*东区.*测试分公司/s);
  assert.deepEqual(calls.filter(c => c.path.endsWith("/verify-phone")).at(-1).body, { phone: "13900000009", customerType: "SPECIAL" });
  assert.deepEqual(errors, []);
  console.log("PASS: real React phone-first entry, native dialog focus/Escape, choice-only payload, rejection/retry, customer display, mobile/desktop. All HTTP mocked.");
} finally { if (browser) await browser.close(); await server.close(); }
