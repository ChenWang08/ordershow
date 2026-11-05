import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import sharp from "sharp";

// Render the real board and styles with synthetic HTTP; no business services or images.
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("../work/lottery-display/", import.meta.url);
const output = new URL("../outputs/lottery-display/", import.meta.url);
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
const browserTemp = fileURLToPath(new URL("browser-temp/", fixture));
await mkdir(browserTemp, { recursive: true });
process.env.TEMP = browserTemp;
process.env.TMP = browserTemp;
await writeFile(new URL("index.html", fixture), '<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/work/lottery-display/fixture.jsx"></script></html>');
await writeFile(new URL("fixture.jsx", fixture), `
import React from "react";
import {createRoot} from "react-dom/client";
import {LotteryBoard} from "/app/features/lottery/Lottery.tsx";
import {CollapsibleScreenHeader} from "/app/components/CollapsibleScreenHeader.tsx";
import "/app/globals.css";
createRoot(document.getElementById("root")).render(<React.StrictMode>
  <div className="prototype-root collapsible-screen">
    <CollapsibleScreenHeader><nav className="prototype-nav">抽奖大屏测试</nav></CollapsibleScreenHeader>
    <main className="prototype-canvas"><LotteryBoard rounds={[]} attendanceRows={[]} activityId={1} activityFinished={false} onComplete={()=>{}}/></main>
  </div>
</React.StrictMode>);
`);
const counts = [1, 2, 3, 4, 5, 9, 10, 30, 60];
const names = ["合成客户", "深圳市合成商贸发展有限公司", "南昌合成实业有限公司", "成都合成供应链管理有限公司"];
const rounds = counts.map(count => ({
  id: count, roundNo: count, name: "外婆、稻米二等奖抽奖", prizeName: "运动相机",
  // An effective historical result can contain fewer names than its original setting.
  winnerCount: count === 4 ? 20 : count, status: "COMPLETED", candidateScope: "ALL",
  customerType: "ALL", minimumOrderAmount: 0,
  prizeImageUrl: count === 10 ? null : `/api/v1/public/files/${count}`,
}));
const winnersFor = count => Array.from({ length: count }, (_, index) => ({
  roundId: count, position: index + 1,
  dealerDisplayName: count <= 9 ? names[index % names.length] : `合成经销商${index + 1}`,
}));
const images = new Map();
for (const [kind, width, height] of [["landscape", 1600, 928], ["portrait", 800, 1400], ["square", 1000, 1000], ["small", 160, 93]]) {
  images.set(kind, await sharp({ create: { width, height, channels: 3, background: "#b4c7db" } }).png().toBuffer());
}
const server = await createServer({ root, configFile: false, plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
  server: { host: "127.0.0.1", port: 4197, strictPort: true },
  cacheDir: fileURLToPath(new URL("vite-cache", fixture)),
});
let browser;
const reports = [];
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_PATH ? { executablePath: process.env.ORDER_SHOW_BROWSER_PATH } : {}) });
  async function open(viewport, live = false) {
    const page = await browser.newPage({ viewport });
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    const liveRound = { ...rounds.find(round => round.id === 4), status: "READY", winnerCount: 4 };
    await page.route("**/api/v1/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      requests.push({ path, method: request.method() });
      const imageMatch = path.match(/\/public\/files\/(\d+)\/display$/);
      if (imageMatch) {
        const id = Number(imageMatch[1]);
        const kind = id === 3 ? "portrait" : id === 5 ? "square" : id === 60 ? "small" : "landscape";
        return route.fulfill({ contentType: "image/png", body: images.get(kind) });
      }
      let data;
      if (path.endsWith("/lottery")) data = {
        rules: [{ id: 1, revision: 4, status: "PUBLISHED", rounds: live ? [liveRound] : rounds }],
        winners: live ? liveRound.status === "READY" ? [] : winnersFor(4) : counts.flatMap(winnersFor),
      };
      else if (live && path.endsWith("/draw") && request.method() === "POST") {
        liveRound.status = "DRAWN";
        data = { winners: winnersFor(4), ruleRevision: 5 };
      } else if (live && path.endsWith("/complete") && request.method() === "POST") {
        liveRound.status = "COMPLETED";
        data = liveRound;
      } else throw new Error(`Unexpected API request: ${request.method()} ${path}`);
      return route.fulfill({ json: { data } });
    });
    await page.goto("http://127.0.0.1:4197/work/lottery-display/index.html");
    await page.waitForFunction(() => !document.querySelector(".lottery-action")?.disabled || document.querySelector(".winner-grid"));
    return { page, errors, requests };
  }
  async function measure(page) {
    await page.evaluate(() => document.fonts.ready);
    if (await page.locator(".lottery-prize-image img").count()) {
      await page.waitForFunction(() => {
        const image = document.querySelector(".lottery-prize-image img");
        const round = document.querySelector("#lottery-round-selector").value;
        return image?.complete && image.naturalWidth > 1 && image.currentSrc.includes(`/public/files/${round}/display`);
      });
      await page.locator(".lottery-prize-image img").evaluate(image => image.decode());
    }
    return page.evaluate(() => {
      const rect = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
      const grid = document.querySelector(".winner-grid");
      const image = document.querySelector(".lottery-prize-image img");
      return {
        viewport: { width: innerWidth, height: innerHeight },
        board: rect(".lottery-board"), title: rect(".lottery-title"), grid: rect(".winner-grid"),
        button: rect(".lottery-action"), image: rect(".lottery-prize-image img"),
        fit: image ? getComputedStyle(image).objectFit : null,
        columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
        font: grid ? parseFloat(getComputedStyle(grid.firstElementChild).fontSize) : 0,
        density: grid?.dataset.density,
        visibleNames: grid ? [...grid.querySelectorAll("b")].map(node => ({
          ...node.getBoundingClientRect().toJSON(), text: node.textContent,
          clipped: node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
          whiteSpace: getComputedStyle(node).whiteSpace,
          textAlign: getComputedStyle(node).textAlign,
          rowLeft: node.parentElement.getBoundingClientRect().left,
          numberLeft: node.previousElementSibling.getBoundingClientRect().left,
          numberWidth: node.previousElementSibling.getBoundingClientRect().width,
        })) : [],
        scrollHeight: grid?.scrollHeight, clientHeight: grid?.clientHeight,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
        shellOverflow: document.querySelector(".prototype-canvas").scrollHeight > document.querySelector(".prototype-canvas").clientHeight + 1,
      };
    });
  }
  function checkFrame(stats) {
    assert.equal(stats.pageOverflow, false, "page must not overflow horizontally");
    assert.equal(stats.shellOverflow, false, "button must fit the screen without scrolling the page");
    assert.ok(stats.button.bottom <= stats.viewport.height + 1, "button below viewport");
    if (stats.grid) {
      assert.ok(stats.grid.height > 50, "names need usable space");
      assert.ok(stats.title.bottom <= stats.grid.top + 1, "title overlaps names");
      assert.ok(stats.grid.bottom <= stats.button.top + 1, "names overlap button");
      const offsets = stats.visibleNames.map(name => name.left - name.rowLeft);
      assert.ok(Math.max(...offsets) - Math.min(...offsets) < 1, "short and long names must share the same column inset");
      assert.ok(stats.visibleNames.every(name => name.textAlign === "left" && Math.abs(name.numberLeft - name.rowLeft) < 1), "names and numbers must start at the left of their columns");
      const numberWidths = stats.visibleNames.map(name => name.numberWidth);
      assert.ok(Math.max(...numberWidths) - Math.min(...numberWidths) < 1, "number column must have a fixed width");
    }
    if (stats.image) {
      assert.equal(stats.fit, "contain");
      assert.ok(stats.image.left >= 0 && stats.image.right <= stats.viewport.width + 1);
    }
  }
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const { page, errors, requests } = await open(viewport);
    for (const count of counts) {
      await page.locator("#lottery-round-selector").selectOption(String(count));
      await page.waitForFunction(count => document.querySelectorAll(".winner-grid > div").length === count, count);
      const stats = await measure(page);
      checkFrame(stats);
      assert.equal(stats.columns, viewport.width <= 640 || count === 1 ? 1 : count <= 4 ? 2 : 3);
      if (count <= 9) assert.ok(stats.visibleNames.every(name => !name.clipped && name.whiteSpace === "normal"), "few names must wrap in full");
      if (viewport.width === 1920 && count <= 9) {
        assert.ok(stats.scrollHeight <= stats.clientHeight + 1, `${count} names should fit without scrolling`);
        assert.ok(stats.font >= (count === 1 ? 56 : count === 2 ? 48 : count <= 4 ? 40 : 30));
      }
      if (count === 4 && viewport.width === 1920) {
        const baseline = await page.locator(".lottery-prize-image img").evaluate(image => {
          image.style.cssText = "width:auto;max-width:280px;max-height:min(19vh,220px)";
          const rect = image.getBoundingClientRect().toJSON(); image.removeAttribute("style"); return rect;
        });
        assert.ok(Math.abs(stats.image.width / baseline.width - 2) < .01, "prize image width must double");
        assert.ok(Math.abs(stats.image.height / baseline.height - 2) < .01, "prize image height must double");
      }
      if (count === 4) await page.screenshot({ path: fileURLToPath(new URL(`four-${viewport.width}.png`, output)) });
      if (count === 60) {
        assert.ok(stats.scrollHeight > stats.clientHeight, "large lists should scroll within the grid");
        await page.locator(".winner-grid").evaluate(grid => { grid.scrollTop = grid.scrollHeight; });
        const last = await page.locator(".winner-grid > div:last-child").boundingBox();
        assert.ok(last.y + last.height <= stats.grid.bottom + 1, "last winner must be reachable");
      }
      reports.push({ count, ...stats });
    }
    assert.ok(requests.every(request => request.method === "GET"), "review must be read-only");
    assert.deepEqual(errors, []);
    await page.close();
  }
  // Exercise the same four-name layout through ready, rolling, revealed and history states.
  const { page, errors, requests } = await open({ width: 1366, height: 768 }, true);
  checkFrame(await measure(page));
  await page.getByRole("button", { name: "开始抽奖", exact: true }).click();
  await page.locator(".winner-grid.rolling").waitFor();
  const rolling = await measure(page); checkFrame(rolling);
  await page.getByRole("button", { name: "停止并揭晓", exact: true }).click();
  await page.locator(".winner-grid.done").waitFor();
  const revealed = await measure(page); checkFrame(revealed);
  await page.getByRole("button", { name: "完成本轮抽奖", exact: true }).click();
  await page.locator(".winner-grid.finished").waitFor();
  const history = await measure(page); checkFrame(history);
  assert.deepEqual([rolling, revealed, history].map(stats => [stats.density, stats.columns, stats.font]), Array(3).fill(["few", 2, rolling.font]));
  assert.equal(requests.filter(request => request.method === "POST").length, 2);
  // The actual collapsible header must leave the enlarged prize and action accessible.
  await page.getByRole("button", { name: "展开顶部栏", exact: true }).focus();
  await page.getByRole("button", { name: "展开顶部栏", exact: true }).press("Enter");
  await page.waitForFunction(() => Math.abs(document.querySelector(".screen-header").getBoundingClientRect().height - 74) < 1);
  checkFrame(await measure(page));
  assert.deepEqual(errors, []);
  reports.push({ lifecycle: [rolling, revealed, history] });
  await page.close();
  await writeFile(new URL("report.json", output), JSON.stringify(reports, null, 2));
  console.log("PASS: 27 responsive count/image cases; left-aligned names with fixed number columns; exact 2x prize size; full long names; scroll reachability; rolling/reveal/history; open header. Synthetic HTTP only; no image build or deployment.");
} finally {
  await browser?.close();
  await server.close();
}
