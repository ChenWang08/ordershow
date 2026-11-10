import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

assert(process.argv.includes('--ack-smoke'));
const fixture=JSON.parse(await readFile('outputs/roster-pagination/fixture.json','utf8'));
assert(Number.isSafeInteger(fixture.activityId));
const base='http://127.0.0.1:18031';
// Only proxies the disposable backend and the separately started frontend under test.
const proxy=createServer((req,res)=>{
  const upstream=request({hostname:'127.0.0.1',port:req.url.startsWith('/api/v1/')?18081:18030,path:req.url,method:req.method,headers:req.headers},response=>{
    res.writeHead(response.statusCode,response.headers); response.pipe(res);
  });
  upstream.on('error',error=>{res.writeHead(502);res.end(error.message);}); req.pipe(upstream);
});
await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(18031,'127.0.0.1',resolve);});
let browser, page;
const errors=[];
try {
  const { chromium }=await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || '../work/lottery-order/browser/node_modules/playwright/index.mjs');
  browser=await chromium.launch({headless:true,...(process.env.ORDER_SHOW_BROWSER_PATH?{executablePath:process.env.ORDER_SHOW_BROWSER_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1500,height:1000}});
  const login=await context.request.post(base+'/api/v1/admin/auth/login',{data:{username:'smoke_admin',password:'SmokeChanged456!'}});
  assert.equal(login.status(),200);
  for(const [kind,key] of [['customers','customerCount'],['attendees','attendeeCount']]) {
    const current=await context.request.get(`${base}/api/v1/admin/activities/${fixture.activityId}/${kind}/page`);
    assert.equal(current.status(),200); fixture[key]=(await current.json()).summary.total;
  }
  page=await context.newPage(); page.setDefaultTimeout(30000);
  const reads=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',req=>{if(/\/(customers|attendees)\/page\?/.test(req.url())) reads.push(new URL(req.url()));});
  await page.goto(`${base}/admin?activity=${encodeURIComponent(fixture.activityCode)}`);
  await page.getByRole('button',{name:'白名单',exact:true}).click();
  const panel=()=>page.locator('.admin-panel:visible');
  const waitRoster=async(kind,params,action)=>{
    const next=page.waitForResponse(response=>{
      const url=new URL(response.url());
      return url.pathname.endsWith(`/${kind}/page`) && Object.entries(params).every(([key,value])=>(url.searchParams.get(key)??'')===String(value));
    });
    await action(); const response=await next; assert.equal(response.status(),200); return response.json();
  };
  await page.getByText(`符合条件 ${fixture.customerCount} 名 · 第 1/${Math.ceil(fixture.customerCount/50)} 页`,{exact:true}).waitFor();
  assert.equal(await panel().locator('.whitelist-table .table-row:not(.table-head)').count(),50);
  await page.waitForTimeout(700);
  assert.equal(reads.filter(u=>u.pathname.endsWith('/customers/page')).length,1,'entry must not fetch other pages');
  await waitRoster('customers',{page:2,size:50},()=>panel().getByRole('button',{name:'下一页',exact:true}).click());
  await waitRoster('customers',{page:1,size:20},()=>panel().locator('.table-pagination select').selectOption('20'));
  await page.waitForFunction(()=>document.querySelectorAll('.admin-panel:not([hidden]) .whitelist-table .table-row:not(.table-head)').length===20);
  await waitRoster('customers',{keyword:'联系人4000'},()=>panel().locator('input[type=search]').fill('联系人4000'));
  await page.getByText('符合条件 1 名 · 第 1/1 页',{exact:true}).waitFor();
  assert.match(await panel().locator('.whitelist-table').innerText(),/ACK分页客户4000/);
  await waitRoster('customers',{customerType:'GENERAL',keyword:'联系人4000'},()=>panel().locator('.data-filters select').first().selectOption('GENERAL'));
  await page.getByText('当前搜索和筛选条件下没有记录',{exact:true}).waitFor();
  await page.getByText('本次白名单替换完成',{exact:true}).waitFor();
  assert.match(await panel().locator('.import-completed-banner').innerText(),new RegExp(String(fixture.customerCount)));
  await waitRoster('customers',{customerType:'',keyword:'联系人4000'},()=>panel().locator('.data-filters select').first().selectOption(''));
  await waitRoster('customers',{keyword:''},()=>panel().locator('input[type=search]').fill(''));
  await panel().locator('input[aria-label^="选择记录"]').first().check();
  await waitRoster('customers',{page:2,size:20},()=>panel().getByRole('button',{name:'下一页',exact:true}).click());
  await panel().locator('input[aria-label^="选择记录"]').first().check();
  assert.match(await panel().locator('.selection-toolbar:not(.selection-toolbar-all)').innerText(),/已选择\s*2\s*名/);
  await panel().getByRole('button',{name:'删除所选',exact:true}).click();
  await page.getByRole('dialog',{name:'删除名单确认'}).getByText('确认删除 2 名白名单客户？',{exact:true}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  await panel().getByRole('button',{name:'取消选择',exact:true}).click();
  await panel().locator('input[aria-label^="选择记录"]').first().check();
  await panel().getByRole('button',{name:`选择全部 ${fixture.customerCount} 名`,exact:true}).click();
  await panel().locator('input[aria-label^="选择记录"]').first().uncheck();
  assert.match(await panel().locator('.selection-toolbar:not(.selection-toolbar-all)').innerText(),new RegExp(`已选择\\s*${fixture.customerCount-1}\\s*名`));
  await panel().getByRole('button',{name:'删除所选',exact:true}).click();
  await page.getByRole('dialog').getByText(`确认删除 ${fixture.customerCount-1} 名白名单客户？`,{exact:true}).waitFor();
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
  await panel().getByRole('button',{name:'取消选择',exact:true}).click();
  await mkdir('outputs/roster-pagination',{recursive:true});
  await page.screenshot({path:'outputs/roster-pagination/whitelist.png',fullPage:true});

  const attendanceRead=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/attendees/page'));
  await page.getByRole('button',{name:'现场到场',exact:true}).click(); assert.equal((await attendanceRead).status(),200);
  await page.getByText(`符合条件 ${fixture.attendeeCount} 名 · 第 1/${Math.ceil(fixture.attendeeCount/50)} 页`,{exact:true}).waitFor();
  assert.equal(await panel().locator('.attendance-table .table-row:not(.table-head)').count(),50);
  assert.equal(reads.filter(u=>u.pathname.endsWith('/attendees/page')).length,1);
  await panel().locator('.attendance-table .table-row:not(.table-head)').first().getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByLabel('参会人姓名',{exact:true}).fill('分页编辑验证');
  await waitRoster('attendees',{page:1,size:50},()=>page.locator('.form-drawer').getByRole('button',{name:'保存修改',exact:true}).click());
  await waitRoster('attendees',{keyword:'分页编辑验证'},()=>panel().locator('input[type=search]').fill('分页编辑验证'));
  await page.getByText('符合条件 1 名 · 第 1/1 页',{exact:true}).waitFor();
  assert.equal(await panel().locator('.data-filters select').nth(1).locator('option').count(),7,'branch options remain global across a one-row search');
  assert.match(await panel().locator('.attendance-overview-card').innerText(),new RegExp(String(fixture.attendeeCount)));
  await waitRoster('attendees',{keyword:''},()=>panel().locator('input[type=search]').fill(''));
  await panel().locator('input[aria-label^="选择记录"]').first().check();
  await waitRoster('attendees',{page:2,size:50},()=>panel().getByRole('button',{name:'下一页',exact:true}).click());
  await panel().locator('input[aria-label^="选择记录"]').first().check();
  await panel().getByRole('button',{name:'删除所选',exact:true}).click();
  await page.getByRole('dialog').getByText('确认删除 2 名到场客户？',{exact:true}).waitFor();
  await waitRoster('attendees',{page:2,size:50},()=>page.getByRole('dialog').getByRole('button',{name:'确认删除',exact:true}).click());
  await page.getByText(`符合条件 ${fixture.attendeeCount-2} 名 · 第 2/${Math.ceil((fixture.attendeeCount-2)/50)} 页`,{exact:true}).waitFor();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'outputs/roster-pagination/attendance.png',fullPage:false});
  assert.deepEqual(errors,[]);
  await writeFile('outputs/roster-pagination/browser.json',JSON.stringify({errors,requests:reads.map(u=>u.pathname+u.search),verified:['entry-one-page','page-size','global-search','empty-filter-keeps-published','cross-page-selection','select-all-exclusions','delete-preview','global-branch-options','global-summary','edit-refresh','cross-page-delete']},null,2));
  console.log('PASS: full admin UI paging, global search, empty results, selection/confirmation, global options/statistics, edit refresh and cross-page deletion.');
} catch(error) {
  await mkdir('outputs/roster-pagination',{recursive:true});
  if(page) { await page.screenshot({path:'outputs/roster-pagination/browser-failure.png',fullPage:true}); console.error(JSON.stringify({url:page.url(),errors,body:(await page.locator('body').innerText()).slice(0,1800)})); }
  throw error;
} finally { await browser?.close(); await new Promise(resolve=>proxy.close(resolve)); }
