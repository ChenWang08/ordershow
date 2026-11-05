import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

function nodes(x) { return Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === "object" ? [x, ...nodes(x.props?.children)] : []; }
function text(x) { return Array.isArray(x) ? x.map(text).join("") : x && typeof x === "object" ? text(x.props?.children) : x == null || typeof x === "boolean" ? "" : String(x); }
function button(h, label) { const b = nodes(h.model).find(n => n.type === "button" && text(n) === label); assert.ok(b, label); return b; }
const activity = { id: 7, code: "ACT7", name: "测试活动", status: "FINISHED", version: 3, departmentName: "测试部门" };
function actions(role = "SUPER_ADMIN", status = "FINISHED", fail = false) {
  const calls = [], store = new Map();
  const h = hookHarness("app/features/admin/ActivityManagementActions.tsx", "ActivityManagementActions", [{ activity: { ...activity, status } }], {
    "../../admin-context": { useAdminIdentity: () => ({ roleCode: role }) },
    "../../api": {
      loadActivityDeletionPreview: async id => { calls.push(["preview", id]); return { activityId: id, ...activity, orders: 1200, products: 2, customers: 1, winners: 0, files: 3 }; },
      changeActivityArchive: async (...args) => { calls.push(["archive", ...args]); },
      permanentlyDeleteActivity: async (...args) => { calls.push(["delete", ...args]); if (fail) throw new Error("暂时失败"); return { id: 10 }; },
    },
  }, { Error, sessionStorage: { setItem: (k, v) => store.set(k, v) }, window: { location: { reload: () => calls.push(["reload"]), assign: url => calls.push(["navigate", url]) } } });
  return { ...h, get model() { return h.model; }, calls, store,
    async click(label) { button(h, label).props.onClick(); await h.flush(); },
    async reason(value) { nodes(h.model).find(n => n.type === "textarea").props.onChange({ target: { value } }); await h.flush(); },
    async submit() { await nodes(h.model).find(n => n.type === "form").props.onSubmit({ preventDefault() {} }); await h.flush(); },
    get raw() { return h; } };
}
test("department administrators and members have no lifecycle actions", () => {
  for (const role of ["DEPARTMENT_ADMIN", "DEPARTMENT_MEMBER"]) assert.equal(actions(role).model, null);
});
test("archive requires a reason and sends the displayed version; unarchive describes FINISHED without reopening", async () => {
  const h = actions(); await h.click("归档活动");
  assert.equal(nodes(h.model).find(n => n.type === "button" && n.props.type === "submit").props.disabled, true);
  await h.reason("已核对"); await h.submit();
  assert.equal(h.calls[0][0], "archive"); assert.equal(h.calls[0][1].version, 3); assert.equal(h.calls[0][2], true);
  assert.equal(h.calls[0][3], "已核对"); assert.equal(h.calls[1][0], "reload");
  const u = actions("SUPER_ADMIN", "ARCHIVED"); await u.click("解除归档");
  assert.match(text(u.model), /恢复为“已结束”.*不会自动开放下单/);
  await u.reason("补充核对"); await u.submit(); assert.equal(u.calls[0][2], false);
});
test("only eligible activity states show permanent deletion", () => {
  for (const state of ["DRAFT", "FINISHED", "ARCHIVED"]) assert.ok(nodes(actions("SUPER_ADMIN", state).model).some(n => n.type === "button" && text(n) === "永久删除"));
  for (const state of ["ACTIVE", "CLOSED", "SCHEDULED"]) assert.equal(nodes(actions("SUPER_ADMIN", state).model).filter(n => n.type === "button").length, 0);
});
test("deletion needs matching code, acknowledgement and reason; submits once and opens durable progress after navigation", async () => {
  const h = actions(); await h.click("永久删除");
  assert.match(text(h.model), /1200/); assert.match(text(h.model), /不自动备份/);
  await h.reason("清理测试"); await h.submit(); assert.equal(h.calls.filter(c => c[0] === "delete").length, 0);
  nodes(h.model).find(n => n.type === "input" && n.props.autoComplete === "off").props.onChange({ target: { value: "ACT7" } });
  nodes(h.model).find(n => n.type === "input" && n.props.type === "checkbox").props.onChange({ target: { checked: true } });
  await h.flush(); await h.submit();
  assert.equal(h.calls.filter(c => c[0] === "delete").length, 1);
  assert.equal(h.store.get("activity-deletion-progress"), "open"); assert.deepEqual(h.calls.at(-1), ["navigate", "/admin"]);
});
test("failed deletion preserves the confirmation and does not navigate", async () => {
  const h = actions("SUPER_ADMIN", "FINISHED", true); await h.click("永久删除"); await h.reason("清理测试");
  nodes(h.model).find(n => n.type === "input" && n.props.autoComplete === "off").props.onChange({ target: { value: "ACT7" } });
  nodes(h.model).find(n => n.type === "input" && n.props.type === "checkbox").props.onChange({ target: { checked: true } });
  await h.flush(); await h.submit(); assert.match(text(h.model), /暂时失败/); assert.equal(h.calls.some(c => c[0] === "navigate"), false);
});
test("activity menu includes archived activities by default, retains department filtering and supports all-archived accounts", async () => {
  const items = [{ ...activity, departmentId: 1, status: "FINISHED" }, { ...activity, departmentId: 2, id: 8, code: "ACT8", status: "ARCHIVED" }];
  const mocks = {
    "../../admin-context": { useAdminIdentity: () => ({ roleCode: "SUPER_ADMIN" }) },
    "../../api": { loadAdminActivities: async () => items },
  };
  const globals = { sessionStorage: { getItem: () => null } };
  const h = hookHarness("app/features/admin/useAdminActivities.ts", "useAdminActivities", [{ activityId: "7", activityCode: "ACT7", initialActivities: items, setActionNotice() {} }], mocks, globals);
  await h.flush(); assert.equal(h.model.visibleActivities.length, 2);
  h.model.setActivityDepartmentFilter("2"); await h.flush(); assert.equal(h.model.visibleActivities[0].id, 8);
  h.model.setActivityDepartmentFilter(""); await h.flush(); assert.equal(h.model.visibleActivities.length, 2); h.unmount();
  const a = hookHarness("app/features/admin/useAdminActivities.ts", "useAdminActivities", [{ activityId: "", activityCode: "", initialActivities: [items[1]], setActionNotice() {} }], mocks, globals);
  assert.equal(a.model.visibleActivities.length, 1); a.unmount();
});

