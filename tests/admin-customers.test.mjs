import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

const customer = (id = "preview") => ({
  id, customerType: "综合客户", region: "华东", branch: "测试分公司", dealerShort: "测试客户",
  dealerFull: "测试客户有限公司", dealerType: "", dealerName: "测试联系人", dealerPhone: "138****0000",
  confirmerName: "测试确认人", confirmerPhone: "139****0000", status: "有效", source: "excel",
});
const attendee = (id = "preview") => ({
  id, dealerName: "参会人", dealerCompany: "测试客户有限公司", branch: "测试分公司",
  contactPhone: "13800000000", gender: "", participantType: "经销商", matchStatus: "MATCHED",
  activityCustomerId: 12, lotteryEligible: true,
});
const draft = () => ({ rows: [attendee()], fileName: "attendance.xlsx", warnings: [], sheetCounts: [], inputCount: 1 });

function customerHarness(overrides = {}, apiOverrides = {}) {
  const calls = [];
  const notices = [];
  const confirmations = [];
  const options = {
    activityId: "1", activityStatus: "draft", whitelistRows: [customer()], attendanceRows: [attendee("published")],
    whitelistImportCompleted: false, whitelistImportHasRun: true, regionCodesByName: { 华东: "EAST" },
    attendanceImportError: "", serverImportTasks: { WHITELIST: 7, ATTENDANCE: 8, PRODUCT: 9 },
    serverImportBlocking: {}, setActionNotice: (notice) => notices.push(notice), recordOperation: () => {},
    onWhitelistImportCommitted: () => calls.push("committed"),
    refreshServerImportPreview: async (type) => calls.push(["refresh", type]),
    ...overrides,
  };
  const update = (key) => (value) => { options[key] = typeof value === "function" ? value(options[key]) : value; };
  options.setWhitelistRows = update("whitelistRows");
  options.setAttendanceRows = update("attendanceRows");
  options.setWhitelistImportCompleted = update("whitelistImportCompleted");
  options.setServerImportTasks = update("serverImportTasks");
  options.setServerImportBlocking = update("serverImportBlocking");
  options.onAttendanceImportErrorChange = update("attendanceImportError");
  options.onAttendanceFileNameChange = update("attendanceFileName");
  options.onAttendanceWarningsChange = update("attendanceWarnings");
  options.onAttendanceSheetCountsChange = update("attendanceSheetCounts");
  const api = {
    ApiError: class ApiError extends Error {},
    cancelImport: async (...args) => calls.push(["cancel", ...args]),
    confirmImport: async (...args) => calls.push(["confirm", ...args]),
    waitForImport: async () => calls.push("wait"),
    loadAdminAttendees: async () => { calls.push("attendees"); return [{ id: 42, participantName: "参会人", matchStatus: "MATCHED", lotteryEligible: true, activityCustomerId: 12 }]; },
    updateImportRow: async (...args) => calls.push(["update-staging", ...args]),
    deleteImportRows: async (...args) => calls.push(["delete-staging", ...args]),
    deleteAdminCustomer: async (...args) => calls.push(["delete-customer", ...args]),
    ...apiOverrides,
  };
  // Action unit tests use explicit state slots, not a browser lifecycle simulation.
  const slots = [];
  let cursor = 0;
  const mocks = {
    "../../api": api,
    react: {
      useMemo: (calculate) => calculate(),
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
    },
  };
  const globals = { window: { confirm: (message) => { confirmations.push(message); return true; } } };
  const { useAttendanceManagement } = loadModule("app/features/admin/useAttendanceManagement.ts", mocks, globals);
  const { useWhitelistImport } = loadModule("app/features/admin/useWhitelistImport.ts", mocks, globals);
  const { useWhitelistEditor } = loadModule("app/features/admin/useWhitelistEditor.ts", mocks, globals);
  return {
    calls, notices, confirmations, options,
    render: function useCustomerRender() {
      cursor = 0;
      const attendance = useAttendanceManagement(options);
      const whitelist = useWhitelistImport({ ...options, pendingAttendanceImport: attendance.pendingAttendanceImport });
      const editor = useWhitelistEditor({ ...options, whitelistImport: whitelist });
      return { attendance, whitelist, editor };
    },
  };
}

