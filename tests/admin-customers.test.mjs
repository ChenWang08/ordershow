import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

function customerHarness(overrides = {}, apiOverrides = {}, domainOverrides = {}) {
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
    loadAdminCustomers: async () => { calls.push("customers"); return [{ id: 52, lockVersion: 3, dealerFullName: "正式客户", customerType: "GENERAL", active: true, phoneMasked: "138****0000" }]; },
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
    "../../api": api, "../api": api,
    "../../domain/import-domain": {
      ...loadModule("app/domain/import-domain.ts"),
      parseAttendanceWorkbook: async () => draft(),
      ...domainOverrides,
    },
    react: {
      useMemo: (calculate) => calculate(),
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
    },
  };
  const globals = { Error, window: { confirm: (message) => { confirmations.push(message); return true; } } };
  const { useAttendanceManagement } = loadModule("app/features/admin/useAttendanceManagement.ts", mocks, globals);
  const { useWhitelistImport } = loadModule("app/features/admin/useWhitelistImport.ts", mocks, globals);
  const { useWhitelistEditor } = loadModule("app/features/admin/useWhitelistEditor.ts", mocks, globals);
  return {
    calls, notices, confirmations, options, api,
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

test("whitelist publication preserves attendance drafts without reading the hidden module", async () => {
  const harness = customerHarness();
  harness.render().attendance.setPendingAttendanceImport(draft());
  await harness.render().whitelist.confirmWhitelistImport();
  assert.deepEqual(harness.calls, [["confirm", 1, 7], "wait", "customers", "committed"]);
  assert.equal(harness.options.attendanceRows[0].id, "published");
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
  assert.equal((await harness.render().editor.saveWhitelistRow(row)).ok, true);
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
  const result = await harness.render().editor.saveWhitelistRow(customer());
  assert.equal(result.ok, false);
  assert.deepEqual(harness.calls, []);
  assert.match(result.message, /未绑定后端 staging/);
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
  assert.equal((await editor.saveWhitelistRow(customer())).ok, false);
  await editor.deleteWhitelistRows(["preview"]);
  await whitelist.confirmWhitelistImport();
  assert.equal((await attendance.saveAttendanceRow(attendee())).ok, false);
  await attendance.deleteAttendanceRows(["published"]);
  await attendance.handleAttendanceFile({ name: "attendance.xlsx" });
  assert.deepEqual(harness.calls, []);
});

test("attendance matching failure retains uploaded rows and task for retry", async () => {
  const harness = customerHarness({}, {
    uploadImport: async () => ({ id: 91, errorCount: 0 }),
    loadImportRows: async () => [],
    loadAttendanceMatchPreview: async () => { throw new Error("server failure"); },
  });
  await harness.render().attendance.handleAttendanceFile({ name: "attendance.xlsx" });
  const model = harness.render().attendance;
  assert.equal(model.pendingAttendanceImport.rows.length, 1);
  assert.equal(harness.options.serverImportTasks.ATTENDANCE, 91);
  assert.equal(model.attendancePreviewReady, false);
  assert.equal(model.attendancePreviewLoading, false);
  assert.match(harness.options.attendanceImportError, /^白名单关联试算失败/);
  await model.confirmAttendanceImport();
  assert.equal(harness.confirmations.length, 0);
  await model.retryAttendancePreview();
  assert.deepEqual(harness.calls, [["refresh", "ATTENDANCE"]]);
  assert.equal(harness.options.attendanceRows[0].id, "published");
});

test("attendance staging read failure retains the draft for retry", async () => {
  const harness = customerHarness({}, {
    uploadImport: async () => ({ id: 91, errorCount: 0 }),
    loadImportRows: async () => { throw new Error("offline"); },
  });
  await harness.render().attendance.handleAttendanceFile({ name: "attendance.xlsx" });
  assert.equal(harness.render().attendance.pendingAttendanceImport.rows.length, 1);
  assert.equal(harness.options.serverImportTasks.ATTENDANCE, 91);
  assert.match(harness.options.attendanceImportError, /^导入预览读取失败/);
});

test("attendance parse and upload errors are distinguished and clear stale matching", async () => {
  for (const parsing of [true, false]) {
    const harness = customerHarness({}, {
      uploadImport: async () => { throw new Error("offline"); },
    }, parsing ? { parseAttendanceWorkbook: async () => { throw new Error("bad headers"); } } : {});
    harness.render().attendance.setPendingAttendanceImport(draft());
    harness.render().attendance.setAttendanceMatchPreview({ whitelistVersionId: 17 });
    await harness.render().attendance.handleAttendanceFile({ name: "new.xlsx" });
    const model = harness.render().attendance;
    assert.equal(model.pendingAttendanceImport, null);
    assert.equal(model.attendancePreviewReady, false);
    assert.equal(model.attendancePreviewLoading, false);
    assert.equal(harness.options.serverImportTasks.ATTENDANCE, 8);
    assert.match(harness.options.attendanceImportError, parsing ? /^文件解析失败/ : /^文件上传或服务端校验失败/);
  }
});

test("attendance retry failure is handled and preserves the uploaded draft", async () => {
  const harness = customerHarness({ refreshServerImportPreview: async () => { throw new Error("offline"); } });
  harness.render().attendance.setPendingAttendanceImport(draft());
  await harness.render().attendance.retryAttendancePreview();
  assert.equal(harness.render().attendance.pendingAttendanceImport.rows.length, 1);
  assert.match(harness.options.attendanceImportError, /^导入预览或白名单关联试算失败/);
  assert.equal(harness.render().attendance.attendancePreviewReady, false);
});

test("zero-match attendance can publish with no whitelist version", async () => {
  const harness = customerHarness({}, {
    uploadImport: async () => ({ id: 91, errorCount: 0 }),
    loadImportRows: async () => [],
    loadAttendanceMatchPreview: async () => ({ whitelistVersionId: null, rows: [], matchedCount: 0, pendingCount: 0, unmatchedCount: 1 }),
  }, { parseAttendanceWorkbook: async () => ({ ...draft(), rows: [{ ...attendee(), matchStatus: "UNMATCHED", activityCustomerId: null, lotteryEligible: false }] }) });
  await harness.render().attendance.handleAttendanceFile({ name: "attendance.xlsx" });
  assert.equal(harness.render().attendance.attendancePreviewReady, true);
  assert.equal(harness.options.attendanceImportError, "");
  await harness.render().attendance.confirmAttendanceImport();
  assert.deepEqual(harness.calls[0], ["confirm", 1, 91, undefined, undefined, null]);
  assert.match(harness.confirmations[0], /资格客户 0 名/);
  assert.match(harness.confirmations[0], /未关联 1 条/);
});

test("attendance matching errors offer retry and disable publication in the rendered page", () => {
  const { AttendancePage } = loadModule("app/features/admin/attendance/AttendancePage.tsx", {
    "../ImportTemplateDownload": { ImportTemplateDownload: () => null, ImportTemplateHint: () => null },
    "../attendance/AttendanceTable": { AttendanceTable: () => null },
  });
  const props = {
    rows: [], fileName: "", warnings: [], sheetCounts: [],
    error: "白名单关联试算失败：服务暂不可用", activityStarted: false, activityClosed: false,
    pendingImport: { ...draft(), rows: [{ ...attendee(), customerType: "综合客户" }] },
    importAttemptName: "attendance.xlsx", blockingCount: 0, previewLoading: false,
    previewReady: false, publishing: false,
  };
  const failed = renderToStaticMarkup(createElement(AttendancePage, props));
  assert.match(failed, /重试关联预览/);
  assert.match(failed, /白名单关联试算失败/);
  assert.doesNotMatch(failed, /解析失败/);
  assert.match(failed, /<button[^>]*disabled=""[^>]*>请先完成关联试算<\/button>/);
  const ready = renderToStaticMarkup(createElement(AttendancePage, { ...props, error: "", previewReady: true }));
  assert.doesNotMatch(ready, /重试关联预览/);
  const publish = ready.match(/<button[^>]*>确认替换当前到场名单 1 名<\/button>/)?.[0];
  assert.ok(publish);
  assert.doesNotMatch(publish, /disabled/);
});

test("attendance preview refresh failure after deletion stays recoverable", async () => {
  const harness = customerHarness({ refreshServerImportPreview: async () => { throw new Error("offline"); } });
  harness.render().attendance.setPendingAttendanceImport({ ...draft(), rows: [{ ...attendee(), serverRowId: 31 }] });
  await harness.render().attendance.deleteAttendanceRows(["preview"]);
  assert.equal(harness.render().attendance.pendingAttendanceImport.rows.length, 0);
  assert.match(harness.notices.at(-1), /删除已保存，但关联试算刷新失败/);
});

test("whitelist API rejections return their actual reason without changing rows", async () => {
  const harness = customerHarness({ whitelistImportCompleted: true });
  harness.api.createAdminCustomer = async () => { throw new harness.api.ApiError("该渠道下手机号已对应其他客户"); };
  const before = harness.options.whitelistRows;
  const result = await harness.render().editor.saveWhitelistRow(customer("new"));
  assert.equal(result.ok, false); assert.match(result.message, /手机号已对应其他客户/);
  assert.equal(result.requiresReload, false); assert.equal(harness.options.whitelistRows, before);
});

test("uncertain customer and attendee creates require a reload before another submission", async () => {
  const harness = customerHarness({ whitelistImportCompleted: true }, {
    createAdminCustomer: async () => { throw new Error("network lost"); },
    createAdminAttendee: async () => { throw new Error("network lost"); },
  });
  for (const result of [await harness.render().editor.saveWhitelistRow(customer("new")), await harness.render().attendance.saveAttendanceRow(attendee("new"))]) {
    assert.equal(result.ok, false); assert.equal(result.requiresReload, true);
    assert.match(result.message, /新增结果尚未确认/);
  }
  assert.equal(harness.options.whitelistRows.length, 1); assert.equal(harness.options.attendanceRows.length, 1);
});

test("saved whitelist and attendance previews report refresh failure as already saved", async () => {
  const harness = customerHarness({ refreshServerImportPreview: async () => { throw new Error("offline"); } });
  const row = { ...customer(), serverRowId: 31 };
  harness.render().editor.setEditingWhitelistRow(row);
  let result = await harness.render().editor.saveWhitelistRow(row);
  assert.equal(result.requiresReload, true); assert.match(result.message, /修改已保存/);
  const attendanceRow = { ...attendee(), serverRowId: 32 };
  harness.render().attendance.setPendingAttendanceImport({ ...draft(), rows: [attendanceRow] });
  harness.render().attendance.setEditingAttendanceRow(attendanceRow);
  result = await harness.render().attendance.saveAttendanceRow(attendanceRow);
  assert.equal(result.requiresReload, true); assert.match(result.message, /修改已保存/);
});

test("successful customer and attendee creates use server identities and versions", async () => {
  const harness = customerHarness({ whitelistImportCompleted: true }, {
    createAdminCustomer: async () => ({ id: 81, lockVersion: 2, excelSequence: 99, phone: "13900000001", active: true }),
    createAdminAttendee: async () => ({ id: 82, participantName: "新参会人", dealerName: "测试客户有限公司", matchStatus: "MATCHED", activityCustomerId: 81, lotteryEligible: true }),
  });
  assert.equal((await harness.render().editor.saveWhitelistRow(customer("new"))).ok, true);
  const added = harness.options.whitelistRows.at(-1);
  assert.equal(added.id, "81"); assert.equal(added.serverVersion, 2); assert.equal(added.sequence, 99);
  assert.equal((await harness.render().attendance.saveAttendanceRow(attendee("new"))).ok, true);
  assert.equal(harness.options.attendanceRows.at(-1).id, "82");
});


test("whitelist and attendance readback errors clear retired records after successful publication",async()=>{
  for(const type of ["whitelist","attendance"]){
    let errors=0;
    const h=customerHarness({onReadbackFailed:()=>errors++}, {loadAdminCustomers:async()=>{throw new Error("offline");},loadAdminAttendees:async()=>{throw new Error("offline");}});
    if(type==="whitelist") await h.render().whitelist.confirmWhitelistImport();
    else { h.render().attendance.setPendingAttendanceImport(draft()); h.render().attendance.setAttendanceMatchPreview({whitelistVersionId:17}); await h.render().attendance.confirmAttendanceImport(); }
    assert.equal(h.options.serverImportTasks[type==="whitelist"?"WHITELIST":"ATTENDANCE"],undefined);
    assert.equal(h.options[type==="whitelist"?"whitelistRows":"attendanceRows"].length,0);
    if(type==="whitelist") assert.equal(h.options.whitelistImportCompleted,true);
    else assert.equal(h.render().attendance.pendingAttendanceImport,null);
    assert.equal(errors,1); assert.match(h.notices.at(-1),/已替换成功.*勿重复/);
  }
});
test("whitelist and attendance batch failures remove only confirmed deletions",async()=>{
  for(const type of ["whitelist","attendance"]){
    const rows=[1,2,3].map(id=>({...customer(String(id)),...attendee(String(id)),serverVersion:id})); const calls=[];
    const remove=async(_a,id)=>{calls.push(id);if(id===2)throw new Error("conflict");};
    const h=customerHarness({whitelistImportCompleted:true,whitelistRows:rows,attendanceRows:rows},{deleteAdminCustomer:remove,deleteAdminAttendee:remove});
    if(type==="whitelist") await h.render().editor.deleteWhitelistRows(["1","1","2","3"]);
    else await h.render().attendance.deleteAttendanceRows(["1","1","2","3"]);
    assert.deepEqual(calls,[1,2]); assert.deepEqual(h.options[type==="whitelist"?"whitelistRows":"attendanceRows"].map(r=>r.id),["2","3"]);
    assert.match(h.notices.at(-1),/已删除 1 [条名]/);
  }
});
test("running whitelist edits map authoritative server fields and preserve unrelated rows",async()=>{
  const original={...customer("42"),serverVersion:1}, keep=customer("43");
  const h=customerHarness({activityStatus:"running",whitelistImportCompleted:true,whitelistRows:[original,keep]},{updateAdminCustomer:async()=>({id:42,lockVersion:5,excelSequence:9,customerType:"GENERAL",regionCode:"EAST",dealerFullName:"标准名称",branchName:"新分公司",active:true,phoneMasked:"139****1234"})});
  h.render().editor.setEditingWhitelistRow(original); assert.equal((await h.render().editor.saveWhitelistRow(original,"更正")).ok,true);
  assert.equal(h.options.whitelistRows[0].dealerFull,"标准名称"); assert.equal(h.options.whitelistRows[0].serverVersion,5);
  assert.equal(h.options.whitelistRows[0].region,"华东"); assert.equal(h.options.whitelistRows[1],keep); assert.deepEqual(h.calls,[]);
});