test("switcher restores business status colors and shows archive badges only for finished activities", () => {
  const { ActivitySwitcher } = loadModule("app/features/admin/ActivitySwitcher.tsx", {
    "../../admin-context": { useAdminIdentity: () => ({ roleCode: "SUPER_ADMIN" }) },
    "../../api": { setPreferredAdminActivityCode() {} },
  });
  const statuses = ["DRAFT", "SCHEDULED", "ACTIVE", "CLOSED", "FINISHED", "ARCHIVED"];
  const html = renderToStaticMarkup(React.createElement(ActivitySwitcher, { activities: {
    activityMenuOpen: true, departments: [], activityDepartmentFilter: "",
    visibleActivities: statuses.map((status, id) => ({ ...activity, id, status, name: status })),
  } }));
  for (const [css, label] of [["draft", "草稿"], ["scheduled", "待开始"], ["running", "订货中"], ["ended", "订货已截止"], ["finished", "活动已结束"]]) assert.ok(html.includes(`<em class="${css}">${label}</em>`));
  assert.equal((html.match(/activity-archive-badge/g) || []).length, 2);
  assert.match(html, /unarchived">未归档/); assert.match(html, /archived">已归档/);
  assert.doesNotMatch(html, /活动范围|删除进度/); assert.match(html, /按部门筛选/);
});
test("archived order controls disable mutation while export and filters remain available", async () => {
  const model = { readOnly: true, activityStarted: true, activityClosed: true, activityFinished: true, canExport: true, exports: { busy: false }, orderCounts: {}, orderFilter: "全部", customerType: "全部", search: "", setOrderFilter() {}, setCustomerType() {}, setSearch() {}, setPage() {} };
  const h = hookHarness("app/components/orders/OrderFilterBar.tsx", "OrderFilterBar", [{ model }]);
  assert.equal(button(h, "＋ 新增订单").props.disabled, true); assert.equal(button(h, "导出订单").props.disabled, false);
  assert.match(text(h.model), /所有订单只读/);
});