test("whitelist cancellation restores confirmed rows without clearing other tasks", async () => {
  const harness = customerHarness();
  harness.render().whitelist.setPendingWhitelistRollbackRows([customer("published")]);
  await harness.render().whitelist.cancelWhitelistImport();
  assert.equal(harness.options.whitelistRows[0].id, "published");
  assert.equal(harness.options.whitelistImportCompleted, true);
  assert.equal(harness.options.serverImportTasks.WHITELIST, undefined);
  assert.equal(harness.options.serverImportTasks.ATTENDANCE, 8);
});

test("whitelist publication refreshes existing attendance and its pending preview", async () => {
  const harness = customerHarness();
  harness.render().attendance.setPendingAttendanceImport(draft());
  await harness.render().whitelist.confirmWhitelistImport();
  assert.deepEqual(harness.calls, [["confirm", 1, 7], "wait", "committed", "attendees", ["refresh", "ATTENDANCE"]]);
  assert.equal(harness.options.attendanceRows[0].id, "42");
});

test("blocked whitelist import cannot publish", async () => {
  const harness = customerHarness({ serverImportBlocking: { WHITELIST: 2 } });
  await harness.render().whitelist.confirmWhitelistImport();
  assert.deepEqual(harness.calls, []);
  assert.equal(harness.options.whitelistImportCompleted, false);
});

test("whitelist publication failure keeps the preview available", async () => {
  const harness = customerHarness({}, { confirmImport: async () => { throw new Error("failed"); } });
  const rows = harness.options.whitelistRows;
  await harness.render().whitelist.confirmWhitelistImport();
  assert.equal(harness.options.whitelistRows, rows);
  assert.equal(harness.options.whitelistImportCompleted, false);
  assert.match(harness.notices.at(-1), /白名单导入发布失败/);
});

test("editing a masked whitelist phone does not overwrite the stored phone", async () => {
  const harness = customerHarness();
  const row = { ...customer(), serverRowId: 31 };
  harness.render().editor.setEditingWhitelistRow(row);
  assert.equal(await harness.render().editor.saveWhitelistRow(row), true);
  const [, activityId, taskId, stagingId, changes] = harness.calls[0];
  assert.equal(activityId, 1);
  assert.equal(taskId, 7);
  assert.equal(stagingId, 31);
  assert.equal(Object.hasOwn(changes, "dealerPhone"), false);
  assert.equal(Object.hasOwn(changes, "confirmerPhone"), false);
  assert.deepEqual(harness.calls[1], ["refresh", "WHITELIST"]);
});

test("whitelist preview editing requires a staging ID", async () => {
  const harness = customerHarness();
  harness.render().editor.setEditingWhitelistRow(customer());
  assert.equal(await harness.render().editor.saveWhitelistRow(customer()), false);
  assert.deepEqual(harness.calls, []);
  assert.match(harness.notices.at(-1), /未绑定后端 staging/);
});

test("published whitelist deletion carries its version", async () => {
  const harness = customerHarness({ whitelistImportCompleted: true, whitelistRows: [{ ...customer("42"), serverVersion: 3 }] });
  await harness.render().editor.deleteWhitelistRows(["42"]);
  assert.deepEqual(harness.calls, [["delete-customer", 1, 42, 3]]);
  assert.equal(harness.options.whitelistRows.length, 0);
});

test("attendance cannot publish until matching completes", async () => {
  const harness = customerHarness();
  harness.render().attendance.setPendingAttendanceImport(draft());
  await harness.render().attendance.confirmAttendanceImport();
  assert.deepEqual(harness.calls, []);
  assert.match(harness.notices.at(-1), /实时试算完成/);
});

