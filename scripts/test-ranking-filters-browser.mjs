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
await writeFile(new URL("index.html", fixture), '<html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="/work/ranking-filters/fixture.jsx"></script></html>');
await writeFile(new URL("fixture.jsx", fixture), `
import React from "react";
import { createRoot } from "react-dom/client";
import { RankingBoard } from "/app/features/screens/RankingBoard.tsx";
import "/app/globals.css";
const activity={id:1,code:"synthetic",status:"ACTIVE",regions:[],availableCustomerTypes:["GENERAL","SPECIAL"]};
createRoot(document.getElementById("root")).render(<React.StrictMode><RankingBoard activity={activity}/></React.StrictMode>);
`);
const server = await createServer({ root, configFile: false, plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_ACTIVITY_CODE": JSON.stringify("synthetic"), "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
  server: { host: "127.0.0.1", port: 4181, strictPort: true }, cacheDir: fileURLToPath(new URL("vite-cache", fixture)) });
let browser, page;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_PATH ? { executablePath: process.env.ORDER_SHOW_BROWSER_PATH } : {}) });
  page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [], requests = [];
  let fail = false, optionsFail = false, slowGeneral = false;
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
    return route.fulfill({ json: { data: { activityId: 1, status: "ACTIVE", totals: { total_amount: amount, total_tons: 2.3 },
      companies: Array.from({length:90},(_,i)=>({rank:i+1,name:`合成客户${i+1}`,amount:amount-i,quantity:20,tons:2.3})),
      branches: Array.from({length:30},(_,i)=>({rank:i+1,name:`合成分公司${i+1}`,amount:amount-i,quantity:20,tons:2.3})),
      productLines: [], latestOrders: [], version: "1", generatedAt: "2026-10-31T08:00:00Z" } } });
  });
  const stats = () => requests.filter(url => new URL(url,"http://test").pathname.endsWith("/ranking"));
  const optionReads = () => requests.filter(url => new URL(url,"http://test").pathname.endsWith("/options"));
  await page.goto("http://127.0.0.1:4181/work/ranking-filters/index.html");
  const confirm = page.getByRole("button", { name: "确认查询", exact: true });
  await confirm.waitFor(); await page.getByLabel("大区", {exact:true}).locator("option", {hasText:"华西"}).waitFor({state:"attached"});
  assert.equal(stats().length, 0);
  assert.equal(await page.getByRole("button", { name: "↻ 手动刷新" }).isDisabled(), true);
  await confirm.click(); await page.locator(".ranking-applied").filter({hasText:"当前结果"}).waitFor();
  assert.equal(stats().length,1);
  const applied = await page.locator(".ranking-applied").textContent();
  await page.getByLabel("大区", {exact:true}).selectOption({label:"华西"});
  await page.getByRole("tab",{name:"吨数排行",exact:true}).click();
  const dropdown=page.getByLabel("品种多选",{exact:true});
  await dropdown.click();
  await page.getByRole("checkbox",{name:"特渠品种",exact:true}).check();
  await page.getByRole("checkbox",{name:"品种,B",exact:true}).check();
  assert.equal(stats().length,1);
  await dropdown.click();
  await page.getByRole("button", { name: "↻ 手动刷新" }).click();
  await confirm.waitFor();
  assert.equal(stats().length,2); assert.equal(stats()[0],stats()[1]);
  assert.equal(await page.locator(".ranking-applied").textContent(),applied);
  await confirm.click();
  await page.locator(".ranking-applied").filter({hasText:"华西"}).waitFor();
  const query=new URL(stats().at(-1),"http://test").searchParams;
  assert.equal(query.get("metric"),"TONS"); assert.equal(query.get("regionCode"),"WEST");
  assert.deepEqual(query.getAll("varieties"),["特渠品种","品种,B"]);
  const successful = await page.locator(".ranking-applied").textContent();
  const time = await page.locator(".screen-refresh-controls small").textContent();
  fail=true;
  await page.getByLabel("项目组", {exact:true}).selectOption({label:"其他"});
  await confirm.click(); await page.getByRole("alert").filter({hasText:"模拟查询失败"}).waitFor();
  assert.equal(await page.locator(".ranking-applied").textContent(),successful);
  assert.equal(await page.locator(".screen-refresh-controls small").textContent(),time);
  fail=false;
  await page.getByRole("button",{name:"重置",exact:true}).click();
  const beforeReset=stats().length;
  assert.equal(await page.getByLabel("大区",{exact:true}).inputValue(),"all");
  assert.equal(stats().length,beforeReset);
  await confirm.click(); await page.locator(".ranking-applied").filter({hasText:"全部客户 · 大区：全部"}).waitFor();
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
  await confirm.click(); await page.locator(".ranking-applied").filter({hasText:"特渠专业客户 · 大区：未填写"}).waitFor();
  const blankQuery=new URL(stats().at(-1),"http://test").searchParams;
  assert.equal(blankQuery.get("regionUnassigned"),"true"); assert.equal(blankQuery.has("regionCode"),false);
  assert.deepEqual(blankQuery.getAll("varieties"),["特渠品种"]);
  await page.getByLabel("大区",{exact:true}).selectOption("value:WEST");
  assert.equal(await page.getByLabel("项目组",{exact:true}).inputValue(),"all");
  assert.match(await dropdown.textContent(),/全部/);
  const retained=await page.locator(".ranking-applied").textContent();
  optionsFail=true;
  await page.getByLabel("客户类型",{exact:true}).selectOption("GENERAL");
  await page.getByRole("alert").filter({hasText:"模拟选项失败"}).waitFor();
  assert.equal(await confirm.isDisabled(),true);
  assert.equal(await page.locator(".ranking-applied").textContent(),retained);
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
  await confirm.click(); await page.locator(".ranking-applied").filter({hasText:"全部客户 · 大区：全部"}).waitFor();
  await dropdown.click();
  assert.equal(await page.getByRole("checkbox",{name:"未填写",exact:true}).count(),1);
  assert.equal(await page.getByRole("checkbox",{name:"未填写（品种名称）",exact:true}).count(),1);
  await dropdown.click();
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
  console.log("PASS real React/HTTP: scoped type/region/project/variety cascade; descendant reset; explicit blank flags and literal labels; stale option cancellation and retry; no initial stats, confirm, manual refresh, amount/tons, comma varieties; dropdown at 1920/1440/768/440; no page errors");
} catch(error) {
  if(page) { await writeFile(new URL("failure.html",output),await page.content()); await page.screenshot({path:fileURLToPath(new URL("failure.png",output)),fullPage:true}); }
  throw error;
} finally { await browser?.close(); await server.close(); }
