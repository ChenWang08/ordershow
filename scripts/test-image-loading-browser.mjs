import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, configFile: false, plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_ACTIVITY_CODE": JSON.stringify("PHONE-TEST"), "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
  server: { host: "127.0.0.1", port: 4189, strictPort: true }, cacheDir: `${root}/outputs/image-optimization/vite-cache` });
const pixels = await sharp({ create: { width: 320, height: 160, channels: 3, background: "#d08040" } }).jpeg().toBuffer();
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(), files = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/public/files/")) { files.push(path); return route.fulfill({ contentType: "image/jpeg", body: pixels }); }
    if (path.endsWith("/lottery")) return route.fulfill({ json: { data: { rules: [{ id: 1, status: "PUBLISHED", rounds: [{ id: 1, name: "第一轮", prizeName: "奖品", prizeImageUrl: "/api/v1/public/files/6", winnerCount: 1, customerType: "ALL", candidateScope: "ALL", status: "READY" }] }], winners: [] } } });
    return route.fulfill({ json: { data: [] } });
  });
  const open = async kind => { files.length = 0; await page.goto(`http://127.0.0.1:4189/tests/fixtures/image-loading/index.html?kind=${kind}`); };
  const noOriginal = () => assert.equal(files.filter(path => /\/files\/\d+$/.test(path)).length, 0);
  await open("scroll");
  await page.waitForFunction(() => document.querySelector('[src*="/100/thumbnail"]')?.naturalWidth === 320);
  noOriginal(); assert(!files.some(path => path.includes("/129/")));
  await page.evaluate(() => document.getElementById("scroll").scrollTo(0, 3000));
  await page.waitForFunction(() => document.querySelector('[src*="/129/thumbnail"]')?.naturalWidth === 320); noOriginal();
  await page.getByRole("button", { name: "查看原图", exact: true }).click();
  await page.locator('.product-image-viewer-stage img[src$="/1"]').waitFor();
  await page.waitForFunction(() => document.querySelector(".product-image-viewer-stage img")?.naturalWidth > 0);
  assert.deepEqual(files.filter(path => /\/files\/\d+$/.test(path)), ["/api/v1/public/files/1"]);
  await page.getByRole("button", { name: "下一张图片" }).click();
  await page.waitForFunction(() => document.querySelector(".product-image-viewer-stage img")?.src.endsWith("/2"));
  await page.getByRole("button", { name: "关闭图片预览" }).click();
  assert.equal(await page.evaluate(() => window.checkZip()), true);
  await page.evaluate(() => { document.getElementById("scroll").scrollTo(0, 0); });
  await page.evaluate(() => window.prepareLocal());
  assert.equal(await page.evaluate(() => window.previewReads), 0);
  await page.evaluate(() => document.getElementById("scroll").scrollTo(0, 3100));
  await page.waitForFunction(() => [...document.images].some(image => image.src.startsWith("blob:") && image.naturalWidth === 320));
  assert.equal(await page.evaluate(() => window.previewReads), 1);
  await page.evaluate(() => window.releasePreview());
  assert.equal(await page.evaluate(() => window.revokedUrls.length), 1);
  for (const kind of ["table", "editor", "upload", "lottery", "background", "board"]) {
    await open(kind);
    if (kind === "table") await page.locator(".table-scroll").evaluate(element => { element.scrollLeft = 900; });
    await page.waitForFunction(() => [...document.images].some(image => /\/(thumbnail|display)\?/.test(image.src) && image.naturalWidth === 320)
      || document.querySelector('.activity-background-preview[style*="thumbnail"]'));
    noOriginal();
    assert(files.some(path => path.endsWith(kind === "board" ? "/display" : "/thumbnail")), kind);
  }
  await open("drawer");
  page.on("dialog", dialog => dialog.accept());
  await page.locator('.product-image-editor input[type="file"]').setInputFiles({ name: "test.jpg", mimeType: "image/jpeg", buffer: pixels });
  await page.waitForFunction(() => [...document.images].some(image => image.src.startsWith("blob:") && image.naturalWidth === 320));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByText("已关闭", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.revokedUrls.length), 1);
  assert.deepEqual(errors, []);
  await context.close();

  // Both phone-entry branches mount the real H5 and only request derivatives.
  for (const existing of [false, true]) {
    const session = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const h5 = await session.newPage(), imageRequests = [], apiCalls = [], pageErrors = [];
    h5.on("pageerror", error => pageErrors.push(error.message));
    await h5.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      apiCalls.push(path);
      if (path.includes("/files/")) { imageRequests.push(path); return route.fulfill({ contentType: "image/jpeg", body: pixels }); }
      let data;
      if (path.endsWith("/verify-phone")) data = { selectionRequired: false, csrfToken: "test", customer: { activityId: 1, activityCode: "PHONE-TEST", customerId: 1, customerType: "GENERAL", dealerFullName: "合成经销商", phoneMasked: "139****0001" } };
      else if (path.endsWith("/products")) data = [{ id: 1, materialName: "图片商品", casePrice: 10, customerType: "ALL", rebateStatus: "ALL", orderable: true, dataStatus: "VALID", images: [{ id: 1, url: "/api/v1/public/files/11", primary: true, sortNo: 0 }] }];
      else if (path.endsWith("/order")) data = existing ? { id: 101, activityId: 1, activityCustomerId: 1, currentVersion: 1, lockVersion: 1, status: "SUBMITTED", orderNo: "SYNTHETIC", totalAmount: 10, totalQuantity: 1, operations: [], items: [{ productId: 1, materialName: "图片商品", quantity: 1, casePrice: 10, lineAmount: 10 }] } : null;
      else data = null;
      return route.fulfill({ json: { data } });
    });
    await h5.goto("http://127.0.0.1:4189/tests/fixtures/h5-phone-entry/index.html");
    await h5.getByLabel("手机号", { exact: true }).fill("13900000001");
    await h5.getByRole("button", { name: "验证并进入订货" }).click();
    try { await h5.waitForFunction(() => document.querySelector('img[src*="/11/thumbnail"]')?.naturalWidth === 320, null, { timeout: 10000 }); }
    catch (error) { console.log({ existing, apiCalls, pageErrors, text: await h5.locator("body").innerText(), images: await h5.locator("img").evaluateAll(nodes => nodes.map(n => ({ src: n.src, box: n.getBoundingClientRect().toJSON() }))) }); throw error; }
    assert.deepEqual([...new Set(imageRequests)], ["/api/v1/public/files/11/thumbnail"]);
    await session.close();
  }
  console.log("PASS: real H5 new/existing-order entry, nested scrolling, admin table/editor/import, lottery preview/display, background preview, selected-original viewer, lazy local/ZIP previews and cancel cleanup. Synthetic data only.");
} finally { await browser?.close(); await server.close(); }