test("attendance publication carries the matched whitelist version and counts unique eligible customers", async () => {
  const harness = customerHarness();
  const model = harness.render().attendance;
  model.setPendingAttendanceImport({ ...draft(), rows: [attendee("a"), attendee("b"), { ...attendee("c"), matchStatus: "UNMATCHED", lotteryEligible: false, activityCustomerId: null }] });
  model.setAttendanceMatchPreview({ whitelistVersionId: 17 });
  await harness.render().attendance.confirmAttendanceImport();
  assert.deepEqual(harness.calls[0], ["confirm", 1, 8, undefined, undefined, 17]);
  assert.match(harness.confirmations[0], /资格客户 1 名/);
  assert.match(harness.confirmations[0], /未关联 1 条/);
  assert.equal(harness.options.attendanceRows[0].id, "42");
  assert.equal(harness.options.attendanceFileName, "attendance.xlsx");
  assert.equal(harness.render().attendance.pendingAttendanceImport, null);
  assert.equal(harness.render().attendance.attendancePublishing, false);
});

test("attendance publication failure retains preview and releases busy state", async () => {
  const harness = customerHarness({}, { confirmImport: async () => { throw new Error("version conflict"); } });
  const preview = draft();
  harness.render().attendance.setPendingAttendanceImport(preview);
  harness.render().attendance.setAttendanceMatchPreview({ whitelistVersionId: 17 });
  await harness.render().attendance.confirmAttendanceImport();
  assert.equal(harness.render().attendance.pendingAttendanceImport, preview);
  assert.equal(harness.render().attendance.attendancePublishing, false);
  assert.equal(harness.options.attendanceRows[0].id, "published");
});

test("attendance cancellation leaves the published list intact", async () => {
  const harness = customerHarness();
  harness.render().attendance.setPendingAttendanceImport(draft());
  const rows = harness.options.attendanceRows;
  await harness.render().attendance.cancelAttendanceImport();
  assert.equal(harness.options.attendanceRows, rows);
  assert.equal(harness.render().attendance.pendingAttendanceImport, null);
  assert.equal(harness.options.serverImportTasks.ATTENDANCE, undefined);
  assert.equal(harness.options.serverImportTasks.WHITELIST, 7);
});

test("failed attendance cancellation retains the preview for retry", async () => {
  const harness = customerHarness({}, { cancelImport: async () => { throw new Error("offline"); } });
  const preview = draft();
  harness.render().attendance.setPendingAttendanceImport(preview);
  await harness.render().attendance.cancelAttendanceImport();
  assert.equal(harness.render().attendance.pendingAttendanceImport, preview);
  assert.equal(harness.options.serverImportTasks.ATTENDANCE, 8);
});

test("attendance preview deletion does not modify published attendees", async () => {
  const harness = customerHarness();
  harness.render().attendance.setPendingAttendanceImport({ ...draft(), rows: [{ ...attendee(), serverRowId: 31 }] });
  const published = harness.options.attendanceRows;
  await harness.render().attendance.deleteAttendanceRows(["preview"]);
  assert.equal(harness.options.attendanceRows, published);
  assert.equal(harness.render().attendance.pendingAttendanceImport.rows.length, 0);
  assert.equal(harness.calls[0][0], "delete-staging");
  assert.equal(harness.calls[0][3][0], 31);
  assert.deepEqual(harness.calls[1], ["refresh", "ATTENDANCE"]);
});

test("closed activities reject customer and attendance writes", async () => {
  const harness = customerHarness({ activityStatus: "closed" });
  const { editor, whitelist, attendance } = harness.render();
  assert.equal(await editor.saveWhitelistRow(customer()), false);
  await editor.deleteWhitelistRows(["preview"]);
  await whitelist.confirmWhitelistImport();
  assert.equal(await attendance.saveAttendanceRow(attendee()), false);
  await attendance.deleteAttendanceRows(["published"]);
  await attendance.handleAttendanceFile({ name: "attendance.xlsx" });
  assert.deepEqual(harness.calls, []);
});
