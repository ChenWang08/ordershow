import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
const base = process.env.HEADER_TEST_URL || "http://localhost:3200";
const code = process.env.HEADER_TEST_ACTIVITY || "HD20261011010";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
async function readOnlyApi(route) {
  const request = route.request();
  if (process.env.HEADER_TEST_DIRECT_API === "true") {
    return ["GET", "HEAD", "OPTIONS"].includes(request.method()) ? route.continue() : route.abort();
  }
  const headers = { "access-control-allow-origin": new URL(base).origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "*" };
  if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
  if (new URL(request.url()).pathname.endsWith("/events")) return route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/event-stream" }, body: ": layout test\n\n" });
  if (!["GET", "HEAD"].includes(request.method())) return route.abort();
  // The isolated preview port is not in the business server's CORS allowlist.
  const response = await route.fetch({ url: `http://localhost:8080${new URL(request.url()).pathname}${new URL(request.url()).search}`, headers: { ...request.headers(), origin: "http://localhost:3000" } });
  return route.fulfill({ response, headers: { ...response.headers(), ...headers } });
}
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  // Layout checks never submit business operations.
  await context.route("**/api/v1/**", readOnlyApi);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await mkdir("outputs/screen-header", { recursive: true });
  async function checkLayout(open, height = 74) {
    await page.waitForFunction(({ open, height }) => {
      const header = document.querySelector(".screen-header");
      const canvas = document.querySelector(".collapsible-screen > .prototype-canvas");
      if (!header || !canvas) return false;
      const h = header.getBoundingClientRect(), c = canvas.getBoundingClientRect();
      return header.dataset.open === String(open) && Math.abs(h.height - (open ? height : 0)) < 1 && Math.abs(c.top - h.bottom) < 1 && Math.abs(c.bottom - innerHeight) < 1;
    }, { open, height });
    assert.equal(await page.locator(".screen-header-panel").evaluate(el => el.inert), !open);
  }
  for (const surface of ["dashboard", "ranking", "report", "lottery"]) {
    await page.mouse.move(600, 300);
    await page.goto(`${base}/screen/${code}/${surface}`);
    await page.locator(".prototype-canvas > section").waitFor();
    await page.waitForFunction(() => document.querySelector(".prototype-status")?.textContent?.includes("服务已连接"));
    if (surface === "lottery") await page.waitForFunction(() => !document.querySelector(".lottery-board")?.textContent?.includes("正在加载"));
    try { await checkLayout(false); } catch (error) {
      console.log(page.url(), errors, await page.evaluate(() => document.body.innerText.slice(0, 3000)));
      await page.screenshot({ path: 'outputs/screen-header/failure.png' });
      throw error;
    }
    await page.waitForFunction(() => (document.querySelector(".prototype-canvas > section")?.getBoundingClientRect().height ?? 0) >= 1080);
    await page.screenshot({ path: `outputs/screen-header/${surface}-hidden.png` });
    await page.mouse.move(600, 1);
    await checkLayout(true);
    await page.mouse.move(600, 40);
    await page.waitForTimeout(650);
    await checkLayout(true);
    await page.screenshot({ path: `outputs/screen-header/${surface}-open.png` });
    await page.mouse.move(600, 300);
    await checkLayout(false);
    if (surface === "dashboard") {
      await page.setViewportSize({ width: 1280, height: 600 });
      await page.locator(".prototype-canvas").evaluate(el => { el.scrollTop = 250; });
      await page.mouse.move(600, 1);
      await checkLayout(true);
      assert.ok(await page.locator(".prototype-canvas").evaluate(el => el.scrollTop > 0));
      await page.mouse.move(600, 300);
      await checkLayout(false);
      await page.setViewportSize({ width: 1920, height: 1080 });
    }
    await page.getByRole("button", { name: "展开顶部栏" }).focus();
    await page.keyboard.press("Enter");
    await checkLayout(true);
    await page.keyboard.press("Enter");
    await checkLayout(false);
    await page.getByRole("button", { name: "展开顶部栏" }).blur();
    for (const x of [2, 960, 1918]) {
      await page.mouse.move(x, 1);
      await checkLayout(true);
      assert.equal(await page.locator(".screen-header-trigger").evaluate(el => getComputedStyle(el).clipPath), "inset(50%)");
      await page.waitForTimeout(650);
      await checkLayout(true);
      await page.mouse.move(x, 300);
      await checkLayout(false);
    }
    console.log(`PASS ${surface}: full height, hover, delayed close, keyboard, no overlap`);
  }
  await page.goto(`${base}/admin`);
  await page.locator(".prototype-nav").waitFor();
  assert.equal(await page.locator(".screen-header").count(), 0);
  assert.equal((await page.locator(".prototype-nav").boundingBox()).height, 74);
  await page.goto(`${base}/h5/${code}`);
  await page.locator(".standalone-h5").waitFor();
  assert.equal(await page.locator(".prototype-nav, .screen-header").count(), 0);

  const hybrid = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  await hybrid.route("**/api/v1/**", readOnlyApi);
  const hybridPage = await hybrid.newPage();
  await hybridPage.goto(`${base}/screen/${code}/report`);
  await hybridPage.waitForFunction(() => document.querySelector('.prototype-status')?.textContent?.includes('服务已连接'));
  await hybridPage.mouse.move(500, 300);
  await hybridPage.waitForFunction(() => document.querySelector('.screen-header')?.dataset.mouse === 'true');
  assert.equal(await hybridPage.locator('.screen-header-trigger').evaluate(el => getComputedStyle(el).clipPath), 'inset(50%)');
  for (const x of [2, 720, 1438]) {
    await hybridPage.mouse.move(x, 1);
    await hybridPage.waitForFunction(() => document.querySelector('.screen-header')?.dataset.open === 'true');
    await hybridPage.mouse.move(x, 300);
    await hybridPage.waitForFunction(() => document.querySelector('.screen-header')?.dataset.open === 'false');
  }
  console.log('PASS touch-capable computer: mouse hides arrow; entire top edge reveals header');

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.route("**/api/v1/**", readOnlyApi);
  const touch = await mobile.newPage();
  for (const surface of ["dashboard", "ranking", "report", "lottery"]) {
    await touch.goto(`${base}/screen/${code}/${surface}`);
    const button = touch.getByRole("button", { name: "展开顶部栏" });
    await button.tap();
    await touch.waitForFunction(() => document.querySelector(".screen-header").getBoundingClientRect().height === 58);
    await touch.getByRole("button", { name: "收起顶部栏" }).tap();
    await touch.waitForFunction(() => document.querySelector(".screen-header").getBoundingClientRect().height === 0);
    console.log(`PASS ${surface}: touch toggle`);
  }
  assert.deepEqual(errors, []);
  console.log("PASS admin and H5 unchanged; no browser exceptions");
} finally {
  await browser.close();
}
