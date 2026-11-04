import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Real components and synthetic HTTP only; no business services or credentials.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../outputs/order-loading/", import.meta.url);
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile:false, plugins:[react()],
  define:{"process.env.NEXT_PUBLIC_API_BASE":JSON.stringify("/api/v1")},
  server:{host:"127.0.0.1",port:4191,strictPort:true,hmr:false,forwardConsole:false},
  cacheDir:fileURLToPath(new URL("../work/order-loading-vite",import.meta.url)) });
let browser;
try {
  await server.listen();
  const {chromium}=await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || new URL("../work/lottery-order/browser/node_modules/playwright/index.mjs",import.meta.url).href);
  browser=await chromium.launch({headless:true,executablePath:process.env.ORDER_SHOW_BROWSER_EXECUTABLE || "C:/Users/Chen/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe"});
  for(const width of [1440,440]) {
    const context=await browser.newContext({viewport:{width,height:1000}}),requests=[],errors=[],unexpected=[];
    const item={productId:21,materialName:"合成商品",quantity:2,casePrice:100,lineAmount:200,productLine:"合成项目",lineTons:0.2};
    const orders=Array.from({length:125},(_,i)=>({id:i+1,activityCustomerId:i+1,orderNo:`ORDER-${i+1}`,status:"SUBMITTED",customerType:"GENERAL",dealerFullName:`Dealer${i+1}`,phone:"13800000000",phoneMasked:"138****0000",currentVersion:1,lockVersion:1,totalQuantity:2,totalAmount:200,totalTons:0.2,createdSource:"H5",firstSubmittedAt:"2026-11-01T01:00:00Z",lastModifiedAt:"2026-11-01T01:00:00Z",items:[item],versions:[],operations:[],pendingChangeRequestId:901+i}));
    const reviews=orders.map(o=>({id:900+o.id,orderId:o.id,orderNo:o.orderNo,dealerName:o.dealerFullName,phone:o.phone,requestType:"MODIFY",status:"PENDING",baseVersion:1,currentVersion:1,currentTotalAmount:200,requestedTotalAmount:100,requestedTotalQuantity:1,requestedTotalTons:0.1,itemCount:1,requestedAt:"2026-11-01T02:00:00Z",items:[{...item,quantity:1,lineAmount:100}],originalOrder:{...o}}));
    let failSummary=false,failList=false;
    await context.route("**/*",async route=>{
      const req=route.request(),url=new URL(req.url()),method=req.method();
      if(url.origin!=="http://127.0.0.1:4191"){unexpected.push(url.href);return route.abort();}
      if(!url.pathname.startsWith("/api/v1/"))return route.continue();
      const path=url.pathname.slice(7);requests.push({path,method,query:Object.fromEntries(url.searchParams)});
      const reply=data=>route.fulfill({json:{data}});
      const paged=rows=>{const number=Number(url.searchParams.get("page")||1),size=Number(url.searchParams.get("size")||50);assert.equal(size,50);return route.fulfill({json:{data:rows.slice((number-1)*size,number*size),page:{number,size,totalElements:rows.length,totalPages:Math.ceil(rows.length/size)}}});};
      if(path.endsWith("/orders/summary"))return failSummary?route.fulfill({status:503,json:{message:"合成数量故障"}}):reply({all:orders.length,submitted:orders.filter(o=>o.status==="SUBMITTED").length,withdrawn:0,voided:orders.filter(o=>o.status==="VOIDED").length,pending:reviews.filter(r=>r.status==="PENDING").length});
      if(path.endsWith("/orders/product-options"))return reply([{id:21,materialName:"合成商品",casePrice:100,orderable:true,customerType:"GENERAL",branchScope:[]}]);
      if(path.endsWith("/orders/customer-options"))return paged([{id:1000,dealerFullName:"新客户",phone:"13800000000",customerType:"GENERAL",active:true}]);
      if(path.endsWith("/orders/preview")){const quantity=req.postDataJSON().items.reduce((sum,i)=>sum+i.quantity,0);return reply({totalQuantity:quantity,totalAmount:quantity*100,totalTons:quantity*0.1});}
      if(path.endsWith("/orders")&&method==="GET")return failList?route.fulfill({status:503,json:{message:"合成列表故障"}}):paged(orders.filter(o=>(!url.searchParams.get("status")||o.status===url.searchParams.get("status"))&&(!url.searchParams.get("keyword")||o.dealerFullName.toLowerCase().includes(url.searchParams.get("keyword").toLowerCase()))));
      if(path.endsWith("/orders")&&method==="POST"){const saved={...orders[0],id:126,orderNo:"ORDER-126",activityCustomerId:1000,dealerFullName:"新客户",pendingChangeRequestId:null};orders.unshift(saved);return reply(saved);}
      const order=path.match(/\/orders\/(\d+)(\/void)?$/);
      if(order){const saved=orders.find(o=>o.id===Number(order[1]));if(method!=="GET"){saved.currentVersion++;saved.lockVersion++;saved.pendingChangeRequestId=null;if(order[2])saved.status="VOIDED";}return reply(saved);}
      if(path.endsWith("/order-change-requests/page"))return paged(reviews.filter(r=>url.searchParams.get("status")==="ALL"||r.status===url.searchParams.get("status")));
      const review=path.match(/\/order-change-requests\/(\d+)(\/(approve|reject))?$/);
      if(review){const r=reviews.find(r=>r.id===Number(review[1]));if(method==="POST"){r.status=review[3]==="approve"?"APPROVED":"REJECTED";orders.find(o=>o.id===r.orderId).pendingChangeRequestId=null;}return reply(r);}
      unexpected.push(method+" "+path);return route.fulfill({status:500,json:{message:"Unexpected synthetic request"}});
    });
    const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>d.accept(d.type()==="prompt"?"合成测试作废":undefined));
    await page.goto("http://127.0.0.1:4191/tests/fixtures/order-loading.html");
    const settle=async()=>{
      await page.waitForTimeout(300);
      await page.waitForFunction(()=>{
        const pager=document.querySelector(".order-pagination select");
        return (!pager || !pager.disabled) && !document.body.innerText.includes("正在更新数量…");
      });
      await page.waitForLoadState("networkidle");
    },count=suffix=>requests.filter(r=>r.method==="GET"&&r.path.endsWith(suffix)).length;
    const verify=(list,summary)=>{assert.equal(count("/orders"),list);assert.equal(count("/orders/summary"),summary);};
    const pager=page.locator(".order-pagination:visible"),table=page.locator(".order-table:visible");
    await settle();verify(1,1);assert.equal(await table.locator(".clickable-row").count(),50);
    await pager.getByLabel("选择页码").selectOption("3");await settle();verify(2,1);assert.equal(await table.locator(".clickable-row").count(),25);
    await pager.getByLabel("选择页码").selectOption("1");await settle();verify(3,1);
    await table.getByRole("button",{name:"变更审核中",exact:true}).first().click();await page.locator(".review-drawer").waitFor();await settle();verify(3,1);
    await page.locator(".review-drawer").getByRole("button",{name:"关闭",exact:true}).click();await settle();verify(3,1);
    await page.getByRole("button",{name:"刷新订单",exact:true}).click();await settle();verify(4,2);
    failSummary=true;await page.getByRole("button",{name:"刷新订单",exact:true}).click();await settle();verify(5,3);
    assert.ok(await page.getByText(/数量更新失败/).isVisible());assert.equal(await table.locator(".clickable-row").count(),50);
    failSummary=false;await page.getByRole("button",{name:"重试数量"}).click();await settle();verify(5,4);
    failList=true;await page.getByRole("button",{name:"刷新订单",exact:true}).click();await settle();verify(6,5);assert.equal(await table.locator(".clickable-row").count(),50);
    failList=false;await page.getByRole("button",{name:"刷新订单",exact:true}).click();await settle();verify(7,6);
    const search=page.getByPlaceholder("搜索订单号、经销商名称或手机号（完整号码/后四位）");await search.fill("dealer");await settle();verify(8,6);assert.equal(await table.locator(".clickable-row").count(),50);await search.fill("");await settle();verify(9,6);
    await page.getByRole("button",{name:/^变更审核 /}).click();await settle();assert.equal(count("/order-change-requests/page"),1);assert.equal(count("/orders/summary"),7);
    await pager.getByLabel("选择页码").selectOption("3");await settle();assert.equal(count("/order-change-requests/page"),2);assert.equal(count("/orders/summary"),7);
    await pager.getByLabel("选择页码").selectOption("1");await settle();
    for(const action of ["审核通过","驳回"]){
      await page.getByRole("button",{name:"查看并审核",exact:true}).first().click();await page.locator(".review-drawer").waitFor();
      await page.locator(".review-drawer").getByRole("textbox").fill("已核对合成数据");
      const before=count("/order-change-requests/page"),stats=count("/orders/summary");
      await page.locator(".review-drawer").getByRole("button",{name:action,exact:true}).click();await settle();
      assert.equal(count("/order-change-requests/page"),before+1);assert.equal(count("/orders/summary"),stats+1);
      await page.locator(".review-drawer").getByRole("button",{name:"关闭",exact:true}).click();await settle();assert.equal(count("/order-change-requests/page"),before+1);
    }
    await page.getByRole("button",{name:"订单列表",exact:true}).click();await settle();
    await table.locator(".clickable-row").first().click();await settle();await page.getByRole("button",{name:"调整订单",exact:true}).click();await settle();
    let before=count("/orders"),stats=count("/orders/summary");
    await page.locator(".order-editor-drawer").getByRole("button",{name:"取消",exact:true}).click();await settle();verify(before,stats);
    await page.getByRole("button",{name:"调整订单",exact:true}).click();await settle();
    await page.locator(".order-editor-drawer").getByLabel("合成商品箱数",{exact:true}).fill("3");
    await page.locator(".order-editor-drawer").getByLabel("操作原因").fill("合成调整");
    await page.getByRole("button",{name:"保存并生成新版本",exact:true}).click();await settle();verify(before+1,stats+1);
    before=count("/orders");stats=count("/orders/summary");await page.getByRole("button",{name:"作废订单",exact:true}).click();await settle();verify(before+1,stats+1);
    await page.getByRole("button",{name:"关闭详情",exact:true}).click();await settle();
    await page.getByRole("button",{name:"＋ 新增订单",exact:true}).click();await page.locator(".order-editor-drawer").getByLabel("搜索客户").fill("新客户");
    await page.locator(".order-editor-customer-results").getByRole("button").click();await settle();
    await page.locator(".order-editor-products").getByLabel("合成商品箱数",{exact:true}).fill("2");await page.locator(".order-editor-drawer").getByLabel("操作原因").fill("合成新增");
    before=count("/orders");stats=count("/orders/summary");await page.getByRole("button",{name:"创建订单",exact:true}).click();await settle();verify(before+1,stats+1);
    await page.getByRole("button",{name:"关闭详情",exact:true}).click();await settle();
    before=count("/orders");stats=count("/orders/summary");await page.getByRole("button",{name:"切换模块显示"}).click();await settle();verify(before,stats);
    await page.getByRole("button",{name:"切换模块显示"}).click();await settle();verify(before+1,stats+1);
    await page.screenshot({path:fileURLToPath(new URL(`${width}.png`,output)),fullPage:true});
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.equal(requests.filter(r=>r.path.endsWith("/order-change-requests/pending")).length,0);
    console.log(`PASS ${width}px: 50-row paging, direct jump, independent failures, review shortcuts/approve/reject, create/adjust/void, cancel/close and reentry request counts`);
    await context.close();
  }
} finally {await browser?.close();await server.close();}
