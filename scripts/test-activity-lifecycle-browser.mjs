import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root=fileURLToPath(new URL("../",import.meta.url));
const fixture=new URL("../work/activity-lifecycle/",import.meta.url);
const output=new URL("../outputs/activity-lifecycle-browser/",import.meta.url);
await mkdir(fixture,{recursive:true}); await mkdir(output,{recursive:true});
const browserTemp=fileURLToPath(new URL("browser-temp/",fixture)); await mkdir(browserTemp,{recursive:true});
process.env.TEMP=browserTemp; process.env.TMP=browserTemp;
await writeFile(new URL("index.html",fixture),'<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/work/activity-lifecycle/fixture.jsx"></script></html>');
await writeFile(new URL("fixture.jsx",fixture),`
import React from 'react'; import {createRoot} from 'react-dom/client';
import {AdminIdentityContext} from '/app/admin-context.ts';
import {ActivityManagementActions} from '/app/features/admin/ActivityManagementActions.tsx';
import {ActivitySwitcher} from '/app/features/admin/ActivitySwitcher.tsx';
import {useAdminActivities} from '/app/features/admin/useAdminActivities.ts';
import {setAdminPreferenceOwner} from '/app/api.ts'; import '/app/globals.css';
const role=new URLSearchParams(location.search).get('role')||'SUPER_ADMIN';
const base={id:7,code:'ACT7',name:'历史订货活动',departmentId:1,departmentName:'测试部门',status:localStorage.getItem('test-status')||'FINISHED',version:3,startsAt:'2026-01-01T00:00:00Z',endsAt:'2026-01-02T00:00:00Z',eventEndsAt:'2026-01-03T00:00:00Z'};
const deleted=localStorage.getItem('test-deleted')==='yes';
const list=deleted?[]:[base,{...base,id:8,code:'ACT8',name:'已归档历史活动',status:'ARCHIVED'}];
setAdminPreferenceOwner(1);
function App(){const activities=useAdminActivities({activityId:deleted?'':String(base.id),activityCode:deleted?'':base.code,setActionNotice:()=>{},initialActivities:list,activeActivity:deleted?null:base});
return <main style={{padding:24,minWidth:0}}><ActivitySwitcher activities={activities} activityCode={deleted?'':base.code} activityName={deleted?'暂无活动':base.name}/>
<section className="activity-card" style={{marginTop:24,maxWidth:700}}><h2>活动设置</h2>{deleted?<p>暂无活动</p>:<ActivityManagementActions activity={base}/>}</section></main>}
createRoot(document.getElementById('root')).render(<AdminIdentityContext.Provider value={{id:1,roleCode:role,departmentId:1,permissions:[]}}><App/></AdminIdentityContext.Provider>);
`);
const server=await createServer({root,configFile:false,plugins:[react(),{name:'activity-test-navigation',configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url==='/admin') req.url='/work/activity-lifecycle/index.html';next();});}}],
  define:{'process.env.NEXT_PUBLIC_API_BASE':JSON.stringify('/api/v1')},server:{host:'127.0.0.1',port:4197,strictPort:true},cacheDir:fileURLToPath(new URL('vite-cache',fixture))});
