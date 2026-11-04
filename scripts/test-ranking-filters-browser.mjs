import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Real React and project styles, synthetic HTTP responses. Never contacts a business service.
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("../work/ranking-filters/", import.meta.url);
const output = new URL("../outputs/ranking-filters/", import.meta.url);
await mkdir(fixture, { recursive: true }); await mkdir(output, { recursive: true });
const browserTemp = fileURLToPath(new URL("browser-temp/", fixture));
await mkdir(browserTemp, { recursive: true });
process.env.TEMP = browserTemp;
process.env.TMP = browserTemp;
await writeFile(new URL("index.html", fixture), '<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/work/ranking-filters/fixture.jsx"></script></html>');
await writeFile(new URL("fixture.jsx", fixture), `
import React from "react";
import { createRoot } from "react-dom/client";
import { RankingBoard } from "/app/features/screens/RankingBoard.tsx";
import { CollapsibleScreenHeader } from "/app/components/CollapsibleScreenHeader.tsx";
import "/app/globals.css";
const activity={id:1,code:"synthetic",status:"ACTIVE",regions:[],availableCustomerTypes:["GENERAL","SPECIAL"]};
createRoot(document.getElementById("root")).render(<React.StrictMode>
  <main className="prototype-root collapsible-screen">
    <CollapsibleScreenHeader><nav className="prototype-nav">订货排行测试</nav></CollapsibleScreenHeader>
    <div className="prototype-canvas"><RankingBoard activity={activity}/></div>
  </main>
</React.StrictMode>);
`);
const server = await createServer({ root, configFile: false, plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_ACTIVITY_CODE": JSON.stringify("synthetic"), "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
  server: { host: "127.0.0.1", port: 4181, strictPort: true }, cacheDir: fileURLToPath(new URL("vite-cache", fixture)) });