test("progress pauses while hidden, refreshes on return and stops after completion or unmount", async () => {
  const listeners=new Map();let visibilityState="visible",status="RUNNING",calls=0,signal;
  const h=hookHarness("app/features/admin/ActivityDeletionTasks.tsx","ActivityDeletionTasks",[{onClose(){}}],{
    "../../api":{loadActivityDeletionTasks:async(page,s)=>{calls++;signal=s;return [{id:1,activityName:"测试",status,stageName:"清理关联业务数据",deletedRows:500,deletedFiles:0,createdAt:"2026-11-03T01:00:00Z"}];}},
    "../shared/time":{formatBeijingTime:v=>v},
  },{AbortController,document:{get visibilityState(){return visibilityState;},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)}});
  await h.flush();assert.equal(calls,1);assert.equal(h.timers.size,1);
  visibilityState="hidden";listeners.get("visibilitychange")();await h.flush();assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(h.timers.size,0);
  visibilityState="visible";listeners.get("visibilitychange")();await h.flush();assert.equal(calls,2);
  status="COMPLETED";await h.runTimers();assert.equal(h.timers.size,0);assert.match(text(h.model),/数据和文件清理完成/);
  h.unmount();assert.equal(signal.aborted,true);assert.equal(listeners.size,0);assert.equal(h.timers.size,0);
});

test("failed cleanup exposes manual retry and then resumes live progress", async () => {
  let status="FAILED",retries=0;
  const h=hookHarness("app/features/admin/ActivityDeletionTasks.tsx","ActivityDeletionTasks",[{onClose(){}}],{
    "../../api":{loadActivityDeletionTasks:async()=>[{id:1,activityName:"测试",status,stageName:"文件清理",deletedRows:500,deletedFiles:0,createdAt:"2026-11-03T01:00:00Z",lastError:status==="FAILED"?"暂时失败":null}],retryActivityDeletionTask:async id=>{assert.equal(id,1);retries++;status="RUNNING";}},
    "../shared/time":{formatBeijingTime:v=>v},
  },{AbortController,document:{visibilityState:"visible",addEventListener(){},removeEventListener(){}}});
  await h.flush();assert.equal(h.timers.size,0);assert.match(text(h.model),/暂时失败/);
  await button(h,"继续清理").props.onClick();await h.flush();assert.equal(retries,1);assert.match(text(h.model),/清理中/);assert.equal(h.timers.size,1);h.unmount();
});

test("cleanup can pause after a batch, stops polling and resumes the saved progress", async () => {
  let status="RUNNING",pauses=0,resumes=0;
  const h=hookHarness("app/features/admin/ActivityDeletionTasks.tsx","ActivityDeletionTasks",[{onClose(){}}],{
    "../../api":{
      loadActivityDeletionTasks:async()=>[{id:1,activityName:"测试",status,stage:10,totalStages:43,stageDetail:"清理订单明细",deletedRows:415282,deletedFiles:0,lastProgressAt:"2026-11-05T11:00:00Z"}],
      pauseActivityDeletionTask:async id=>{assert.equal(id,1);pauses++;status="PAUSED";},
      resumeActivityDeletionTask:async id=>{assert.equal(id,1);resumes++;status="QUEUED";},
    },"../shared/time":{formatBeijingTime:v=>v},
  },{AbortController,document:{visibilityState:"visible",addEventListener(){},removeEventListener(){}}});
  await h.flush();assert.match(text(h.model),/清理订单明细（步骤 10\/43）/);assert.match(text(h.model),/最近推进/);
  assert.match(text(h.model),/暂停期间活动仍不可用/);
  await button(h,"暂停清理").props.onClick();await h.flush();assert.equal(pauses,1);assert.match(text(h.model),/已暂停/);
  assert.equal(h.timers.size,0);assert.match(text(h.model),/415,282/);
  await button(h,"继续清理").props.onClick();await h.flush();assert.equal(resumes,1);assert.match(text(h.model),/排队中/);assert.equal(h.timers.size,1);
  h.unmount();
});

test("automatic retry shows attempts and next attempt without a terminal failure alert", async () => {
  let status="RUNNING";
  const h=hookHarness("app/features/admin/ActivityDeletionTasks.tsx","ActivityDeletionTasks",[{onClose(){}}],{
    "../../api":{loadActivityDeletionTasks:async()=>[{id:1,status,activityName:"测试",stageName:"清理关联业务数据",deletedRows:500,deletedFiles:0,retryCount:status==="RUNNING"?2:5,maxRetries:5,nextAttemptAt:"下一次时间",lastError:"本批数据库操作超时"}]},
    "../shared/time":{formatBeijingTime:v=>v},
  },{AbortController,document:{visibilityState:"visible",addEventListener(){},removeEventListener(){}}});
  await h.flush();assert.match(text(h.model),/等待自动重试/);assert.match(text(h.model),/2\/5/);assert.match(text(h.model),/下次尝试：下一次时间/);
  assert.equal(nodes(h.model).filter(n=>n.props?.role==="alert").length,0);
  status="FAILED";await h.runTimers();assert.match(text(h.model),/5\/5 次，已停止自动重试/);
  assert.equal(nodes(h.model).filter(n=>n.props?.role==="alert").length,1);assert.equal(h.timers.size,0);h.unmount();
});