let browser;
try{
  await server.listen();
  const {chromium}=await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE||'../work/lottery-order/browser/node_modules/playwright/index.mjs');
  browser=await chromium.launch({headless:true,...(process.env.ORDER_SHOW_BROWSER_PATH?{executablePath:process.env.ORDER_SHOW_BROWSER_PATH}:{})});
  const report=[];
  for(const width of [1440,440]){
    const page=await browser.newPage({viewport:{width,height:960}}); const requests=[],errors=[];
    await page.clock.install();
    let state='FINISHED',deleted=false,failed=false,completed=false;
    page.on('pageerror',e=>errors.push(e.message));
    const task=()=>({id:10,activityId:7,activityCode:'ACT7',activityName:'历史订货活动',departmentName:'测试部门',requestedByName:'测试超管',reason:'清理历史',status:completed?'COMPLETED':failed?'FAILED':'RUNNING',stage:2,stageName:'清理关联业务数据',deletedRows:1000,deletedFiles:0,lastError:failed?'文件服务暂不可用':null,createdAt:'2026-11-03T01:00:00Z'});
    await page.route('**/api/v1/**',async route=>{
      const req=route.request(),path=new URL(req.url()).pathname; requests.push({path,method:req.method()}); let data;
      if(path.endsWith('/departments')) data=[{id:1,name:'测试部门',code:'TEST',status:'ACTIVE'}];
      else if(path==='/api/v1/admin/activities') data=deleted?[]:[{id:7,code:'ACT7',name:'历史订货活动',departmentId:1,departmentName:'测试部门',status:state},{id:8,code:'ACT8',name:'已归档历史活动',departmentId:1,departmentName:'测试部门',status:'ARCHIVED'}];
      else if(path.endsWith('/deletion-preview')) data={activityId:7,code:'ACT7',name:'历史订货活动',departmentName:'测试部门',version:3,orders:1201,products:25,customers:50,winners:3,files:5};
      else if(path.endsWith('/archive')||path.endsWith('/unarchive')){
        assert.equal(req.headers()['if-match'],'3'); assert.ok(req.postDataJSON().reason); state=path.endsWith('/unarchive')?'FINISHED':'ARCHIVED';
        await page.evaluate(s=>localStorage.setItem('test-status',s),state);data={status:state};
      }else if(path.endsWith('/permanent-deletion')){
        assert.deepEqual(req.postDataJSON(),{code:'ACT7',reason:'清理历史'});assert.equal(req.headers()['if-match'],'3');deleted=true;
        await page.evaluate(()=>localStorage.setItem('test-deleted','yes'));data=task();
      }else if(path.endsWith('/retry')){failed=false;data=task();}
      else if(path==='/api/v1/admin/activity-deletion-tasks') data=[task()];
      else throw new Error('Unexpected request: '+path);
      await route.fulfill({status:path.endsWith('/permanent-deletion')?202:200,json:{data}});
    });
    const url='http://127.0.0.1:4197/work/activity-lifecycle/index.html';
    await page.goto(url);
    await page.locator('.activity-switcher > button').click();
    assert.equal(await page.locator('.activity-switcher-menu > button').filter({hasText:'已归档历史活动'}).count(),0);
    await page.getByLabel('活动范围').selectOption('archived');
    await page.locator('.activity-switcher-menu > button').filter({hasText:'已归档历史活动'}).waitFor();
    await page.getByLabel('活动范围').selectOption('all');
    assert.equal(await page.locator('.activity-switcher-menu > button').filter({hasText:'历史订货活动'}).count(),1);
    await page.screenshot({path:fileURLToPath(new URL(width+'-menu.png',output)),fullPage:true});
    await page.locator('.activity-switcher > button').click();
    await page.getByRole('button',{name:'归档活动',exact:true}).click();
    let dialog=page.getByRole('dialog',{name:'归档活动',exact:true});
    assert.equal(await dialog.getByRole('button',{name:'归档活动',exact:true}).isDisabled(),true);
    await dialog.getByLabel('操作原因').fill('核对完成');await dialog.getByRole('button',{name:'归档活动',exact:true}).click();
    await page.getByRole('button',{name:'解除归档',exact:true}).waitFor();
    await page.getByRole('button',{name:'解除归档',exact:true}).click();dialog=page.getByRole('dialog',{name:'解除归档',exact:true});
    await dialog.getByText('解除归档后恢复为“已结束”，不会自动开放下单。').waitFor();
    await dialog.getByLabel('操作原因').fill('补充核对');await dialog.getByRole('button',{name:'解除归档',exact:true}).click();
    await page.getByRole('button',{name:'归档活动',exact:true}).waitFor();
    await page.getByRole('button',{name:'永久删除',exact:true}).click();dialog=page.getByRole('dialog',{name:'永久删除活动'});
    await dialog.getByText('1201',{exact:true}).waitFor();
    await dialog.getByLabel('操作原因').fill('清理历史');assert.equal(await dialog.getByRole('button',{name:'确认永久删除'}).isDisabled(),true);
    await dialog.getByLabel('输入活动编号确认').fill('ACT_WRONG');await dialog.getByRole('checkbox').check();
    assert.equal(await dialog.getByRole('button',{name:'确认永久删除'}).isDisabled(),true);
    await dialog.getByLabel('输入活动编号确认').fill('ACT7');
    await page.screenshot({path:fileURLToPath(new URL(width+'-confirmation.png',output)),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await dialog.getByRole('button',{name:'确认永久删除'}).click();
    await page.getByRole('dialog',{name:'删除进度',exact:true}).waitFor();await page.getByText('清理中',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'永久删除',exact:true}).count(),0);
    const count=()=>requests.filter(r=>r.path==='/api/v1/admin/activity-deletion-tasks').length;
    const first=count();await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/admin/activity-deletion-tasks'),page.clock.fastForward(3200)]);
    assert.ok(count()>first);
    failed=true;await page.getByRole('button',{name:'刷新进度',exact:true}).click();await page.getByRole('button',{name:'继续清理'}).waitFor();
    await page.screenshot({path:fileURLToPath(new URL(width+'-progress.png',output)),fullPage:true});
    await page.getByRole('button',{name:'继续清理'}).click();await page.getByText('清理中',{exact:true}).waitFor();
    completed=true;await page.getByRole('button',{name:'刷新进度',exact:true}).click();await page.getByText('已完成',{exact:true}).waitFor();
    const done=count();await page.clock.fastForward(20000);assert.equal(count(),done);
    await page.getByRole('button',{name:'关闭删除进度'}).click();await page.clock.fastForward(20000);assert.equal(count(),done);
    await page.locator('.activity-switcher > button').click();await page.getByRole('button',{name:'删除进度',exact:true}).click();
    await page.getByRole('dialog',{name:'删除进度',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.deepEqual(errors,[]);report.push({width,requests,errors,checks:['筛选','归档','解除归档','三项删除确认','无活动进度入口','失败重试','完成与关闭停止轮询']});
    await page.close();
  }
  // Existing department access remains able to find archived activities, without super-admin actions.
  const page=await browser.newPage();await page.route('**/api/v1/admin/activities?*',r=>r.fulfill({json:{data:[{id:8,code:'ACT8',name:'已归档历史活动',status:'ARCHIVED'}]}}));
  await page.goto('http://127.0.0.1:4197/work/activity-lifecycle/index.html?role=DEPARTMENT_ADMIN');
  assert.equal(await page.locator('.activity-management-actions').count(),0);
  await page.locator('.activity-switcher > button').click();await page.getByLabel('活动范围').selectOption('archived');
  await page.locator('.activity-switcher-menu > button').filter({hasText:'已归档历史活动'}).waitFor();assert.equal(await page.getByRole('button',{name:'删除进度',exact:true}).count(),0);
  await page.close();
  await writeFile(new URL('report.json',output),JSON.stringify(report,null,2));
  console.log('Activity lifecycle browser checks passed at 1440px and 440px, plus department access checks.');
}finally{await browser?.close();await server.close();}
