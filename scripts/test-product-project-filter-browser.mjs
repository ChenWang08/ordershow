import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Runs the real table and project styles with synthetic data; no business API or credentials.
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("../work/product-project-filter/", import.meta.url);
const output = new URL("../outputs/product-project-filter/", import.meta.url);
await mkdir(fixture, { recursive: true }); await mkdir(output, { recursive: true });
await writeFile(new URL("index.html", fixture), '<html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="/work/product-project-filter/fixture.jsx"></script></html>');
await writeFile(new URL("fixture.jsx", fixture), `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProductImportTable } from "/app/features/admin/products/ProductImportTable.tsx";
import "/app/globals.css";
const source = Array.from({length: 70}, (_,i) => ({
  id:String(i+1), sequence:i+1, line:i<60 ? (i%2 ? "调味油" : " 调味油 ") : i<65 ? "酱油" : " ",
  materialName:"合成商品"+(i+1), materialCode:"SKU"+(i+1), customerType:"综合", rebate:"参与",
  category:"调味品", description:"", brand:"", variety:"", spec:"", casePack:"", unitPrice:"",
  casePrice:"100", conversion:"10", gift:"否", branchScope:"", status:"有效", imageStatus:"未匹配",
}));
source.push({...source[0], id:"long", line:"超长项目组名称用于验证筛选栏在窄窗口中不会挤压其他控件", materialName:"长项目组商品"});
function App() {
 const [rows,setRows]=useState(source), [activity,setActivity]=useState(1), [readOnly,setReadOnly]=useState(false), [preview,setPreview]=useState(false);
 return <section className="admin-app"><aside className="admin-sidebar">商品导入验证</aside><main className="admin-main">
 <header><b>商品导入项目组筛选</b></header><div className="admin-panel">
 <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
 <button onClick={()=>setActivity(v=>v+1)}>切换活动</button>
 <button onClick={()=>setRows(source.filter(row=>row.line.trim()!=="调味油"))}>移除调味油项目组</button>
 <button onClick={()=>setReadOnly(v=>!v)}>切换只读</button>
 <button onClick={()=>setPreview(v=>!v)}>切换预览</button>
 </div><h2>{preview ? "Excel 导入预览" : "当前活动商品"}</h2><p>全量商品 {rows.length} 条</p>
 <ProductImportTable key={activity+":"+preview} rows={rows} onEdit={()=>{}} onDelete={()=>{}} allowDelete={!readOnly} readOnly={readOnly}/>
 </div></main></section>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><App/></React.StrictMode>);
`);
const server = await createServer({ root, configFile: false, plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_ACTIVITY_CODE": JSON.stringify("synthetic-project-filter"), "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("") },
  server: { host: "127.0.0.1", port: 4177, strictPort: true },
  cacheDir: fileURLToPath(new URL("vite-cache", fixture)) });
let browser, page;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [], businessRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.url().includes("/api/v1/")) businessRequests.push(request.url()); });
  await page.goto("http://127.0.0.1:4177/work/product-project-filter/index.html");
  const group = page.getByLabel("项目组", { exact: true });
  const summary = page.locator(".product-data-filters > small");
  await group.waitFor();
  assert.deepEqual(await group.locator("option").allTextContents(), ["全部", "未填写项目组", "超长项目组名称用于验证筛选栏在窄窗口中不会挤压其他控件", "调味油", "酱油"]);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.getByRole("checkbox", { name: "全选当前页商品" }).check();
  await group.selectOption({ label: "调味油" });
  await summary.filter({ hasText: "当前显示 60 条商品 · 第 1/2 页" }).waitFor();
  assert.equal(await page.locator(".selection-toolbar").count(), 0);
  await page.getByRole("checkbox", { name: "全选当前页商品" }).check();
  await page.getByRole("button", { name: "选择全部 60 条", exact: true }).click();
  await page.getByRole("button", { name: "删除所选", exact: true }).click();
  // No actual deletion: verify the filtered count and dismiss the confirmation.
  const dialog = page.getByRole("dialog", { name: "删除商品确认" });
  await dialog.getByText("已选择 60 条", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await group.selectOption({ label: "未填写项目组" });
  await summary.filter({ hasText: "当前显示 5 条商品" }).waitFor();
  await page.getByLabel("搜索物料代码或物料名称").fill("SKU66");
  await summary.filter({ hasText: "当前显示 1 条商品" }).waitFor();
  assert.match(await summary.textContent(), /未匹配 71/);
  await page.getByLabel("搜索物料代码或物料名称").fill("不存在");
  await page.getByText("当前搜索和筛选条件下没有商品", { exact: true }).waitFor();
  await page.getByLabel("搜索物料代码或物料名称").fill("");
  await group.selectOption({ label: "调味油" });
  await page.getByRole("button", { name: "移除调味油项目组", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.product-data-filters label:nth-child(3) select')?.value === "");
  await summary.filter({ hasText: "当前显示 11 条商品" }).waitFor();
  await group.selectOption({ label: "酱油" });
  await page.getByRole("button", { name: "切换活动", exact: true }).click();
  assert.equal(await group.inputValue(), "");
  await page.getByRole("button", { name: "切换只读", exact: true }).click();
  await group.selectOption({ label: "酱油" });
  await summary.filter({ hasText: "当前显示 5 条商品" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "编辑", exact: true }).first().isDisabled(), true);
  await page.getByRole("button", { name: "切换预览", exact: true }).click();
  assert.equal(await group.inputValue(), "");
  await group.selectOption({ label: "酱油" });
  await summary.filter({ hasText: "当前显示 5 条商品" }).waitFor();
  await group.selectOption({ label: "超长项目组名称用于验证筛选栏在窄窗口中不会挤压其他控件" });
  await summary.filter({ hasText: "当前显示 1 条商品" }).waitFor();
  for (const width of [1920, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await page.locator(".product-data-filters").boundingBox();
    const controls = await page.locator(".product-data-filters select, .product-data-filters input").all();
    for (const control of controls) {
      const box = await control.boundingBox();
      assert.ok(box && box.width >= 100 && box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width + 1 && box.x + box.width <= width,
        `Filter control overflow at viewport ${width}`);
    }
    await page.screenshot({ path: fileURLToPath(new URL(`filters-${width}.png`, output)), fullPage: true });
  }
  assert.deepEqual(errors, []); assert.deepEqual(businessRequests, []);
  console.log("PASS real React: combined filters, blank groups, pagination/selection reset, filtered select-all, group removal, remount, readonly and preview");
  console.log("PASS 1920/1280/768/390 responsive controls; no uncaught page errors or business API requests");
} catch (error) {
  if (page) {
    await writeFile(new URL("failure.html", output), await page.content());
    await page.screenshot({ path: fileURLToPath(new URL("failure.png", output)), fullPage: true });
  }
  throw error;
} finally {
  await browser?.close(); await server.close();
}
