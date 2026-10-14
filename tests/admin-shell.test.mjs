import assert from "node:assert/strict";
import { setImmediate as settle } from "node:timers/promises";
import test from "node:test";
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
      useMemo: (compute) => compute(),
      useEffect: (effect) => { if (!mounted) effects.push(effect); },
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
    },
  }, { window: {
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
  const state = {};
  const notices = [];
  const calls = [];
  let effect;
  const { useAdminInitialization } = loadModule("app/features/admin/useAdminInitialization.ts", {
    react: { useEffect: (callback) => { effect = callback; } },
    "../../admin-context": { useAdminIdentity: () => identity },
    "../lottery/Lottery": { mapLotteryRule: (rule) => [rule.id] },
    "../../api": {
      ApiError: class ApiError extends Error {},
      loadAdminActivity: async () => ({ regions: [{ code: "EAST", name: "华东" }] }),
      loadAdminProducts: async () => [{ id: 42, images: [], materialName: "已发布商品", version: 3 }],
      loadProductImageReviews: async () => [],
      loadAdminCustomers: async () => [{ id: 21, regionCode: "EAST", customerType: "GENERAL", dealerFullName: "客户", active: true }],
      loadAdminAttendees: async () => [],
      loadLotteryRules: async () => [{ id: 1, status: "DRAFT" }, { id: 2, status: "PUBLISHED" }],
      loadAuditLogs: async () => [],
      loadImportTasks: async () => [],
      loadImportRows: async (_activityId, taskId) => [{ id: taskId * 10, sheetName: "Sheet1", sourceRowNumber: 2, normalizedData: { materialName: "商品预览", dealerFullName: "客户预览", participantName: "到场预览" } }],
      loadAttendanceMatchPreview: async () => ({ whitelistVersionId: 5, rows: [{ stagingRowId: 30, activityCustomerId: 21, matchStatus: "MATCHED", lotteryEligible: true }] }),
      ...apiOverrides,
    },
  });
  const setterNames = ["onAttendanceFileNameChange", "onLotteryChange", "onProductImportCompleted", "onWhitelistImportCompleted",
    "setAttendanceRows", "setProductRows", "setWhitelistRows", "setPendingProductRollbackRows", "setProductFileName",
    "setProductImportInputCount", "setProductSheetCounts", "setPendingWhitelistRollbackRows", "setWhitelistFileName",
    "setWhitelistImportInputCount", "setWhitelistSheetCounts", "setAttendanceImportAttemptName", "setAttendanceMatchPreview",
    "setPendingAttendanceImport", "setRegionCodesByName", "setOperationLogs", "setServerImportTasks", "setServerImportBlocking"];
  const options = Object.fromEntries(setterNames.map((name) => [name, (value) => {
    calls.push(name);
    state[name] = typeof value === "function" ? value(state[name]) : value;
  }]));
  options.activityId = "1";
  options.onProductImportCommitted = () => calls.push("productCommitted");
  options.onWhitelistImportCommitted = () => calls.push("whitelistCommitted");
  options.setActionNotice = (notice) => notices.push(notice);
  return {
    state, calls, notices,
    mount: function useInitializationMount() { useAdminInitialization(options); return effect(); },
  };
}

test("initialization restores published data, region names and the published lottery rule", async () => {
  const harness = initializationHarness();
  const cleanup = harness.mount(); await settle();
  assert.equal(harness.state.setProductRows[0].id, "42");
  assert.equal(harness.state.setWhitelistRows[0].region, "华东");
  assert.equal(harness.state.onLotteryChange[0], 2);
  assert.equal(harness.state.onProductImportCompleted, true);
  cleanup();
});

test("initialization restores all pending previews while retaining published rollback data", async () => {
  const harness = initializationHarness({ loadImportTasks: async () => ["PRODUCT", "WHITELIST", "ATTENDANCE"].map((importType, index) => ({ id: index + 1, importType, status: "PREVIEW_READY", sourceFilename: `${importType}.xlsx`, inputCount: 1, errorCount: index })) });
  const cleanup = harness.mount(); await settle();
  assert.equal(harness.state.setPendingProductRollbackRows[0].id, "42");
  assert.equal(harness.state.setProductRows[0].materialName, "商品预览");
  assert.equal(harness.state.setPendingWhitelistRollbackRows[0].id, "21");
  assert.equal(harness.state.setWhitelistRows[0].dealerFull, "客户预览");
  assert.equal(harness.state.onProductImportCompleted, false);
  assert.equal(harness.state.onWhitelistImportCompleted, false);
  assert.equal(harness.state.setPendingAttendanceImport.rows[0].activityCustomerId, 21);
  assert.equal(harness.state.setAttendanceMatchPreview.whitelistVersionId, 5);
  assert.equal(harness.state.setServerImportBlocking.ATTENDANCE, 2);
  assert.match(harness.notices.at(-1), /已恢复服务器中尚未确认的导入预览/);
  cleanup();
});

test("initialization ignores a response that arrives after cleanup", async () => {
  let resolveActivity;
  const harness = initializationHarness({ loadAdminActivity: () => new Promise((resolve) => { resolveActivity = resolve; }) });
  const cleanup = harness.mount(); cleanup();
  resolveActivity({ regions: [] }); await settle();
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.notices, []);
});

