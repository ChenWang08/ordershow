import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("../work/activity-lifecycle/", import.meta.url);
const output = new URL("../outputs/activity-lifecycle-browser/", import.meta.url);
await mkdir(fixture, { recursive: true }); await mkdir(output, { recursive: true });
const browserTemp = fileURLToPath(new URL("browser-temp/", fixture)); await mkdir(browserTemp, { recursive: true });
process.env.TEMP = browserTemp; process.env.TMP = browserTemp;
await writeFile(new URL("index.html", fixture), '<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/work/activity-lifecycle/fixture.jsx"></script></html>');
await writeFile(new URL("fixture.jsx", fixture), `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {AdminIdentityContext} from '/app/admin-context.ts';
import {ActivityManagementActions} from '/app/features/admin/ActivityManagementActions.tsx';
import {ActivityDeletionProgressProvider} from '/app/features/admin/ActivityDeletionProgress.tsx';
import {AdminHeader} from '/app/features/admin/AdminHeader.tsx';
import {AdminLayout} from '/app/features/admin/AdminLayout.tsx';
import {EmptyAdminWorkspace,AuthorizedWorkspace} from '/app/features/admin/AdminEntry.tsx';
import {useAdminActivities} from '/app/features/admin/useAdminActivities.ts';
import {setAdminPreferenceOwner} from '/app/api.ts'; import '/app/globals.css';
const params=new URLSearchParams(location.search),role=params.get('role')||'SUPER_ADMIN',mode=params.get('mode');
const base={id:7,code:'ACT7',name:'历史订货活动',departmentId:1,departmentName:'测试部门',status:localStorage.getItem('test-status')||'FINISHED',version:3,startsAt:'2026-01-01T00:00:00Z',endsAt:'2026-01-02T00:00:00Z',eventEndsAt:'2026-01-03T00:00:00Z'};
const archived={...base,id:8,code:'ACT8',name:'已归档历史活动',status:'ARCHIVED'};
const list=mode==='all-archived'?[archived]:[base,archived,...['DRAFT','SCHEDULED','ACTIVE','CLOSED'].map((status,i)=>({...base,id:9+i,code:'ACT'+(9+i),name:status==='ACTIVE'?'这是一个非常长的活动名称用于验证活动菜单换行以及已归档标记和状态标签之间的布局':status+'活动',status,departmentId:2,departmentName:'另一部门'}))];
setAdminPreferenceOwner(1);
function Workspace(){const selected=list[0],activities=useAdminActivities({activityId:String(selected.id),activityCode:selected.code,setActionNotice:()=>{},initialActivities:list,activeActivity:selected});
const [tab,setTab]=React.useState('活动概览'),[logOpen,setLogOpen]=React.useState(false);
return <AdminLayout tab={tab} onTabChange={setTab} header={<AdminHeader activityCode={selected.code} activityName={selected.name} activityStatus="finished" tab={tab} activities={activities} operationLogs={[]} operationLogOpen={logOpen} setOperationLogOpen={setLogOpen}/>}>
<section className="admin-panel"><h2>{tab}</h2>{tab==='活动概览'&&<ActivityManagementActions activity={selected}/>}</section></AdminLayout>}
function App(){if(mode==='error'||mode==='loading'||mode==='empty')return <AuthorizedWorkspace/>;
if(localStorage.getItem('test-deleted')==='yes')return <EmptyAdminWorkspace activities={[]}/>;return <Workspace/>}
createRoot(document.getElementById('root')).render(<React.StrictMode><AdminIdentityContext.Provider value={{id:1,displayName:'测试账号',roleCode:role,departmentId:1,permissions:['PRODUCT','WHITELIST','ATTENDANCE','ORDER','LOTTERY']}}><ActivityDeletionProgressProvider><App/></ActivityDeletionProgressProvider></AdminIdentityContext.Provider></React.StrictMode>);
`);
const server = await createServer({ root, configFile: false, plugins: [react(), { name: 'activity-test-navigation', configureServer(s) { s.middlewares.use((req, res, next) => { if (req.url === '/admin') req.url = '/work/activity-lifecycle/index.html'; next(); }); } }],
  define: { 'process.env.NEXT_PUBLIC_API_BASE': JSON.stringify('/api/v1') }, server: { host: '127.0.0.1', port: 4197, strictPort: true }, cacheDir: fileURLToPath(new URL('vite-cache', fixture)) });
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || '../work/lottery-order/browser/node_modules/playwright/index.mjs');
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_PATH ? { executablePath: process.env.ORDER_SHOW_BROWSER_PATH } : {}) });
  const report = [];
  const url = 'http://127.0.0.1:4197/work/activity-lifecycle/index.html';
  const noOverflow = async page => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  for (const width of [1440, 440, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 960 } }), requests = [], errors = [];
    await page.clock.install();
    let state = 'FINISHED', deleted = false, failed = false, completed = false, paused = false, autoRetry = false;
    page.on('pageerror', e => errors.push(e.message));
    const task = () => ({ id: 10, activityId: 7, activityCode: 'ACT7', activityName: '历史订货活动', departmentName: '测试部门', requestedByName: '测试超管', reason: '清理历史', status: completed ? 'COMPLETED' : failed ? 'FAILED' : paused ? 'PAUSED' : 'RUNNING', stage: 10, totalStages: 43, stageName: '清理关联业务数据', stageDetail: '清理订单明细', deletedRows: 415282, deletedFiles: 0, retryCount: failed ? 5 : autoRetry ? 2 : 0, maxRetries: 5, nextAttemptAt: '2026-11-05T11:01:03Z', lastProgressAt: '2026-11-05T11:00:00Z', lastError: failed ? '文件服务暂不可用' : autoRetry ? '本批数据库操作超时' : null, createdAt: '2026-11-05T10:52:18Z' });
    await page.route('**/api/v1/**', async route => {
      const req = route.request(), path = new URL(req.url()).pathname; requests.push({ path, method: req.method() }); let data;
      if (path.endsWith('/departments')) data = [{ id: 1, name: '测试部门', code: 'TEST', status: 'ACTIVE' }, { id: 2, name: '另一部门', code: 'OTHER', status: 'ACTIVE' }];
      else if (path === '/api/v1/admin/activities') data = deleted ? [] : [
        { id: 7, code: 'ACT7', name: '历史订货活动', departmentId: 1, departmentName: '测试部门', status: state },
        { id: 8, code: 'ACT8', name: '已归档历史活动', departmentId: 1, departmentName: '测试部门', status: 'ARCHIVED' },
        ...['DRAFT', 'SCHEDULED', 'ACTIVE', 'CLOSED'].map((status, i) => ({ id: 9 + i, code: 'ACT' + (9 + i), name: status === 'ACTIVE' ? '这是一个非常长的活动名称用于验证活动菜单换行以及已归档标记和状态标签之间的布局' : status + '活动', status, departmentId: 2, departmentName: '另一部门' }))];
      else if (path.endsWith('/deletion-preview')) data = { activityId: 7, code: 'ACT7', name: '历史订货活动', departmentName: '测试部门', version: 3, orders: 1201, products: 25, customers: 50, winners: 3, files: 5 };
      else if (path.endsWith('/archive') || path.endsWith('/unarchive')) {
        assert.equal(req.headers()['if-match'], '3'); assert.ok(req.postDataJSON().reason); state = path.endsWith('/unarchive') ? 'FINISHED' : 'ARCHIVED';
        await page.evaluate(s => localStorage.setItem('test-status', s), state); data = { status: state };
      } else if (path.endsWith('/permanent-deletion')) {
        assert.deepEqual(req.postDataJSON(), { code: 'ACT7', reason: '清理历史' }); assert.equal(req.headers()['if-match'], '3'); deleted = true;
        await page.evaluate(() => localStorage.setItem('test-deleted', 'yes')); data = task();
      } else if (path.endsWith('/retry')) { failed = false; data = task(); }
      else if (path.endsWith('/pause')) { paused = true; data = task(); }
      else if (path.endsWith('/resume')) { paused = false; data = task(); }
      else if (path === '/api/v1/admin/activity-deletion-tasks') data = [task()];
      else throw new Error('Unexpected request: ' + path);
      await route.fulfill({ status: path.endsWith('/permanent-deletion') ? 202 : 200, json: { data } });
    });
    const count = () => requests.filter(r => r.path === '/api/v1/admin/activity-deletion-tasks').length;
    await page.goto(url); await page.getByRole('button', { name: '删除进度', exact: true }).waitFor();
    await page.clock.fastForward(15000); assert.equal(count(), 0);
    const order = await page.locator('.admin-actions > button').allTextContents(); assert.deepEqual(order.slice(0, 2), ['删除进度', '操作日志']);
    if (width <= 1000) {
      const heading = await page.locator('.admin-heading').boundingBox(), actions = await page.locator('.admin-actions').boundingBox();
      assert.ok(actions.y >= heading.y + heading.height, 'Top bar rows must not overlap on narrow screens');
    }
    await page.locator('.activity-switcher > button').click();
    const menu = page.locator('.activity-switcher-menu'); await menu.locator('> button').filter({ hasText: '已归档历史活动' }).waitFor();
    assert.equal(await page.getByLabel('活动范围').count(), 0); assert.equal(await menu.getByRole('button', { name: '删除进度' }).count(), 0);
    assert.equal(await menu.locator('.activity-archive-badge').count(), 2);
    for (const [css, label, color] of [['scheduled', '待开始', 'rgb(140, 100, 31)'], ['running', '订货中', 'rgb(35, 120, 79)'], ['ended', '订货已截止', 'rgb(143, 79, 40)'], ['finished', '活动已结束', 'rgb(126, 107, 98)']]) {
      const status = menu.locator('> button > em.' + css).first(); assert.equal(await status.textContent(), label); assert.equal(await status.evaluate(e => getComputedStyle(e).color), color);
    }
    const department = page.getByLabel('按部门筛选'); await department.selectOption('2'); assert.equal(await menu.locator('> button').count(), 4);
    assert.equal(await menu.locator('.activity-archive-badge').count(), 0); await department.selectOption('');
    await noOverflow(page); await page.screenshot({ path: fileURLToPath(new URL(width + '-menu.png', output)), fullPage: true });
    await page.locator('.activity-switcher > button').click();
    for (const tab of ['商品导入', '白名单', '现场到场', '订单管理', '抽奖规则', '成员管理', '部门与账号', '活动概览']) {
      await page.getByRole('navigation', { name: '后台导航' }).getByRole('button', { name: tab, exact: true }).click();
      assert.equal(await page.locator('.admin-actions > button').filter({ hasText: '删除进度' }).count(), 1);
    }
    assert.equal(count(), 0); await page.getByRole('button', { name: '删除进度', exact: true }).click();
    await page.getByText('清理中', { exact: true }).waitFor();
    const first = count(); await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/admin/activity-deletion-tasks'), page.clock.fastForward(3200)]);
    assert.equal(count(), first + 1); // One drawer and one polling owner even under StrictMode.
    await page.getByRole('button', { name: '关闭删除进度' }).click(); const closed = count(); await page.clock.fastForward(15000); assert.equal(count(), closed);
    await page.getByRole('button', { name: '归档活动', exact: true }).click(); let dialog = page.getByRole('dialog');
    assert.equal(await dialog.getByRole('button', { name: '归档活动', exact: true }).isDisabled(), true);
    await dialog.getByLabel('操作原因').fill('已核对'); await dialog.getByRole('button', { name: '归档活动', exact: true }).click();
    await page.getByRole('button', { name: '解除归档', exact: true }).waitFor();
    await page.getByRole('button', { name: '解除归档', exact: true }).click(); dialog = page.getByRole('dialog');
    assert.match(await dialog.textContent(), /不会自动开放下单/); await dialog.getByLabel('操作原因').fill('补充核对');
    await dialog.getByRole('button', { name: '解除归档', exact: true }).click(); await page.getByRole('button', { name: '归档活动', exact: true }).waitFor();
    await page.getByRole('button', { name: '永久删除', exact: true }).click(); dialog = page.getByRole('dialog');
    await dialog.getByText('1201', { exact: true }).waitFor(); await dialog.getByLabel('操作原因').fill('清理历史');
    assert.equal(await dialog.getByRole('button', { name: '确认永久删除' }).isDisabled(), true);
    await dialog.getByLabel('输入活动编号确认').fill('ACT_WRONG'); await dialog.getByRole('checkbox').check();
    assert.equal(await dialog.getByRole('button', { name: '确认永久删除' }).isDisabled(), true); await dialog.getByLabel('输入活动编号确认').fill('ACT7');
    await noOverflow(page); await page.screenshot({ path: fileURLToPath(new URL(width + '-confirmation.png', output)), fullPage: true });
    await dialog.getByRole('button', { name: '确认永久删除' }).click();
    await page.getByRole('dialog', { name: '删除进度', exact: true }).waitFor(); await page.getByText('清理中', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '永久删除', exact: true }).count(), 0);
    await page.getByRole('button', { name: '暂停清理', exact: true }).click(); await page.getByText('已暂停', { exact: true }).waitFor();
    const pausedCount = count(); await page.clock.fastForward(15000); assert.equal(count(), pausedCount);
    assert.match(await page.getByRole('dialog', { name: '删除进度', exact: true }).textContent(), /415,282/);
    await noOverflow(page); await page.screenshot({ path: fileURLToPath(new URL(width + '-paused.png', output)), fullPage: true });
    await page.getByRole('button', { name: '继续清理', exact: true }).click(); await page.getByText('清理中', { exact: true }).waitFor();
    autoRetry = true; await page.getByRole('button', { name: '刷新进度', exact: true }).click(); await page.getByText('等待自动重试', { exact: true }).waitFor();
    assert.match(await page.getByRole('dialog', { name: '删除进度', exact: true }).textContent(), /2\/5 次/);
    assert.equal(await page.getByRole('alert').count(), 0); await noOverflow(page);
    await page.screenshot({ path: fileURLToPath(new URL(width + '-retrying.png', output)), fullPage: true });
    autoRetry = false;
    failed = true; await page.getByRole('button', { name: '刷新进度', exact: true }).click(); await page.getByRole('button', { name: '继续清理' }).waitFor();
    const failedCount = count(); await page.clock.fastForward(15000); assert.equal(count(), failedCount);
    await page.screenshot({ path: fileURLToPath(new URL(width + '-progress.png', output)), fullPage: true });
    await page.getByRole('button', { name: '继续清理' }).click(); await page.getByText('清理中', { exact: true }).waitFor();
    completed = true; await page.getByRole('button', { name: '刷新进度', exact: true }).click(); await page.getByText('已完成', { exact: true }).waitFor();
    const done = count(); await page.clock.fastForward(20000); assert.equal(count(), done);
    await page.getByRole('button', { name: '关闭删除进度' }).click(); await page.clock.fastForward(20000); assert.equal(count(), done);
    await page.getByRole('button', { name: '删除进度', exact: true }).click(); await page.getByRole('dialog', { name: '删除进度', exact: true }).waitFor();
    await noOverflow(page); assert.deepEqual(errors, []);
    report.push({ width, requests, errors, checks: ['六种业务状态及颜色', '结束活动归档标记', '部门筛选', '全部模块唯一入口及默认不查询', '单实例轮询', '归档及解除归档', '三项删除确认', '删最后活动自动打开进度', '暂停及原进度继续', '自动重试详情', '失败继续', '完成及关闭停止查询', '长名称及窄屏布局'] });
    await page.close();
  }
  for (const role of ['DEPARTMENT_ADMIN', 'DEPARTMENT_MEMBER']) {
    const page = await browser.newPage(); const requests = [];
    await page.route('**/api/v1/**', async r => { const path = new URL(r.request().url()).pathname; requests.push(path); assert.equal(path, '/api/v1/admin/activities'); await r.fulfill({ json: { data: [{ id: 8, code: 'ACT8', name: '已归档历史活动', status: 'ARCHIVED' }] } }); });
    await page.goto(url + '?role=' + role + '&mode=all-archived'); await page.locator('.activity-switcher > button').click();
    await page.locator('.activity-switcher-menu > button').filter({ hasText: '已归档历史活动' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '删除进度', exact: true }).count(), 0); assert.equal(await page.locator('.activity-management-actions').count(), 0);
    assert.equal(await page.getByLabel('按部门筛选').count(), 0); assert.equal(await page.getByLabel('活动范围').count(), 0);
    report.push({ role, requests, checks: ['全归档活动可见', '无生命周期操作及删除进度入口'] }); await page.close();
  }
  for (const mode of ['empty', 'error', 'loading']) {
    const page = await browser.newPage({ viewport: { width: 440, height: 960 } }); let progressCalls = 0;
    await page.clock.install();
    await page.route('**/api/v1/**', async r => {
      const path = new URL(r.request().url()).pathname;
      if (path === '/api/v1/admin/activities') {
        if (mode === 'loading') return;
        await r.fulfill({ status: mode === 'error' ? 500 : 200, json: mode === 'error' ? { error: { code: 'TEST', message: '活动加载失败测试' } } : { data: [] } });
      } else { assert.equal(path, '/api/v1/admin/activity-deletion-tasks'); progressCalls++; await r.fulfill({ json: { data: [] } }); }
    });
    await page.goto(url + '?mode=' + mode); const trigger = page.getByRole('button', { name: '删除进度', exact: true }); await trigger.waitFor();
    if (mode === 'error') await page.getByRole('heading', { name: '活动加载失败', exact: true }).waitFor();
    if (mode === 'empty') await page.getByRole('heading', { name: '暂无活动', exact: true }).waitFor();
    await page.clock.fastForward(10000); assert.equal(progressCalls, 0); await trigger.click(); await page.getByText('暂无删除任务', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog', { name: '删除进度', exact: true }).count(), 1); await noOverflow(page);
    report.push({ mode, progressCalls, checks: ['真实加载/错误/空活动公共顶栏入口', '默认不查询', '点击独立读取进度'] }); await page.close();
  }
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log('Activity lifecycle browser checks passed at 1440px, 440px and 320px; both department roles and real empty/error/loading headers verified.');
} finally { await browser?.close(); await server.close(); }
