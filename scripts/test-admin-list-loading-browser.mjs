import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Real admin components, synthetic HTTP fixtures only. No business credentials or backend.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../outputs/admin-list-loading/", import.meta.url);
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: false, plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_ACTIVITY_CODE": JSON.stringify("ADMIN_REFRESH_TEST"), "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
  server: { host: "127.0.0.1", port: 4188, strictPort: true, hmr: false, forwardConsole: false },
  cacheDir: fileURLToPath(new URL("../work/admin-list-loading-vite", import.meta.url)) });
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_EXECUTABLE ? { executablePath: process.env.ORDER_SHOW_BROWSER_EXECUTABLE } : {}) });

  for(const width of [1440,440]) {
    const context=await browser.newContext({viewport:{width,height:1000}}), requests=[], errors=[], unexpected=[];
    const activity={id:987,code:"ADMIN_REFRESH_TEST",name:"列表加载测试",status:"DRAFT",version:1,startsAt:"2099-01-01T00:00:00Z",endsAt:"2099-01-02T00:00:00Z",eventEndsAt:"2099-01-03T00:00:00Z",departmentId:1,regions:[]};
    const identity={id:1,username:"fixture",displayName:"合成管理员",roleCode:"SUPER_ADMIN",departmentId:1,mustChangePassword:false,csrfToken:"fixture"};
    const products=Array.from({length:45},(_,i)=>({id:i+1,materialName:"测试商品"+(i+1),materialCode:"SKU"+(i+1),images:[],sortNo:i+1,customerType:"GENERAL",rebateStatus:"PARTICIPATING",casePrice:100,tonCaseFactor:50,version:1,dataStatus:"ACTIVE",branchScope:[]}));
    const customers=Array.from({length:45},(_,i)=>({id:i+1,excelSequence:i+1,customerType:"GENERAL",branchName:"测试分公司",dealerShortName:"测试客户"+(i+1),dealerFullName:"测试经销商"+(i+1),phone:"138"+String(i).padStart(8,"0"),lockVersion:1,active:true}));
    const attendees=Array.from({length:45},(_,i)=>({id:i+1,participantName:"参会人"+(i+1),dealerName:"测试经销商"+(i+1),branchName:"测试分公司",participantType:"综合经销商",phone:"138"+String(i).padStart(8,"0"),matchStatus:"MATCHED",lotteryEligible:true,activityCustomerId:i+1}));
    await context.route("**/*",async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!=="http://127.0.0.1:4188") {unexpected.push(url.href);return route.abort();}
      if(!url.pathname.startsWith("/api/v1/"))return route.continue();
      const path=url.pathname.slice(7),method=req.method(); requests.push({path,method});
      const reply=(data)=>route.fulfill({json:{data}});
      if(path==="/admin/me")return reply(identity);
      if(path==="/admin/activities")return reply([activity]);
      if(path==="/admin/activities/987")return reply(activity);
      if(path.endsWith("/module-context"))return reply({customerCount:customers.length,customersByType:{GENERAL:customers.length,SPECIAL:0},customerTypeMode:"TYPED",attendeeCount:attendees.length,whitelistPublished:true,productPublished:true});
      if(path.endsWith("/imports")||path.endsWith("/product-image-reviews"))return reply([]);
      if(path.endsWith("/product-dealer-scopes"))return reply({});
      if(path.endsWith("/product-dealer-candidates"))return reply(customers.map(c=>({customerId:c.id,dealerFullName:c.dealerFullName,branchName:c.branchName,customerType:c.customerType})));
      if(path.endsWith("/products")&&method==="GET")return reply(products);
      if(/\/(customers|attendees)$/.test(path)&&method==="GET")return route.fulfill({json:{data:path.endsWith("/customers")?customers:attendees,page:{totalPages:1,totalElements:45}}});
      const match=path.match(/\/(products|customers|attendees)\/(\d+)$/);
      if(match&&["PATCH","PUT"].includes(method)){
        const rows=match[1]==="products"?products:match[1]==="customers"?customers:attendees;
        const row=rows.find(r=>r.id===Number(match[2])),body=req.postDataJSON();
        if(match[1]==="products") {assert.equal(req.headers()["if-match"],String(row.version));Object.assign(row,body,{branchScope:body.branchScope?body.branchScope.split("，"):[],version:row.version+1});}
        else {Object.assign(row,body);if(match[1]==="customers")row.lockVersion++;else row.matchStatus="UNMATCHED";}
        return reply(row);
      }
      unexpected.push(method+" "+path);return route.fulfill({status:500,json:{message:"Unexpected fixture request"}});
    });
    const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept());
    await page.goto("http://127.0.0.1:4188/tests/fixtures/admin-refresh.html");
    const nav=page.getByRole("navigation",{name:"后台导航"}),drawer=page.locator(".form-drawer");
    const count=(suffix)=>requests.filter(r=>r.method==="GET"&&r.path.endsWith(suffix)).length;
    const visibleTable=()=>page.locator(".admin-panel:visible .table-pagination");
    const edit=()=>page.locator(".admin-panel:visible .table-row").filter({has:page.getByRole("button",{name:"编辑",exact:true})}).first().getByRole("button",{name:"编辑",exact:true});
    const settle=()=>page.waitForLoadState("networkidle");
    const waitCount=async(suffix,n)=>{const deadline=Date.now()+10000;while(count(suffix)<n&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));assert.equal(count(suffix),n,JSON.stringify({suffix,n,requests,errors,unexpected,body:await page.locator("body").innerText()}));};
    let candidateReads=0;
    for(const [label,suffix,searchName,field,value] of [
      ["商品导入","/products","搜索物料代码或物料名称","产品说明","修改后的说明"],
      ["白名单","/customers","搜索经销商名称、经销商姓名或电话","经销商姓名","修改后的联系人"],
      ["现场到场","/attendees","搜索现场到场客户","参会人姓名","修改后的参会人"],
    ]) {
      await nav.getByRole("button",{name:new RegExp(label)}).click();await page.getByRole("searchbox",{name:searchName}).waitFor();await settle();assert.equal(count(suffix),1,JSON.stringify({label,requests,errors,unexpected,body:await page.locator("body").innerText()}));
      const search=page.getByRole("searchbox",{name:searchName});await search.fill(label==="商品导入"?"SKU":"测试");
      const pager=visibleTable();await pager.getByRole("combobox").selectOption("20");await pager.getByRole("button",{name:"下一页",exact:true}).click();
      assert.ok((await pager.innerText()).includes("2 / 3"));
      await edit().click();await drawer.waitFor();await settle();
      if(label==="商品导入") {candidateReads=count("/product-dealer-candidates");assert.equal(candidateReads,1);}
      assert.equal(await page.getByRole("button",{name:"刷新列表",exact:true}).isDisabled(),true);
      await drawer.getByRole("button",{name:"取消",exact:true}).click();await drawer.waitFor({state:"hidden"});await settle();
      assert.equal(count(suffix),1,"cancel must not reread "+label);assert.ok((await pager.innerText()).includes("2 / 3"));
      await edit().click();await drawer.waitFor();await drawer.getByLabel(field,{exact:true}).fill(value);
      await drawer.getByRole("button",{name:"保存修改",exact:true}).click();await drawer.waitFor({state:"hidden"});await settle();
      assert.equal(count(suffix),1,"save must not reread "+label);assert.ok((await pager.innerText()).includes("2 / 3"));
      assert.equal(await search.inputValue(),label==="商品导入"?"SKU":"测试");
      if(label==="商品导入")assert.equal(count("/product-dealer-candidates"),candidateReads,"second editor shares candidates");
      if(label!=="商品导入")assert.ok(await page.getByText(value,{exact:true}).isVisible());
      await page.getByRole("button",{name:"刷新列表",exact:true}).click();await waitCount(suffix,2);await settle();
      await page.screenshot({path:fileURLToPath(new URL(label+"-"+width+".png",output)),fullPage:true});
    }
    await nav.getByRole("button",{name:/商品导入/}).click();await waitCount("/products",3);await settle();
    await edit().click();await drawer.waitFor();await settle();assert.equal(count("/product-dealer-candidates"),candidateReads+1,"whitelist changes invalidate cached candidates");
    await drawer.getByRole("button",{name:"取消",exact:true}).click();await settle();assert.equal(count("/products"),3);
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    console.log("PASS "+width+"px: three module loads, save/cancel without reread, page/filter retained, manual refresh, module reentry, candidate cache and whitelist invalidation");
    await context.close();
  }
} finally { await browser?.close();await server.close(); }
