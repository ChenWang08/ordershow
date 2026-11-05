import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";

function activitiesHarness({ items = [], saved = "", role = "SUPER_ADMIN", apiOverrides = {} } = {}) {
  const calls = [];
  const notices = [];
  const effects = [];
  const slots = [];
  let cursor = 0;
  let mounted = false;
  let cleanups = [];
  const { useAdminActivities } = loadModule("app/features/admin/useAdminActivities.ts", {
    "./useActivityCopy": { useActivityCopy: () => ({ enabled: false, task: null, reset() {} }) },
    "../../api": {
      ApiError: class ApiError extends Error {},
      loadAdminActivities: async () => items,
      loadAdminDepartments: async () => { calls.push("departments"); return [{ id: 9, code: "DEFAULT", status: "ACTIVE" }]; },
      getPreferredAdminActivityCode: () => saved,
      setPreferredAdminActivityCode: (code) => calls.push(["preferred", code]),
      createActivity: async (body) => { calls.push(["create", body]); return { code: "CREATED" }; },
      ...apiOverrides,
    },
    "../../admin-context": { useAdminIdentity: () => ({ roleCode: role }) },
    react: {
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useMemo: (compute) => compute(),
      useEffect: (effect) => { if (!mounted) effects.push(effect); },
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
    },
  }, { sessionStorage: { getItem: () => null }, window: {
    location: { replace: (url) => calls.push(["replace", url]), assign: (url) => calls.push(["assign", url]) },
    setInterval: (_callback, delay) => { calls.push(["timer", delay]); return 1; },
    clearInterval: (id) => calls.push(["clearTimer", id]),
  } });
  return {
    calls, notices,
    render: function useActivitiesRender() { cursor = 0; return useAdminActivities({ activityId: "1", activityCode: "CURRENT", setActionNotice: (value) => notices.push(value) }); },
    mount() { mounted = true; cleanups = effects.map((effect) => effect()); },
    unmount() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

const validDraft = { name: "新活动", startsAt: "2099-01-01T10:00", endsAt: "2099-01-01T12:00", eventEndsAt: "2099-01-01T16:00", departmentId: "9" };

test("activity selection prefers a running activity when the saved choice is absent", async () => {
  const harness = activitiesHarness({ items: [{ code: "DRAFT", status: "DRAFT" }, { code: "LIVE", status: "ACTIVE" }] });
  harness.render(); harness.mount(); await settle();
  assert.ok(harness.calls.some((call) => call[0] === "preferred" && call[1] === "LIVE"));
  assert.ok(harness.calls.some((call) => call[0] === "replace" && call[1] === "/admin"));
  harness.unmount();
  assert.deepEqual(harness.calls.at(-1), ["clearTimer", 1]);
});

test("an existing saved activity takes priority over other running activities", async () => {
  const harness = activitiesHarness({ saved: "CURRENT", items: [{ code: "CURRENT", status: "DRAFT" }, { code: "LIVE", status: "ACTIVE" }] });
  harness.render(); harness.mount(); await settle();
  assert.equal(harness.calls.some((call) => ["preferred", "replace"].includes(call[0])), false);
  harness.unmount();
});

test("department accounts neither load departments nor send a chosen department when creating", async () => {
  const harness = activitiesHarness({ role: "DEPARTMENT_ADMIN" });
  harness.render(); harness.mount(); await settle();
  harness.render().setNewActivity(validDraft);
  await harness.render().submitNewActivity();
  assert.equal(harness.calls.includes("departments"), false);
  const creation = harness.calls.find((call) => call[0] === "create");
  assert.equal(Object.hasOwn(creation[1], "departmentId"), false);
  assert.deepEqual(harness.calls.at(-1), ["assign", "/admin"]);
  harness.unmount();
});

test("super admins must choose a department before creating an activity", async () => {
  const harness = activitiesHarness();
  harness.render().setNewActivity({ ...validDraft, departmentId: "" });
  await harness.render().submitNewActivity();
  assert.deepEqual(harness.calls, []);
  assert.match(harness.notices.at(-1), /必须选择所属部门/);
});

test("invalid activity end times do not reach the API", async () => {
  const harness = activitiesHarness();
  harness.render().setNewActivity({ ...validDraft, eventEndsAt: "2099-01-01T11:00" });
  await harness.render().submitNewActivity();
  assert.deepEqual(harness.calls, []);
  assert.match(harness.notices.at(-1), /必须晚于订货截止时间/);
});

test("creation failure leaves the drawer open and allows retry", async () => {
  const harness = activitiesHarness({ apiOverrides: { createActivity: async () => { throw new Error("offline"); } } });
  harness.render().setNewActivityOpen(true);
  harness.render().setNewActivity(validDraft);
  await harness.render().submitNewActivity();
  assert.equal(harness.render().creatingActivity, false);
  assert.equal(harness.render().newActivityOpen, true);
  assert.equal(harness.calls.length, 0);
});


function initializationHarness(apiOverrides = {}, identity = { roleCode: "SUPER_ADMIN" }) {
  const state = {}, calls = [], notices = [], reads = [];
  const base = {
    loadAdminProducts: async () => [{ id: 42, images: [], materialName: "已发布商品", version: 3 }],
    loadProductImageReviews: async () => [],
    loadAdminCustomers: async () => [{ id: 21, regionCode: "EAST", customerType: "GENERAL", dealerFullName: "客户", active: true }],
    loadAdminAttendees: async () => [],
    loadLotteryRules: async () => [{ id: 1, status: "DRAFT" }, { id: 2, status: "PUBLISHED" }],
    loadAuditLogs: async () => [], loadImportTasks: async () => [],
    loadImportRows: async (_id, taskId) => [{ id: taskId * 10, sheetName: "Sheet1", sourceRowNumber: 2, normalizedData: { materialName: "商品预览", dealerFullName: "客户预览", participantName: "到场预览" } }],
    loadAttendanceMatchPreview: async () => ({ whitelistVersionId: 5, rows: [{ stagingRowId: 30, activityCustomerId: 21, matchStatus: "MATCHED", lotteryEligible: true }] }),
    ...apiOverrides,
  };
  const api = Object.fromEntries(Object.entries(base).map(([name, fn]) => [name, (...args) => { reads.push([name,...args]); return fn(...args); }]));
  const setterNames = ["onAttendanceFileNameChange", "onLotteryChange", "onProductImportCompleted", "onWhitelistImportCompleted",
    "setAttendanceRows", "setProductRows", "setWhitelistRows", "setPendingProductRollbackRows", "setProductFileName",
    "setProductImportInputCount", "setProductSheetCounts", "setPendingWhitelistRollbackRows", "setWhitelistFileName",
    "setWhitelistImportInputCount", "setWhitelistSheetCounts", "setAttendanceImportAttemptName", "setAttendanceMatchPreview",
    "setPendingAttendanceImport", "setOperationLogs", "setServerImportTasks", "setServerImportBlocking"];
  let options = Object.fromEntries(setterNames.map(name => [name, value => {
    calls.push(name); state[name] = typeof value === "function" ? value(state[name]) : value;
  }]));
  options = { ...options, activityId: "1", activity: { regions: [{code:"EAST",name:"华东"}] }, tab: "活动概览", logsOpen:false,
    onProductImportCommitted: () => calls.push("productCommitted"), onWhitelistImportCommitted: () => calls.push("whitelistCommitted"),
    setActionNotice: notice => notices.push(notice) };
  const h = hookHarness("app/features/admin/useAdminInitialization.ts", "useAdminInitialization", [options], {
    "../../admin-context": { useAdminIdentity: () => identity },
    "../lottery/Lottery": { initialLotteryRounds: [], mapLotteryRule: rule => [rule.id] }, "../../api": api,
  });
  return { ...h, state, calls, reads, notices, api, get model(){return h.model;},
    async show(tab, logsOpen=false) { options={...options,tab,logsOpen, preservePreviews: {
      product: Boolean(state.setProductFileName && !state.onProductImportCompleted),
      whitelist: Boolean(state.setWhitelistFileName && !state.onWhitelistImportCompleted),
      attendance: Boolean(state.setPendingAttendanceImport), lottery: false,
    }}; h.render([options]); await h.flush(); },
  };
}

test("overview initialization performs no module reads; each whole module reads on every entry", async () => {
  const h=initializationHarness(); await h.flush(); assert.deepEqual(h.reads,[]);
  await h.show("商品导入"); assert.equal(h.state.setProductRows[0].id,"42");
  assert.deepEqual(h.reads.map(r=>r[0]).sort(),["loadAdminProducts","loadImportTasks","loadProductImageReviews"].sort());
  assert.equal(h.reads.find(r=>r[0]==="loadImportTasks")[2],"PRODUCT");
  await h.show("白名单"); assert.equal(h.state.setWhitelistRows[0].region,"华东");
  await h.show("商品导入"); assert.equal(h.reads.filter(r=>r[0]==="loadAdminProducts").length,2);
  await h.show("抽奖规则"); assert.equal(h.state.onLotteryChange[0],2); h.unmount();
});

test("opening a module restores only its preview and keeps published rollback data across tab switches", async () => {
  const h=initializationHarness({loadImportTasks: async () => ["PRODUCT","WHITELIST","ATTENDANCE"].map((importType,index)=>({id:index+1,importType,status:"PREVIEW_READY",sourceFilename:importType+".xlsx",inputCount:1,errorCount:index}))});
  await h.show("商品导入"); assert.equal(h.state.setPendingProductRollbackRows[0].id,"42");
  assert.equal(h.state.setProductRows[0].materialName,"商品预览"); assert.equal(h.state.setWhitelistRows,undefined);
  assert.equal(h.state.setPendingAttendanceImport,undefined);
  await h.show("白名单"); assert.equal(h.state.setPendingWhitelistRollbackRows[0].id,"21");
  assert.equal(h.state.setWhitelistRows[0].dealerFull,"客户预览");
  await h.show("现场到场"); assert.equal(h.state.setPendingAttendanceImport.rows[0].activityCustomerId,21);
  assert.equal(h.state.setServerImportBlocking.ATTENDANCE,2);
  const product=h.state.setProductRows; await h.show("商品导入"); assert.equal(h.state.setProductRows,product);
  assert.equal(h.reads.filter(r=>r[0]==="loadImportRows").length,3); h.unmount();
});

test("leaving a module aborts unfinished reads and rejects late data", async () => {
  let resolve; const h=initializationHarness({loadAdminProducts:()=>new Promise(yes=>{resolve=yes;})});
  await h.show("商品导入"); const signal=h.reads.find(r=>r[0]==="loadAdminProducts")[3];
  await h.show("白名单"); assert.equal(signal.aborted,true);
  resolve([{id:42,images:[],materialName:"迟到商品"}]); await h.flush(); assert.equal(h.state.setProductRows,undefined); h.unmount();
});

test("failed module reads expose retry without replacing existing data", async () => {
  let fail=false; const h=initializationHarness({loadAdminProducts:async()=>{if(fail)throw Error("offline");return [{id:42,images:[],materialName:"原商品"}];}});
  await h.show("商品导入"); const old=h.state.setProductRows; fail=true;
  await h.model.product.refresh(); await h.flush(); assert.equal(h.state.setProductRows,old);
  assert.match(h.model.product.error,/offline|加载失败/); fail=false;
  await h.model.product.refresh(); await h.flush(); assert.equal(h.model.product.error,""); h.unmount();
});

for(const [permission,tab] of [["OVERVIEW","活动概览"],["PRODUCT","商品导入"],["WHITELIST","白名单"],["ATTENDANCE","现场到场"],["ORDER","订单管理"],["LOTTERY","抽奖规则"]]) {
  test("member reads only an opened permitted module: "+permission,async()=>{
    const h=initializationHarness({}, {roleCode:"DEPARTMENT_MEMBER",permissions:[permission]});
    await h.flush(); assert.equal(h.reads.length,0); await h.show(tab);
    const allowed={PRODUCT:["loadAdminProducts","loadProductImageReviews","loadImportTasks"],WHITELIST:["loadAdminCustomers","loadImportTasks"],ATTENDANCE:["loadAdminAttendees","loadImportTasks"],LOTTERY:["loadLotteryRules"]}[permission]??[];
    assert.ok(h.reads.every(r=>allowed.includes(r[0])));
    const before=h.reads.length; await h.show("商品导入",true);
    if(permission!=="PRODUCT")assert.equal(h.reads.length,before); h.unmount();
  });
}

test("logs read only when opened and reload on every reopening",async()=>{
  const h=initializationHarness(); await h.flush(); assert.equal(h.reads.length,0);
  await h.show("活动概览",true); assert.deepEqual(h.reads.map(r=>r[0]),["loadAuditLogs"]);
  await h.show("活动概览"); h.model.logs.invalidate(); await h.show("活动概览",true);
  assert.equal(h.reads.length,2); await h.show("活动概览"); await h.show("活动概览",true);
  assert.equal(h.reads.length,3); h.unmount();
});

test('members cannot open or submit new activities',async()=>{
  const h=activitiesHarness({role:'DEPARTMENT_MEMBER'}); h.render().openNewActivity();
  assert.equal(h.render().newActivityOpen,false); h.render().setNewActivity(validDraft); await h.render().submitNewActivity();
  assert.equal(h.calls.some(c=>c[0]==='create'),false);
});