let browser, page;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || new URL("../work/lottery-order/browser/node_modules/playwright/index.mjs", import.meta.url).href);
  browser = await chromium.launch({ headless: true, executablePath: process.env.ORDER_SHOW_BROWSER_PATH || "C:/Users/Chen/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe" });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [], requests = [];
  let fail = false, optionsFail = false, slowGeneral = false, status = "ACTIVE", companyCount = 90, branchCount = 30;
  const options = { customers: [
    { customerType: "GENERAL", regionCode: "EAST", regionName: "华东" },
    { customerType: "SPECIAL", regionCode: "WEST", regionName: "华西" },
    { customerType: "SPECIAL", regionName: "未填写" },
    { customerType: "ALL", regionCode: null, regionName: "未填写" },
  ], products: [{ productLine: "项目A", varietyName: "品种A", customerType: "GENERAL" }, { productLine: "项目A", varietyName: "品种,B" },
    { productLine: "项目A", varietyName: "特渠品种", customerType: "SPECIAL" },
    { productLine: "未填写", varietyName: "未填写" },
    { productLine: "其他", varietyName: "ALL" }, { productLine: null, varietyName: null },
    ...Array.from({ length: 35 }, (_,i) => ({ productLine: "项目B", varietyName: `其他品种${i}` }))] };
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);
    if (url.pathname.endsWith("/options")) {
      if (optionsFail) return route.fulfill({status:500,json:{message:"模拟选项失败"}});
      if (slowGeneral && url.searchParams.get("customerType")==="GENERAL") await new Promise(resolve=>setTimeout(resolve,200));
      const type=url.searchParams.get("customerType") || "ALL";
      const customers=options.customers.filter(c=>(type==="ALL" || c.customerType===type)
        && (!url.searchParams.has("regionCode") || c.regionCode===url.searchParams.get("regionCode"))
        && (!url.searchParams.has("regionUnassigned") || c.regionCode==null));
      const products=customers.length ? options.products.filter(p=>customers.some(c=>!p.customerType || p.customerType===c.customerType))
        .map(({productLine,varietyName})=>({productLine,varietyName})) : [];
      try { return await route.fulfill({json:{data:{customers:options.customers,products}}}); }
      catch(error) { if (!slowGeneral) throw error; }
      return;
    }
    assert.ok(url.pathname.endsWith("/ranking"), `Unexpected API: ${url.pathname}`);
    if (fail) return route.fulfill({ status: 500, json: { message: "模拟查询失败" } });
    const amount = url.searchParams.has("regionCode") ? 150 : 1000;
    return route.fulfill({ json: { data: { activityId: 1, status, totals: { total_amount: amount, total_tons: 2.3 },
      companies: Array.from({length:companyCount},(_,i)=>({rank:i+1,name:`合成客户${i+1}`,amount:amount-i,quantity:20,tons:2.3})),
      branches: Array.from({length:branchCount},(_,i)=>({rank:i+1,name:`合成分公司${i+1}`,amount:amount-i,quantity:20,tons:2.3})),
      productLines: [], latestOrders: [], version: "1", generatedAt: "2026-10-31T08:00:00Z" } } });
  });
  const stats = () => requests.filter(url => new URL(url,"http://test").pathname.endsWith("/ranking"));
  const optionReads = () => requests.filter(url => new URL(url,"http://test").pathname.endsWith("/options"));
  await page.goto("http://127.0.0.1:4181/work/ranking-filters/index.html");
  const confirm = page.getByRole("button", { name: "确认查询", exact: true });
  const refresh = page.getByRole("button", { name: "手动刷新", exact: true });
  async function readRanking(button = confirm) {
    await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/ranking")), button.click()]);
    await page.waitForFunction(() => document.querySelector(".ranking-refresh-controls")?.getAttribute("aria-busy") === "false");
  }
  await confirm.waitFor(); await page.getByLabel("大区", {exact:true}).locator("option", {hasText:"华西"}).waitFor({state:"attached"});
  assert.equal(stats().length, 0);
  assert.equal(await refresh.isDisabled(), true);
  await readRanking();
  assert.equal(stats().length,1);
  const applied = await page.locator(".ranking-layout").innerText();
  await page.getByLabel("大区", {exact:true}).selectOption({label:"华西"});
  await page.getByRole("tab",{name:"吨数排行",exact:true}).click();
  const dropdown=page.getByLabel("品种多选",{exact:true});
  await dropdown.click();
  await page.getByRole("checkbox",{name:"特渠品种",exact:true}).check();
  await page.getByRole("checkbox",{name:"品种,B",exact:true}).check();
  assert.equal(stats().length,1);
  await dropdown.click();
  await readRanking(refresh);
  assert.equal(stats().length,2); assert.equal(stats()[0],stats()[1]);
  assert.equal(await page.locator(".ranking-layout").innerText(),applied);
  await readRanking();
  const query=new URL(stats().at(-1),"http://test").searchParams;
  assert.equal(query.get("metric"),"TONS"); assert.equal(query.get("regionCode"),"WEST");
  assert.deepEqual(query.getAll("varieties"),["特渠品种","品种,B"]);
  const successful = await page.locator(".ranking-layout").innerText();
  const time = await page.locator(".screen-refresh-controls small").textContent();
  fail=true;
  await page.getByLabel("项目组", {exact:true}).selectOption({label:"其他"});
  await confirm.click(); await page.getByRole("alert").filter({hasText:"模拟查询失败"}).waitFor();
  assert.equal(await page.locator(".ranking-layout").innerText(),successful);
  assert.equal(await page.locator(".screen-refresh-controls small").textContent(),time);
  fail=false;
  await page.getByRole("button",{name:"重置",exact:true}).click();
  const beforeReset=stats().length;
  assert.equal(await page.getByLabel("大区",{exact:true}).inputValue(),"all");
  assert.equal(stats().length,beforeReset);
  await readRanking();
  const beforeCascade=stats().length;
  await page.getByLabel("客户类型",{exact:true}).selectOption("SPECIAL");
  assert.equal(await page.getByLabel("大区",{exact:true}).locator('option[value="value:EAST"]').count(),0);
  await page.getByLabel("大区",{exact:true}).selectOption("empty");
  await page.getByLabel("项目组",{exact:true}).selectOption({label:"项目A"});
  const beforeProject=optionReads().length;
  await dropdown.click();
  assert.equal(await page.getByRole("checkbox",{name:"品种A",exact:true}).count(),0);
  assert.equal(await page.getByRole("checkbox",{name:"其他品种0",exact:true}).count(),0);
  await page.getByRole("checkbox",{name:"特渠品种",exact:true}).check();
  await dropdown.click();
  assert.equal(stats().length,beforeCascade); assert.equal(optionReads().length,beforeProject);
  await readRanking();
  const blankQuery=new URL(stats().at(-1),"http://test").searchParams;
  assert.equal(blankQuery.get("regionUnassigned"),"true"); assert.equal(blankQuery.has("regionCode"),false);
  assert.deepEqual(blankQuery.getAll("varieties"),["特渠品种"]);
  await page.getByLabel("大区",{exact:true}).selectOption("value:WEST");
  assert.equal(await page.getByLabel("项目组",{exact:true}).inputValue(),"all");
  assert.match(await dropdown.textContent(),/全部/);
  const retained=await page.locator(".ranking-layout").innerText();
  optionsFail=true;
  await page.getByLabel("客户类型",{exact:true}).selectOption("GENERAL");
  await page.getByRole("alert").filter({hasText:"模拟选项失败"}).waitFor();
  assert.equal(await confirm.isDisabled(),true);
  assert.equal(await page.locator(".ranking-layout").innerText(),retained);
  optionsFail=false;
  await page.getByRole("button",{name:"重试选项",exact:true}).click();
  await page.getByLabel("项目组",{exact:true}).selectOption({label:"项目A"});
  await dropdown.click();
  assert.equal(await page.getByRole("checkbox",{name:"品种A",exact:true}).count(),1);
  assert.equal(await page.getByRole("checkbox",{name:"特渠品种",exact:true}).count(),0);
  await dropdown.click();
  slowGeneral=true;
  await page.getByLabel("客户类型",{exact:true}).selectOption("SPECIAL");
  await page.getByLabel("客户类型",{exact:true}).selectOption("GENERAL");
  await page.getByLabel("客户类型",{exact:true}).selectOption("SPECIAL");
  await page.getByLabel("项目组",{exact:true}).selectOption({label:"项目A"});
  await page.waitForTimeout(250);
  await dropdown.click();
  assert.equal(await page.getByRole("checkbox",{name:"特渠品种",exact:true}).count(),1);
  assert.equal(await page.getByRole("checkbox",{name:"品种A",exact:true}).count(),0);
  await dropdown.click();
  await page.getByRole("button",{name:"重置",exact:true}).click();
  await readRanking();
  await dropdown.click();
  assert.equal(await page.getByRole("checkbox",{name:"未填写",exact:true}).count(),1);
  assert.equal(await page.getByRole("checkbox",{name:"未填写（品种名称）",exact:true}).count(),1);
  await dropdown.click();
  // Verify the actual viewport shell, original typography, and every visible ranking row.
  const layouts = [];
  async function verifyLayout(width, height, metric, headerOpen = false) {
    await page.setViewportSize({ width, height });
    await page.getByRole("tab", { name: metric === "AMOUNT" ? "金额排行" : "吨数排行", exact: true }).click();
    await readRanking();
    if (headerOpen) {
      // Keep the pointer in the panel while measuring; moving to the toolbar starts its normal auto-close timer.
      if (await page.locator(".screen-header").getAttribute("data-open") !== "true") {
        await page.getByRole("button", { name: "展开顶部栏", exact: true }).evaluate(button => button.click());
      }
      await page.locator(".screen-header .prototype-nav").hover();
      await page.waitForFunction(() => document.querySelector(".screen-header").getBoundingClientRect().height === 74);
    }
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const rect = selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const styles = selector => {
        const s = getComputedStyle(document.querySelector(selector));
        return { size: s.fontSize, family: s.fontFamily, weight: s.fontWeight };
      };
      const canvas = document.querySelector(".prototype-canvas");
      return {
        switch: rect(".ranking-metric-switch"), filters: rect(".ranking-filters"), totals: rect(".ranking-totals"), ranking: rect(".ranking-layout"),
        firstFilter: rect(".ranking-filters > label"), firstSelect: rect(".ranking-filters > label select"), amount: rect(".ranking-totals .screen-metric:first-child"), tons: rect(".ranking-totals .screen-metric:last-child"),
        toolbarOrder: [...document.querySelector(".ranking-filters").children].map(el => el.getAttribute("aria-label") || el.textContent),
        totalAlignment: [...document.querySelectorAll(".ranking-totals .screen-metric")].map(el => getComputedStyle(el).textAlign),
        reset: rect(".ranking-filters > button:last-of-type"), refresh: rect(".ranking-refresh-controls button"), time: rect(".ranking-refresh-controls small"),
        fonts: Object.fromEntries([".ranking-metric-switch button", ".ranking-filters > label", ".ranking-filters select", ".ranking-confirm", ".screen-metric span", ".screen-metric strong", ".screen-metric strong small", ".rank-column h2", ".rank-column h2 small", ".rank-row b", ".rank-row strong", ".branch-row b", ".branch-row strong", ".ranking-refresh-controls small"].map(selector => [selector, styles(selector)])),
        rows: [...document.querySelectorAll(".rank-row, .branch-row")].map(el => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height };
        }),
        canvas: rect(".prototype-canvas"), scrollHeight: canvas.scrollHeight, clientHeight: canvas.clientHeight,
        scrollWidth: canvas.scrollWidth, clientWidth: canvas.clientWidth,
        text: document.querySelector(".ranking-board").innerText,
      };
    });
    assert.equal(layout.toolbarOrder[0], "排行口径", "Switch is the first toolbar control");
    assert.match(layout.toolbarOrder[1], /^客户类型/, "Customer type immediately follows the switch");
    assert.ok(layout.switch.right < layout.firstFilter.x, "Switch is left of customer type");
    assert.ok(Math.abs(layout.switch.y + layout.switch.height / 2 - layout.firstSelect.y - layout.firstSelect.height / 2) <= 1, "Switch shares the filter control centerline");
    assert.ok(layout.switch.y >= layout.filters.y && layout.switch.bottom <= layout.filters.bottom + 1, "Switch is inside the same toolbar row");
    assert.ok(Math.abs(layout.time.right - layout.filters.right) <= 1, "Filter toolbar aligns to the right");
    assert.ok(layout.switch.x > layout.filters.x, "Right-aligned toolbar leaves free space to its left");
    assert.ok(Math.abs((layout.amount.x + layout.tons.right) / 2 - width / 2) <= 1, "Amount and tonnage are centered as a pair across the full page");
    assert.ok(Math.abs(layout.amount.y - layout.tons.y) <= 1, "Totals stay side by side");
    assert.ok(layout.amount.right < layout.tons.x, "Centered totals have a visible gap");
    assert.deepEqual(layout.totalAlignment, ["center", "center"], "Both totals use centered text");
    assert.ok(layout.filters.bottom <= layout.totals.y, "Filters are above totals");
    assert.ok(layout.totals.bottom <= layout.ranking.y, "Totals are above rankings");
    assert.ok(layout.refresh.x >= layout.reset.right, "Refresh follows reset");
    assert.ok(layout.time.x >= layout.refresh.right && layout.time.y < layout.refresh.bottom, "Refresh time stays beside the button");
    assert.ok(layout.filters.height < 60, "All filters and actions remain on one row");
    assert.equal(layout.rows.length, 120, "All 90 customers and 30 branches render");
    assert.ok(layout.scrollHeight <= layout.clientHeight + 1, `No vertical overflow at ${width}x${height}: ${layout.scrollHeight}/${layout.clientHeight}`);
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, "No horizontal overflow");
    assert.ok(layout.rows.every(row => row.top >= layout.canvas.y && row.bottom <= layout.canvas.bottom + 1), "All rows, including 30/60/90, fit inside the visible canvas");
    assert.doesNotMatch(layout.text, /客户订货排行|历史回看|当前结果：/);
    const originalSizes = [9, 11, 12, 12, 11, 31, 12, 14, 10, 11, 11, 12, 12, 10];
    Object.entries(layout.fonts).forEach(([selector, font], index) => assert.equal(font.size, `${originalSizes[index]}px`, `Original font size: ${selector}`));
    assert.equal(layout.fonts[".rank-row b"].family, "serif");
    assert.equal(layout.fonts[".rank-row b"].weight, "700");
    assert.equal(layout.fonts[".rank-row strong"].weight, "500");
    await page.screenshot({ path: fileURLToPath(new URL(`single-row-${width}x${height}-${metric}${headerOpen ? "-header-open" : ""}.png`, output)) });
    layouts.push({ width, height, metric, headerOpen, ...layout });
  }
  for (const [width, height] of [[1920, 1080], [2560, 1440], [1366, 768]]) {
    for (const metric of ["AMOUNT", "TONS"]) await verifyLayout(width, height, metric);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("button", { name: "展开顶部栏", exact: true }).evaluate(button => button.click());
  await page.waitForFunction(() => document.querySelector(".screen-header").getBoundingClientRect().height === 74);
  await verifyLayout(1920, 1080, "AMOUNT", true);
  await page.getByRole("button", { name: "收起顶部栏", exact: true }).evaluate(button => button.click());
  await page.waitForFunction(() => document.querySelector(".screen-header").getBoundingClientRect().height === 0);
  for (const historicalStatus of ["FINISHED", "ARCHIVED"]) {
    status = historicalStatus;
    await readRanking(refresh);
    assert.doesNotMatch(await page.locator(".ranking-board").innerText(), /历史回看/);
  }
  status = "ACTIVE";
  branchCount = 60;
  await readRanking(refresh);
  const branchScroller = page.locator(".branch-rank .rank-rows");
  assert.equal(await page.locator(".branch-row").count(), 60);
  assert.equal(await branchScroller.evaluate(el => el.scrollHeight > el.clientHeight), true, "Large branch lists stay accessible by scrolling");
  await page.locator(".branch-row").last().scrollIntoViewIfNeeded();
  assert.equal(await page.locator(".branch-row").last().isVisible(), true);
  branchCount = 0;
  companyCount = 0;
  await readRanking(refresh);
  assert.equal(await page.locator(".rank-row").count(), 0);
  assert.match(await page.locator(".ranking-columns").innerText(), /当前条件下暂无有效订单/);
  assert.match(await page.locator(".branch-rank").innerText(), /当前条件下暂无分公司数据/);
  for (const count of [1, 20]) {
    companyCount = count;
    branchCount = count;
    await readRanking(refresh);
    assert.equal(await page.locator(".rank-row").count(), count);
    assert.ok(await page.locator(".rank-row").first().evaluate(el => el.getBoundingClientRect().height <= 29), "Short lists keep compact rows");
    assert.ok(await page.locator(".branch-row").first().evaluate(el => el.getBoundingClientRect().height <= 29), "Short branch lists keep compact rows");
  }
  companyCount = 90;
  branchCount = 30;
  await readRanking(refresh);
  await page.setViewportSize({ width: 1366, height: 420 });
  assert.equal(await page.locator(".prototype-canvas").evaluate(el => el.scrollHeight > el.clientHeight), true, "Short windows scroll instead of shrinking fonts or hiding data");
  await page.locator(".rank-row").last().scrollIntoViewIfNeeded();
  const lastRow = await page.locator(".rank-row").last().boundingBox();
  assert.ok(lastRow.y >= 0 && lastRow.y + lastRow.height <= 421);
  assert.equal(await page.locator(".rank-row b").first().evaluate(el => getComputedStyle(el).fontSize), "11px");
  await writeFile(new URL("single-row-measurements.json", output), JSON.stringify(layouts, null, 2));
  await page.locator(".prototype-canvas").evaluate(el => el.scrollTo(0, 0));
  // Dropdown must remain above ranking rows and its scrollable options must stay inside the screen.
  for(const width of [1920,1440,768,440]) {
    await page.setViewportSize({width,height:1080});
    await dropdown.click();
    const field=page.locator(".ranking-varieties fieldset");
    const bounds=await field.boundingBox();
    assert.ok(bounds && bounds.x>=0 && bounds.x+bounds.width<=width+1,`Dropdown overflow at ${width}`);
    const topmost=await page.evaluate(() => { const el=document.querySelector('.ranking-varieties fieldset'); const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+20,r.y+55)); });
    assert.equal(topmost,true,`Dropdown obscured at ${width}`);
    await page.screenshot({path:fileURLToPath(new URL(`ranking-${width}.png`,output)),fullPage:true});
    await dropdown.click();
  }
  const beforeIdle=stats().length; await page.waitForTimeout(1100); assert.equal(stats().length,beforeIdle);
  assert.deepEqual(errors,[]);
  console.log("PASS ranking React/HTTP: cascade, confirm/reset/manual refresh, failure recovery and retained results; single right-aligned toolbar with switch before customer type, centered amount/tonnage pair and all 90+30 rows at 1920x1080/2560x1440/1366x768, both metrics, original font sizes, expanded header, no historical label, empty results, branch overflow, short-window scrolling; dropdown at 1920/1440/768/440; no initial or idle stats, no page errors");
} catch(error) {
  if(page) { await writeFile(new URL("failure.html",output),await page.content()); await page.screenshot({path:fileURLToPath(new URL("failure.png",output)),fullPage:true}); }
  throw error;
} finally { await browser?.close(); await server.close(); }
