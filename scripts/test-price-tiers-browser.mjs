import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root=fileURLToPath(new URL("../",import.meta.url));
const fixture=new URL("../work/price-tiers/",import.meta.url);
const output=new URL("../outputs/price-tiers-browser/",import.meta.url);
await mkdir(fixture,{recursive:true});await mkdir(output,{recursive:true});
await writeFile(new URL("index.html",fixture),'<html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="/work/price-tiers/fixture.jsx"></script></html>');
await writeFile(new URL("fixture.jsx",fixture),`
import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {ProductFormDrawer} from "/app/features/admin/products/ProductFormDrawer.tsx";
import "/app/globals.css";
const initial={id:"1",sequence:1,customerType:"",rebate:"",category:"",line:"调味品",materialCode:"PT-1",materialName:"合成多级阶梯商品",brand:"",variety:"",spec:"4瓶/箱",casePack:"4",unitPrice:"75",casePrice:"300",conversion:"50",gift:"否",branchScope:"",status:"有效",source:"excel",priceTierMinQuantity:"500",priceTierCasePrice:"290",priceTierPricingMode:"WHOLE_ORDER",priceTiers:[{minQuantity:"500",casePrice:"290"},{minQuantity:"1000",casePrice:"280"}]};
function App(){const[open,setOpen]=useState(true);return <main className="admin-app">{open&&<ProductFormDrawer rows={[initial]} initialRow={initial} activityStarted={true} activityId={1} scopeEnabled={false} tiersEditable={true} onClose={()=>setOpen(false)} onSave={async row=>{window.__saved=row;return {ok:true}}}/>}</main>}
createRoot(document.getElementById("root")).render(<React.StrictMode><App/></React.StrictMode>);
`);
const server=await createServer({root,configFile:false,plugins:[react()],define:{"process.env.NEXT_PUBLIC_API_BASE":JSON.stringify("/api/v1")},server:{host:"127.0.0.1",port:4192,strictPort:true},cacheDir:fileURLToPath(new URL("vite-cache",fixture))});
let browser;
try {
  await server.listen();
  const {chromium}=await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE||"playwright");
  browser=await chromium.launch({headless:true,...(process.env.ORDER_SHOW_BROWSER_PATH?{executablePath:process.env.ORDER_SHOW_BROWSER_PATH}:{})});
  for(const width of [1440,390]) {
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],apiCalls=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.route("**/api/v1/**",route=>{apiCalls.push(route.request().url());return route.abort();});
    await page.goto("http://127.0.0.1:4192/work/price-tiers/index.html");
    const editor=page.getByRole("region",{name:"多级阶梯价格"});
    await editor.waitFor();await editor.scrollIntoViewIfNeeded();
    assert.match(await editor.textContent(),/336,000\.00/);
    await page.getByLabel("第 1 档箱价",{exact:true}).fill("298");
    await page.getByLabel(/^元\/箱/).fill("400");
    assert.equal(await page.getByLabel("第 1 档箱价",{exact:true}).inputValue(),"298");
    await editor.getByRole("combobox").selectOption("INCREMENTAL");
    assert.match(await editor.textContent(),/349,982\.00/);
    await page.getByRole("button",{name:"＋ 添加价格阶梯",exact:true}).click();
    await page.getByLabel("第 4 档起始箱数",{exact:true}).fill("1000");
    await page.getByLabel("第 4 档箱价",{exact:true}).fill("270");
    assert.match(await editor.textContent(),/必须|须为/);
    assert.equal(await page.getByRole("button",{name:"保存修改",exact:true}).isDisabled(),true);
    await page.getByLabel("第 4 档起始箱数",{exact:true}).fill("2000");
    await page.getByLabel("试算箱数",{exact:true}).fill("2200");
    assert.match(await editor.textContent(),/627,972\.00/);
    await page.getByLabel("修改原因（必填）",{exact:true}).fill("隔离浏览器验证");
    assert.equal(await page.getByRole("button",{name:"保存修改",exact:true}).isEnabled(),true);
    for(const input of await editor.locator("input,select,button").all()) {
      const box=await input.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1,`Control overflows ${width}px viewport`);
    }
    await editor.scrollIntoViewIfNeeded();
    await page.screenshot({path:fileURLToPath(new URL(`tiers-${width}.png`,output)),fullPage:true});
    await editor.getByRole("button",{name:"删除",exact:true}).nth(1).click();
    assert.equal(await editor.locator(".price-tier-entry").count(),3);
    assert.match(await editor.textContent(),/637,972\.00/);
    await page.getByRole("button",{name:"保存修改",exact:true}).click();
    await page.waitForFunction(()=>window.__saved);
    const saved=await page.evaluate(()=>window.__saved);
    assert.deepEqual(saved.priceTiers,[{minQuantity:"1",casePrice:"298"},{minQuantity:"500",casePrice:"290"},{minQuantity:"2000",casePrice:"270"}]);
    assert.equal(saved.casePrice,"400");
    assert.equal(saved.priceTierPricingMode,"INCREMENTAL");assert.deepEqual(errors,[]);assert.deepEqual(apiCalls,[]);
    console.log(`PASS ${width}px: independent first price, ordinary-price independence, both pricing modes, local trial, invalid thresholds, adding/deleting/saving, zero business API requests`);
    await page.close();
  }
} finally {await browser?.close();await server.close();}