test("initialization also ignores a staging response arriving after cleanup", async () => {
  let resolveStaging;
  const harness = initializationHarness({
    loadImportTasks: async () => [{ id: 1, importType: "PRODUCT", status: "PREVIEW_READY" }],
    loadImportRows: () => new Promise((resolve) => { resolveStaging = resolve; }),
  });
  const cleanup = harness.mount(); await settle();
  const previousCalls = harness.calls.length;
  cleanup(); resolveStaging([]); await settle();
  assert.equal(harness.calls.length, previousCalls);
  assert.deepEqual(harness.notices, []);
});

test("initialization reports load failure without replacing existing data", async () => {
  const harness = initializationHarness({ loadAdminProducts: async () => { throw new Error("offline"); } });
  const cleanup = harness.mount(); await settle();
  assert.deepEqual(harness.calls, []);
  assert.match(harness.notices.at(-1), /后台数据加载失败/);
  cleanup();
});

for (const permission of ['OVERVIEW', 'PRODUCT', 'WHITELIST', 'ATTENDANCE', 'ORDER', 'LOTTERY']) {
  test('member initialization loads only granted module: ' + permission, async () => {
    const requested = [];
    const methods = { loadAdminProducts: 'PRODUCT', loadProductImageReviews: 'PRODUCT', loadAdminCustomers: 'WHITELIST',
      loadAdminAttendees: 'ATTENDANCE', loadLotteryRules: 'LOTTERY', loadAuditLogs: 'AUDIT', loadImportTasks: 'IMPORT' };
    const overrides = Object.fromEntries(Object.entries(methods).map(([method, module]) => [method, async () => { requested.push(module); return []; }]));
    const h = initializationHarness(overrides, { roleCode: 'DEPARTMENT_MEMBER', permissions: [permission] });
    h.mount(); await settle();
    assert.deepEqual(h.notices, []);
    assert.ok(requested.every(module => module === permission || module === 'IMPORT' && ['PRODUCT', 'WHITELIST', 'ATTENDANCE'].includes(permission)));
    assert.equal(requested.includes('AUDIT'), false);
  });
}
test('members cannot open or submit new activities', async () => {
  const h = activitiesHarness({ role: 'DEPARTMENT_MEMBER' });
  h.render().openNewActivity();
  assert.equal(h.render().newActivityOpen, false);
  h.render().setNewActivity(validDraft);
  await h.render().submitNewActivity();
  assert.equal(h.calls.some(c => c[0] === 'create'), false);
});
