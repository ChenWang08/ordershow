import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("../work/order-export-browser/", import.meta.url);
const output = new URL("../outputs/order-export-browser/", import.meta.url);
await mkdir(fixture, { recursive: true }); await mkdir(output, { recursive: true });
const browserTemp = fileURLToPath(new URL("browser-temp/", fixture)); await mkdir(browserTemp, { recursive: true });
process.env.TEMP = browserTemp; process.env.TMP = browserTemp;
await writeFile(new URL("index.html", fixture), '<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/work/order-export-browser/fixture.jsx"></script></html>');
await writeFile(new URL("fixture.jsx", fixture), `
import React from 'react';import {createRoot} from 'react-dom/client';
import {OrderFilterBar} from '/app/components/orders/OrderFilterBar.tsx';
import {OrderExportPanel} from '/app/components/orders/OrderExportPanel.tsx';
import {useOrderExports} from '/app/components/orders/useOrderExports.ts';import '/app/globals.css';
const params=new URLSearchParams(location.search),canExport=params.get('role')!=='dept',finished=params.get('state')!=='closed';
function App(){const exports=useOrderExports(7,1,canExport&&finished,true,{status:'SUBMITTED',customerType:'GENERAL',keyword:'测试客户'});
const model={activityId:7,canExport,activityFinished:finished,activityStarted:true,activityClosed:true,readOnly:true,exports,orderCounts:{all:4000,submitted:4000,withdrawn:0,voided:0},orderFilter:'已提交',customerType:'综合',search:'测试客户',setOrderFilter(){},setCustomerType(){},setSearch(){},setPage(){},refreshOrders(){}};
return <main className="admin-panel" style={{margin:16,padding:16,minWidth:0}}><OrderFilterBar model={model}/><OrderExportPanel model={model}/></main>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`);
const server = await createServer({ root, configFile: false, plugins: [react()], define: { "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
  server: { host: "127.0.0.1", port: 4198, strictPort: true }, cacheDir: fileURLToPath(new URL("vite-cache", fixture)) });
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "../work/lottery-order/browser/node_modules/playwright/index.mjs");
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_PATH ? { executablePath: process.env.ORDER_SHOW_BROWSER_PATH } : {}) });
  const report = [];
  for (const width of [1440, 440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } }); await page.clock.install();
    const requests = [], errors = []; let tasks = [], status = "PENDING", delayCreate;
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/api/v1/**", async route => {
      const req = route.request(), path = new URL(req.url()).pathname; requests.push({ method: req.method(), path });
      assert.equal(path, "/api/v1/admin/activities/7/exports");
      if (req.method() === "POST") {
        assert.equal(req.postDataJSON().exportType, "ORDER_PACKAGE"); assert.equal(req.postDataJSON().filters.keyword, "测试客户");
        assert.ok(req.headers()["idempotency-key"]); if (delayCreate) await delayCreate;
        tasks = [{ id: 1, activityId: 7, status, stage: "READING", filters: req.postDataJSON().filters, orderCount: 4000, detailCount: 200000, sheetCounts: [], createdAt: "2026-11-03T01:00:00Z" }];
        await route.fulfill({ status: 202, json: { data: tasks[0] } });
      } else {
        const rows = tasks.map(t => ({ ...t, status, stage: status === "COMPLETED" ? "COMPLETED" : "READING",
          ...(status === "COMPLETED" ? { sheetCounts: [4000, 200000, 50, 6], snapshotAt: "2026-11-03T01:00:00Z", expiresAt: "2099-01-01T00:00:00Z" } : {}) }));
        await route.fulfill({ json: { data: rows } });
      }
    });
    const url = "http://127.0.0.1:4198/work/order-export-browser/index.html";
    await page.goto(url); await page.getByText("暂无导出任务", { exact: false }).waitFor();
    let release; delayCreate = new Promise(resolve => { release = resolve; });
    await page.getByRole("button", { name: "导出订单", exact: true }).click();
    await page.getByRole("button", { name: "正在提交…", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "正在提交…" }).isDisabled(), true); release();
    await page.getByText("#1 · 排队中").waitFor();
    assert.equal(requests.filter(r => r.method === "POST").length, 1);
    status = "COMPLETED";
    await page.getByRole("button", { name: "刷新导出记录" }).click();
    const link = page.getByRole("link", { name: "下载 ZIP" }); await link.waitFor();
    assert.equal(await link.getAttribute("href"), "/api/v1/admin/activities/7/exports/1/download");
    await page.getByText("有效商品 50 行", { exact: false }).waitFor();
    await page.getByText("用 Excel 打开 CSV 的提示").click();
    await page.getByText("设为文本", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: fileURLToPath(new URL(width + "-completed.png", output)), fullPage: true });
    const before = requests.length; await page.clock.fastForward(20000); assert.equal(requests.length, before);
    await page.reload(); await page.getByRole("link", { name: "下载 ZIP" }).waitFor();
    await page.goto(url + "?role=dept"); assert.equal(await page.getByRole("button", { name: "导出订单", exact: true }).count(), 0);
    const deniedBefore = requests.length; await page.clock.fastForward(20000); assert.equal(requests.length, deniedBefore);
    await page.goto(url + "?state=closed"); await page.getByRole("button", { name: "导出订单", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "导出订单", exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []); report.push({ width, requests, errors }); await page.close();
  }
  await writeFile(new URL("report.json", output), JSON.stringify(report, null, 2));
  console.log("Order export browser checks passed at 1440px and 440px.");
} finally { await browser?.close(); await server.close(); }
