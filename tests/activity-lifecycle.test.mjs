import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness.mjs";

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
test("existing switcher defaults to unarchived, filters archived/all, and supports an all-archived account", async () => {
  const items = [{ ...activity, status: "FINISHED" }, { ...activity, id: 8, code: "ACT8", status: "ARCHIVED" }];
  const mocks = {
    "../../admin-context": { useAdminIdentity: () => ({ roleCode: "SUPER_ADMIN" }) },
    "../../api": { loadAdminActivities: async () => items },
  };
  const globals = { sessionStorage: { getItem: () => null } };
  const h = hookHarness("app/features/admin/useAdminActivities.ts", "useAdminActivities", [{ activityId: "7", activityCode: "ACT7", initialActivities: items, setActionNotice() {} }], mocks, globals);
  await h.flush(); assert.equal(h.model.visibleActivities.length, 1); assert.equal(h.model.visibleActivities[0].id, 7);
  h.model.setActivityArchiveFilter("archived"); await h.flush(); assert.equal(h.model.visibleActivities[0].id, 8);
  h.model.setActivityArchiveFilter("all"); await h.flush(); assert.equal(h.model.visibleActivities.length, 2); h.unmount();
  const a = hookHarness("app/features/admin/useAdminActivities.ts", "useAdminActivities", [{ activityId: "", activityCode: "", initialActivities: [items[1]], setActionNotice() {} }], mocks, globals);
  assert.equal(a.model.activityArchiveFilter, "archived"); assert.equal(a.model.visibleActivities.length, 1); a.unmount();
});
test("archived order controls disable mutation while export and filters remain available", async () => {
  const model = { readOnly: true, activityStarted: true, activityClosed: true, orderCounts: {}, orderFilter: "全部", customerType: "全部", search: "", setOrderFilter() {}, setCustomerType() {}, setSearch() {}, setPage() {} };
  const h = hookHarness("app/components/orders/OrderFilterBar.tsx", "OrderFilterBar", [{ model }]);
  assert.equal(button(h, "＋ 新增订单").props.disabled, true); assert.equal(button(h, "导出订单").props.disabled, undefined);
  assert.match(text(h.model), /所有订单只读/);
});

test("progress pauses while hidden, refreshes on return and stops after completion or unmount", async () => {
  const listeners=new Map();let visibilityState="visible",status="RUNNING",calls=0,signal;
  const h=hookHarness("app/features/admin/ActivityDeletionTasks.tsx","ActivityDeletionTasks",[{onClose(){}}],{
    "../../api":{loadActivityDeletionTasks:async(page,s)=>{calls++;signal=s;return [{id:1,activityName:"测试",status,stageName:"清理关联业务数据",deletedRows:500,deletedFiles:0,createdAt:"2026-11-03T01:00:00Z"}];}},
    "../shared/time":{formatBeijingTime:v=>v},
  },{AbortController,document:{get visibilityState(){return visibilityState;},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)}});
  await h.flush();assert.equal(calls,1);assert.equal(h.timers.size,1);
  visibilityState="hidden";await h.runTimers();assert.equal(calls,1);assert.equal(h.timers.size,0);
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
