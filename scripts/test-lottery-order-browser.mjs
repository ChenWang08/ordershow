import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("../work/lottery-order/", import.meta.url);
const output = new URL("../outputs/lottery-order-browser/", import.meta.url);
await mkdir(fixture, { recursive: true }); await mkdir(output, { recursive: true });
const browserTemp = fileURLToPath(new URL("browser-temp/", fixture));
await mkdir(browserTemp, { recursive: true });
process.env.TEMP = browserTemp; process.env.TMP = browserTemp;
await writeFile(new URL("index.html", fixture), '<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/work/lottery-order/fixture.jsx"></script></html>');
await writeFile(new URL("fixture.jsx", fixture), `
import React,{useState,useEffect} from "react";
import {createRoot} from "react-dom/client";
import {LotterySettings,mapLotteryRule} from "/app/features/lottery/Lottery.tsx";
import "/app/globals.css";
const rounds=Array.from({length:12},(_,i)=>({id:i+1,roundNo:i+1,name:'第'+(i+1)+'轮',prizeName:i<10?'历史奖品':'待开奖奖品'+(i+1),winnerCount:4,candidateScope:'ALL_CUSTOMERS',customerType:'ALL',minimumOrderAmount:0,qualificationMetric:'AMOUNT',probabilityMode:'EQUAL',minimumOrderBoxCount:0,excludePreviousWinners:true,status:i<10?'COMPLETED':'READY',currentAttemptNo:i<10?1:0}));
function App(){const[list,setList]=useState(()=>mapLotteryRule({id:20,revision:4,status:'PUBLISHED',rounds}));const[dirty,setDirty]=useState(false);
useEffect(()=>{window.__rounds=list;},[list]);
return <main style={{padding:24,minWidth:0}}><LotterySettings rounds={list} attendanceRows={[]} activityId={1} customerCount={100} readOnly={false} hasUnsavedChanges={dirty} onChange={next=>{setList(next);setDirty(true);}} onSaved={()=>setDirty(false)} onOrderSaved={next=>{setList(next);setDirty(false);}}/></main>}
createRoot(document.getElementById('root')).render(<App/>);
`);
const server = await createServer({ root, configFile: false, plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
  server: { host: "127.0.0.1", port: 4196, strictPort: true }, cacheDir: fileURLToPath(new URL("vite-cache", fixture)) });
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "../work/lottery-order/browser/node_modules/playwright/index.mjs");
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_PATH ? { executablePath: process.env.ORDER_SHOW_BROWSER_PATH } : {}) });
  const reports = [];
  for (const width of [1440, 440]) {
    const page = await browser.newPage({ viewport: { width, height: 1050 } });
    const requests = [], errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/v1/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      requests.push({ path, method: request.method() });
      let data;
      if (path.endsWith("/statistics")) data = { validWinnerCustomers: 40, invalidatedWinnerRecords: 0 };
      else if (path.endsWith("/round-order") && request.method() === "PUT") {
        const body = request.postDataJSON(); assert.equal(body.expectedRevision, 4);
        assert.deepEqual(body.roundIds, [1,2,3,4,5,6,7,8,9,10,12,11]);
        data = { ruleId: 20, revision: 5, status: "PUBLISHED", rounds: body.roundIds.map((id,index) => ({ id, roundNo: index+1, status: id <= 10 ? "COMPLETED" : "READY", currentAttemptNo: id <= 10 ? 1 : 0 })) };
      } else throw new Error("Unexpected API request: " + path);
      await route.fulfill({ json: { data } });
    });
    await page.goto("http://127.0.0.1:4196/work/lottery-order/index.html");
    await page.getByRole("button", { name: "拖动调整第12轮顺序", exact: true }).waitFor();
    await page.getByText("数据库当前有效", { exact: false }).waitFor();
    assert.equal(await page.getByRole("button", { name: "第10轮位置已锁定", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "上移第11轮", exact: true }).isDisabled(), true);
    // Advance an idle minute without waiting in real time: no API polling or automatic preview.
    await page.clock.install(); await page.clock.fastForward(65000);
    assert.equal(requests.length, 1); assert.ok(requests[0].path.endsWith("/statistics"));
    if (width === 1440) {
      await page.locator('[data-round-id="12"] .round-drag-handle').dragTo(page.locator('[data-round-id="11"]'));
    } else await page.getByRole("button", { name: "上移第12轮", exact: true }).click();
    await page.getByText("抽奖顺序已更新", { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__rounds.map(r => r.id)), [1,2,3,4,5,6,7,8,9,10,12,11]);
    assert.equal(await page.locator(".round-form-heading h3").textContent(), "第11轮");
    assert.equal(requests.length, 2); assert.ok(requests[1].path.endsWith("/round-order"));
    await page.clock.fastForward(65000); assert.equal(requests.length, 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    if (width === 1440) assert.ok((await page.locator(".round-form").boundingBox()).width > 400);
    await page.locator('[data-round-id="12"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: fileURLToPath(new URL(`${width}.png`, output)), fullPage: true });
    assert.deepEqual(errors, []);
    reports.push({ width, requests, errors, order: [1,2,3,4,5,6,7,8,9,10,12,11], idleMilliseconds: 130000 });
    await page.close();
  }
  await writeFile(new URL("report.json", output), JSON.stringify(reports, null, 2));
  console.log("Lottery ordering browser checks passed at 1440px and 440px; no polling or automatic preview.");
} finally { await browser?.close(); await server.close(); }
