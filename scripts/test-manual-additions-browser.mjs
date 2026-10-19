import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";

// Test UI + API only, with synthetic fixtures from test-manual-additions.mjs.
assert.equal(process.env.ORDER_SHOW_E2E, "order-show-e2e");
const base = "http://localhost:3100";
const api = "http://localhost:8180/api/v1";
const output = new URL("../outputs/manual-additions/", import.meta.url);
await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile(new URL("fixtures.json", output), "utf8"));
const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
const errors = [];
let counter = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  await page.goto(`${base}/admin`);
  await page.getByLabel("用户名").fill(fixture.username);
  await page.getByLabel("密码", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator(".admin-sidebar").getByRole("button", { name: /白名单$/ }).waitFor();
  await page.getByRole("button", { name: /当前活动/ }).click();
  await page.locator(".activity-switcher-menu > button").filter({ hasText: fixture.activity.code }).click();
  await page.getByRole("button", { name: /当前活动/ }).filter({ hasText: fixture.activity.name }).waitFor();

  const drawer = page.locator(".form-drawer");
  const modes = [
    { key: "customers", tab: "白名单", add: "＋ 手动添加客户", save: "添加客户", fill: async name => {
      await drawer.getByLabel("分公司名称 *").fill("测试分公司");
      await drawer.getByLabel("经销商名称（简）*").fill(`合成${counter}`);
      await drawer.getByLabel("经销商名称（全）*").fill(name);
      await drawer.getByLabel("经销商电话 *").fill(`13900001${String(counter).padStart(3, "0")}`);
      await drawer.getByLabel("紧急修改原因 *").fill("浏览器隔离回归");
    } },
    { key: "products", tab: "商品导入", add: "＋ 手动添加商品", save: "添加商品", fill: async name => {
      await drawer.getByLabel("物料名称 *").fill(name);
      await drawer.getByLabel("元/箱", { exact: true }).fill("100");
      await drawer.getByLabel("每吨箱数（箱/吨）").fill("10");
      await drawer.getByLabel("新增商品原因").fill("浏览器隔离回归");
    } },
    { key: "attendees", tab: "现场到场", add: "＋ 手动添加到场客户", save: "保存到场客户", fill: async name => {
      await drawer.getByLabel("参会人姓名").fill("合成测试人");
      await drawer.getByLabel("经销商名称", { exact: true }).fill(name);
      await drawer.getByLabel("分公司", { exact: true }).fill("测试分公司");
    } },
  ];
  async function open(mode) {
    await page.locator(".admin-sidebar").getByRole("button", { name: new RegExp(`${mode.tab}$`) }).click();
    await page.getByRole("button", { name: mode.add, exact: true }).click();
    const name = `浏览器合成${mode.key}${Date.now()}${++counter}`;
    await mode.fill(name);
    return name;
  }
  async function close() {
    await drawer.getByRole("button", { name: "取消", exact: true }).click();
    await drawer.waitFor({ state: "hidden" });
  }
  async function expectAlert(message) {
    const alert = drawer.getByRole("alert");
    await alert.filter({ hasText: message }).waitFor();
    const box = await alert.boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width,
      "The complete error must remain in the visible drawer viewport");
  }
  for (const mode of modes) {
    const url = `${api}/admin/activities/${fixture.activity.id}/${mode.key}`;
    const name = await open(mode);
    const detail = `本次${mode.tab}保存校验未通过，请检查重复记录和填写内容。`.repeat(5);
    await page.route(url, route => route.request().method() === "POST"
      ? route.fulfill({ status: 409, contentType: "application/problem+json", body: JSON.stringify({ code: "TEST_CONFLICT", detail }) })
      : route.continue());
    await drawer.getByRole("button", { name: mode.save, exact: true }).click();
    await expectAlert(detail);
    assert.equal(await drawer.getByRole("button", { name: mode.save, exact: true }).isEnabled(), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectAlert(detail);
    await page.screenshot({ path: new URL(`${mode.key}-error-mobile.png`, output).pathname.replace(/^\/(\w:)/, "$1") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.unroute(url);
    // Retry the unchanged form against the real isolated API.
    const savedResponse = page.waitForResponse(response => response.url() === url && response.request().method() === "POST");
    await drawer.getByRole("button", { name: mode.save, exact: true }).click();
    assert.equal((await savedResponse).status(), 200);
    await drawer.waitFor({ state: "hidden" });
    await page.getByText(name, { exact: true }).first().waitFor();

    await open(mode);
    let calls = 0;
    await page.route(url, route => {
      if (route.request().method() !== "POST") return route.continue();
      calls++; return route.abort("failed");
    });
    await drawer.getByRole("button", { name: mode.save, exact: true }).click();
    await expectAlert("新增结果尚未确认");
    assert.equal(await drawer.getByRole("button", { name: mode.save, exact: true }).isDisabled(), true);
    await drawer.getByRole("button", { name: "刷新列表", exact: true }).waitFor();
    assert.equal(calls, 1);
    await close(); await page.unroute(url);
    console.log(`PASS ${mode.key}: visible actual error, narrow viewport, retained form + successful retry, uncertain create blocked`);
  }

  const productMode = modes[1];
  const partialName = await open(productMode);
  await drawer.locator('input[type="file"]').setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYv8AAAAASUVORK5CYII=", "base64") });
  await drawer.locator(".product-image-tile").waitFor();
  await page.route(`${api}/admin/activities/${fixture.activity.id}/products/*/images`, route => route.fulfill({ status: 500, contentType: "application/problem+json", body: JSON.stringify({ code: "TEST_UPLOAD_FAILURE", detail: "测试图片处理失败" }) }));
  await drawer.getByRole("button", { name: productMode.save, exact: true }).click();
  await expectAlert("商品已添加");
  assert.equal(await drawer.getByRole("button", { name: productMode.save, exact: true }).isDisabled(), true);
  const products = await context.request.get(`${api}/admin/activities/${fixture.activity.id}/products`);
  assert.equal((await products.json()).data.filter(item => item.materialName === partialName).length, 1);
  await page.screenshot({ path: new URL("product-partial-save.png", output).pathname.replace(/^\/(\w:)/, "$1") });
  await close();
  assert.deepEqual(errors, []);
  console.log("PASS partial product creation preserves the saved identity and prevents a second create; no uncaught browser errors");
} finally {
  await browser.close();
}
