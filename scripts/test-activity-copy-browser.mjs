import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("../work/activity-copy/", import.meta.url);
const output = new URL("../outputs/activity-copy-browser/", import.meta.url);
await mkdir(fixture, { recursive: true }); await mkdir(output, { recursive: true });
const temporary = fileURLToPath(new URL("browser-temp/", fixture)); await mkdir(temporary, { recursive: true });
process.env.TEMP = temporary; process.env.TMP = temporary;
await writeFile(new URL("index.html", fixture), '<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/work/activity-copy/fixture.jsx"></script></html>');
await writeFile(new URL("fixture.jsx", fixture), `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {AdminIdentityContext} from '/app/admin-context.ts';
import {NewActivityDrawer} from '/app/features/admin/NewActivityDrawer.tsx';
import {useAdminActivities} from '/app/features/admin/useAdminActivities.ts'; import '/app/globals.css';
const role=new URLSearchParams(location.search).get('role')||'SUPER_ADMIN';
function App(){const [notice,setNotice]=React.useState('');const activities=useAdminActivities({activityId:'',activityCode:'',setActionNotice:setNotice,initialActivities:[]});
return <main style={{padding:24}}><h1>活动管理</h1><button onClick={activities.openNewActivity}>新建活动</button><p role="alert">{notice}</p>{activities.newActivityOpen&&<NewActivityDrawer activities={activities}/>}</main>}
createRoot(document.getElementById('root')).render(<AdminIdentityContext.Provider value={{id:1,roleCode:role,departmentId:role==='SUPER_ADMIN'?null:1,permissions:[]}}><App/></AdminIdentityContext.Provider>);
`);
const server = await createServer({ root, configFile: false, plugins: [react(), { name: "copy-test-result", configureServer(s) {
  s.middlewares.use((req, res, next) => { if (req.url === "/admin") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end("<h1>新活动管理</h1>"); } else next(); });
} }], define: { "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
server: { host: "127.0.0.1", port: 4198, strictPort: true }, cacheDir: fileURLToPath(new URL("vite-cache", fixture)) });
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "../work/lottery-order/browser/node_modules/playwright/index.mjs");
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_PATH ? { executablePath: process.env.ORDER_SHOW_BROWSER_PATH } : {}) });
  const report = [];
  for (const width of [1440, 440]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    await page.clock.install();
    const requests = [], errors = [], submissions = []; let state = "RUNNING", loseResponse = true;
    const task = () => ({ id: 10, status: state, stage: "IMAGES", totalFiles: 2, copiedFiles: 1,
      failureMessage: state === "FAILED" ? "测试图片存储暂时不可用" : undefined, activityCode: state === "COMPLETED" ? "NEW" : undefined });
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/v1/**", async route => {
      const req = route.request(), url = new URL(req.url()), path = url.pathname;
      requests.push({ path, method: req.method(), search: url.search }); let data;
      if (path.endsWith("/departments")) data = [{ id: 1, name: "销售一部", code: "D1", status: "ACTIVE" }, { id: 2, name: "销售二部", code: "D2", status: "ACTIVE" }];
      else if (path.endsWith("/activity-copy-sources")) data = url.searchParams.get("departmentId") === "1" ? [{ id: 7, name: "上届订货会", code: "OLD7", status: "ARCHIVED" }, { id: 8, name: "仅商品活动", code: "OLD8", status: "FINISHED" }] : [];
      else if (path.endsWith("/copy-preview")) data = { sourceId: path.includes("/7/") ? 7 : 8, sourceName: "上届订货会", stamp: "saved-stamp", products: 180, customers: path.includes("/7/") ? 320 : 0, rounds: path.includes("/7/") ? 8 : 0 };
      else if (path === "/api/v1/admin/activity-copies") {
        submissions.push(req.postDataJSON()); if (loseResponse) { loseResponse = false; await route.abort("failed"); return; } data = task();
      } else if (path.endsWith("/retry")) { state = "RUNNING"; data = task(); }
      else if (path === "/api/v1/admin/activity-copies/10") data = task();
      else throw new Error("Unexpected copy request: " + path);
      await route.fulfill({ json: { data } });
    });
    const url = "http://127.0.0.1:4198/work/activity-copy/index.html";
    await page.goto(url); await page.getByRole("button", { name: "新建活动", exact: true }).click();
    const copyReads = () => requests.filter(r => /copy-(sources|preview)|activity-copies/.test(r.path)).length;
    await page.clock.fastForward(10000); assert.equal(copyReads(), 0);
    const reuse = page.getByRole("checkbox", { name: "复用历史活动配置", exact: true });
    assert.equal(await reuse.isChecked(), false); assert.equal(await reuse.isDisabled(), true);
    await page.getByLabel("所属部门 *").selectOption("1"); await reuse.check();
    await page.getByLabel("来源活动").selectOption("8");
    await page.getByText("暂无配置", { exact: true }).first().waitFor();
    assert.equal(await page.getByRole("checkbox", { name: /抽奖配置/ }).isDisabled(), true);
    assert.equal(await page.getByRole("checkbox", { name: /白名单/ }).isDisabled(), true);
    await page.getByLabel("所属部门 *").selectOption("2");
    await page.getByText("该部门暂无可复用的历史活动。").waitFor();
    assert.equal(await page.getByLabel("来源活动").inputValue(), "");
    await page.getByLabel("所属部门 *").selectOption("1"); await page.getByLabel("来源活动").selectOption("7");
    await page.getByText("8 个轮次", { exact: true }).waitFor();
    await page.getByRole("checkbox", { name: /白名单/ }).uncheck();
    await page.getByLabel("活动名称 *").fill("新一届订货会");
    await page.screenshot({ path: fileURLToPath(new URL(`${width}-configuration.png`, output)), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole("button", { name: "创建草稿活动", exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.getByRole("button", { name: "确认创建结果", exact: true }).waitFor();
    assert.equal(submissions.length, 1);
    assert.deepEqual(submissions[0].selection, { products: true, whitelist: false, lottery: true });
    assert.equal(submissions[0].sourceId, 7); assert.equal(submissions[0].departmentId, 1);
    await page.reload(); await page.getByRole("button", { name: "新建活动", exact: true }).click();
    await page.getByRole("button", { name: "确认创建结果", exact: true }).click();
    await page.getByText("图片 1 / 2", { exact: true }).waitFor();
    assert.deepEqual(submissions[1], submissions[0]);
    await page.screenshot({ path: fileURLToPath(new URL(`${width}-progress.png`, output)), fullPage: true });
    state = "FAILED"; await page.clock.fastForward(2200);
    await page.getByRole("button", { name: "重试复制", exact: true }).waitFor();
    const polls = () => requests.filter(r => r.path === "/api/v1/admin/activity-copies/10").length;
    const stopped = polls(); await page.clock.fastForward(10000); assert.equal(polls(), stopped);
    await page.getByRole("button", { name: "重试复制", exact: true }).click();
    await page.getByText("正在复制活动配置及图片…", { exact: true }).waitFor();
    state = "COMPLETED"; await page.clock.fastForward(2200); await page.waitForURL("**/admin");
    const done = polls(); await page.clock.fastForward(10000); assert.equal(polls(), done);
    assert.deepEqual(errors, []); report.push({ width, requests, submissions, errors, checks: ["默认关闭与无查询", "部门隔离", "缺项禁用", "单次提交", "断网刷新恢复", "失败重试", "终态停止轮询", "无横向溢出"] }); await page.close();
  }
  const page = await browser.newPage(); const requests = [];
  await page.route("**/api/v1/**", async route => { requests.push(route.request().url()); await route.fulfill({ json: { data: [] } }); });
  await page.goto("http://127.0.0.1:4198/work/activity-copy/index.html?role=DEPARTMENT_ADMIN");
  await page.getByRole("button", { name: "新建活动", exact: true }).click();
  assert.equal(await page.getByLabel("所属部门 *").count(), 0);
  assert.equal(await page.getByRole("checkbox", { name: "复用历史活动配置", exact: true }).isDisabled(), false);
  await page.getByRole("checkbox", { name: "复用历史活动配置", exact: true }).check();
  await page.getByText("该部门暂无可复用的历史活动。").waitFor();
  assert.equal(requests.length, 1); assert.match(requests[0], /departmentId=1/); await page.close();
  await writeFile(new URL("report.json", output), JSON.stringify(report, null, 2));
  console.log("Activity configuration copy browser checks passed at 1440px and 440px, plus department administrator access.");
} finally { await browser?.close(); await server.close(); }