test("pause waits visibly, prevents duplicate submissions and preserves running state on failure", async () => {
  let rejectPause,pauses=0;
  const h=hookHarness("app/features/admin/ActivityDeletionTasks.tsx","ActivityDeletionTasks",[{onClose(){}}],{
    "../../api":{loadActivityDeletionTasks:async()=>[{id:1,status:"RUNNING",deletedRows:0,deletedFiles:0}],
      pauseActivityDeletionTask:()=>{pauses++;return new Promise((resolve,reject)=>{rejectPause=reject;});}},
    "../shared/time":{formatBeijingTime:v=>v},
  },{Error,AbortController,document:{visibilityState:"visible",addEventListener(){},removeEventListener(){}}});
  await h.flush();const click=button(h,"暂停清理").props.onClick;click();click();await h.flush();
  assert.equal(pauses,1);assert.equal(button(h,"正在等待当前批次结束…").props.disabled,true);
  rejectPause(new Error("请求未成功，请刷新确认"));await h.flush();assert.match(text(h.model),/请求未成功，请刷新确认/);
  assert.equal(button(h,"暂停清理").props.disabled,false);assert.match(text(h.model),/清理中/);h.unmount();
});

test("hidden or replaced progress reads are aborted and cannot overwrite the visible page", async () => {
  let visibilityState = "visible";
  const listeners = new Map(), reads = [];
  const h = hookHarness("app/features/admin/ActivityDeletionTasks.tsx", "ActivityDeletionTasks", [{ onClose() {} }], {
    "../../api": { loadActivityDeletionTasks: (page, signal) => new Promise(resolve => reads.push({ page, signal, resolve })) },
    "../shared/time": { formatBeijingTime: v => v },
  }, { AbortController, document: { get visibilityState() { return visibilityState; }, addEventListener: (n, f) => listeners.set(n, f), removeEventListener: n => listeners.delete(n) } });
  const changeVisibility = async value => { visibilityState = value; listeners.get("visibilitychange")(); await h.flush(); };
  const task = name => ({ id: 1, activityName: name, status: "RUNNING", deletedRows: 0, deletedFiles: 0 });
  await changeVisibility("hidden"); assert.equal(reads[0].signal.aborted, true);
  await changeVisibility("visible"); assert.equal(reads.length, 2);
  reads[1].resolve([task("最新任务")]); await h.flush();
  reads[0].resolve([task("过期任务")]); await h.flush();
  assert.match(text(h.model), /最新任务/); assert.doesNotMatch(text(h.model), /过期任务/); assert.equal(h.timers.size, 1);
  button(h, "刷新进度").props.onClick(); await h.flush(); assert.equal(h.timers.size, 0);
  const last = reads.at(-1); h.unmount(); assert.equal(last.signal.aborted, true);
  const writes = h.writes; last.resolve([task("关闭后的任务")]); await h.flush(); assert.equal(h.writes, writes);
});

test("progress pagination reads only the selected page and stops polling a completed page", async () => {
  const calls = [], signals = [];
  const h = hookHarness("app/features/admin/ActivityDeletionTasks.tsx", "ActivityDeletionTasks", [{ onClose() {} }], {
    "../../api": { loadActivityDeletionTasks: async (page, signal) => {
      calls.push(page); signals.push(signal);
      return Array.from({ length: page === 1 ? 20 : 1 }, (_, i) => ({ id: page * 100 + i, activityName: `第${page}页任务`, status: page === 1 ? "QUEUED" : "COMPLETED", deletedRows: 0, deletedFiles: 0 }));
    } }, "../shared/time": { formatBeijingTime: v => v },
  }, { AbortController, document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} } });
  await h.flush(); assert.deepEqual(calls, [1]); assert.equal(button(h, "下一页").props.disabled, false);
  button(h, "下一页").props.onClick(); await h.flush(); assert.deepEqual(calls, [1, 2]);
  assert.equal(signals[0].aborted, true); assert.equal(h.timers.size, 0); assert.equal(button(h, "下一页").props.disabled, true);
  await h.runTimers(); assert.deepEqual(calls, [1, 2]);
  button(h, "上一页").props.onClick(); await h.flush(); assert.deepEqual(calls, [1, 2, 1]); assert.equal(h.timers.size, 1);
  h.unmount(); assert.equal(signals.at(-1).aborted, true); assert.equal(h.timers.size, 0);
});
