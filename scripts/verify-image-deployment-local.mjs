import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const api = "http://localhost:8080/api/v1";
const imageUrl = `${api}/public/files/37/thumbnail?v=1`;
const image = await fetch(imageUrl);
assert.equal(image.status, 200);
const bytes = Buffer.from(await image.arrayBuffer()), metadata = await sharp(bytes).metadata();
assert(Math.max(metadata.width, metadata.height) <= 320);
assert.match(image.headers.get("cache-control"), /max-age=2592000.*immutable/);
const unchanged = await fetch(imageUrl, { headers: { "If-None-Match": image.headers.get("etag") } });
assert.equal(unchanged.status, 304); assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
const activityUrl = `${api}/public/activities/2026-mid-autumn`;
const activity = await fetch(activityUrl); assert.equal(activity.status, 200);
const activity304 = await fetch(activityUrl, { headers: { "If-None-Match": activity.headers.get("etag") } });
assert.equal(activity304.status, 304);

const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const cdp = await context.newCDPSession(page), requests = new Map(), cached = new Set();
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", event => requests.set(event.requestId, event.request.url));
  cdp.on("Network.requestServedFromCache", event => cached.add(event.requestId));
  await page.goto("http://localhost:3000/admin");
  await page.getByRole("button", { name: /登录/ }).first().waitFor();
  const loadImage = () => page.evaluate(url => new Promise((resolve, reject) => {
    const node = new Image(); node.onload = () => resolve({ width: node.naturalWidth, height: node.naturalHeight });
    node.onerror = () => reject(new Error("Deployed image failed to load")); node.src = url; document.body.append(node);
  }), imageUrl);
  await loadImage();
  await page.reload();
  await loadImage();
  assert([...cached].some(id => requests.get(id) === imageUrl), "Browser must reuse the image cache");
  await page.goto("http://localhost:3000/h5/2026-mid-autumn");
  await page.waitForFunction(() => !document.body.innerText.includes("正在加载活动"));
  assert.deepEqual(errors, []);
  const report = { image: { status: 200, bytes: bytes.length, width: metadata.width, height: metadata.height,
    etag: image.headers.get("etag"), cacheControl: image.headers.get("cache-control"), conditionalStatus: unchanged.status },
    activityStatus: activity.status, activityConditionalStatus: activity304.status, browserCacheReuse: true, browserErrors: errors };
  await writeFile("outputs/image-optimization/deployment-verification.json", JSON.stringify(report, null, 2));
  await page.screenshot({ path: "outputs/image-optimization/local-h5.png" });
  console.log(JSON.stringify(report));
  await context.close();
} finally { await browser.close(); }
