import assert from "node:assert/strict";

// Post-deployment checks are read-only; never reuse the mutating E2E regression here.
const base = "http://localhost:3000";
const api = "http://localhost:8080/api/v1";
const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.route("**/api/v1/**", (route) => {
    if (["GET", "HEAD"].includes(route.request().method())) return route.continue();
    return route.abort();
  });
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const health = await context.request.get(`${api}/actuator/health`);
  assert.equal(health.status(), 200);
  assert.equal((await health.json()).status, "UP");
  const admin = await page.goto(`${base}/admin`);
  assert.equal(admin.status(), 200);
  await page.getByRole("heading", { name: "管理后台登录", exact: true }).waitFor();
  console.log("PASS backend health and admin login page");

  const current = await context.request.get(`${api}/public/activities/current`);
  if (current.status() === 200) {
    const activity = (await current.json()).data;
    const code = encodeURIComponent(activity.code);
    const h5 = await page.goto(`${base}/h5/${code}`);
    assert.equal(h5.status(), 200);
    await page.locator(".h5-page").waitFor();
    console.log("PASS current activity H5 entry");
    const data = page.waitForResponse((response) => response.url() === `${api}/screen/activities/${code}/dashboard`);
    const screen = await page.goto(`${base}/screen/${code}/dashboard`);
    assert.equal(screen.status(), 200);
    assert.equal((await data).status(), 200);
    await page.locator(".order-dashboard-kpis").waitFor();
    assert.equal(await page.locator(".order-dashboard-kpis article").count(), 6);
    assert.equal(await page.locator(".order-dashboard-error").count(), 0);
    console.log("PASS current activity dashboard");
  } else {
    assert.ok([404, 409].includes(current.status()), `Unexpected current activity response: ${current.status()}`);
    console.log(`Current activity endpoint returned ${current.status()}; no activity-specific smoke run`);
  }
  assert.deepEqual(errors, []);
  console.log("PASS no uncaught browser errors; no business writes performed");
} finally {
  await browser.close();
}
