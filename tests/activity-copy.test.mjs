import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";

const preview = { sourceId: 7, sourceName: "历史活动", stamp: "saved-version", products: 180, customers: 320, rounds: 8 };
const input = { name: "新活动", departmentId: 1, startsAt: "2099-01-01T09:00", endsAt: "2099-01-01T18:00", eventEndsAt: "2099-01-01T20:00" };
function harness(overrides = {}, storedId = "") {
  const calls = [], listeners = new Map(), store = new Map(), notices = [];
  if (storedId) store.set("activity-copy:1", storedId);
  let visibility = "visible", status = "RUNNING";
  const props = { open: true, departmentId: "1", owner: "1", setBusy: busy => calls.push(["busy", busy]), notice: value => notices.push(value) };
  const api = {
    ApiError: Error,
    loadActivityCopySources: async (...args) => { calls.push(["sources", ...args]); return [{ id: 7, name: "历史活动", code: "OLD", status: "ARCHIVED" }]; },
    loadActivityCopyPreview: async (...args) => { calls.push(["preview", ...args]); return preview; },
    createActivityCopy: async (...args) => { calls.push(["create", ...args]); return { id: 10, status: "QUEUED", copiedFiles: 0, totalFiles: 2 }; },
    loadActivityCopyTask: async (...args) => { calls.push(["task", ...args]); return { id: 10, status, copiedFiles: status === "COMPLETED" ? 2 : 1, totalFiles: 2, activityCode: "NEW" }; },
    retryActivityCopy: async () => { calls.push(["retry"]); status = "RUNNING"; return { id: 10, status, totalFiles: 2, copiedFiles: 1 }; },
    discardActivityCopy: async () => { calls.push(["discard"]); return true; },
    setPreferredAdminActivityCode: code => calls.push(["preferred", code]), ...overrides,
  };
  const h = hookHarness("app/features/admin/useActivityCopy.ts", "useActivityCopy", [props], { "../../api": api }, {
    Error, crypto: { randomUUID: () => "stable-request-key" },
    sessionStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    document: { get visibilityState() { return visibility; }, addEventListener: (k, v) => listeners.set(k, v), removeEventListener: k => listeners.delete(k) },
    window: { location: { assign: url => calls.push(["navigate", url]) } },
  });
  return { ...h, get model() { return h.model; }, calls, store, props, notices, status: value => { status = value; },
    visible: async value => { visibility = value; listeners.get("visibilitychange")?.(); await h.flush(); } };
}
async function choose(h) { h.model.setEnabled(true); await h.flush(); h.model.setSourceId("7"); await h.flush(); }

test("blank creation and idle pages perform no copy reads or polling", async () => {
  const h = harness(); await h.flush(); await h.runTimers();
  assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0); h.unmount();
});
test("department selection loads summaries and selected source counts only; changing department clears the source", async () => {
  const h = harness(); await choose(h);
  assert.equal(h.calls.filter(c => c[0] === "sources").length, 1); assert.equal(h.calls.filter(c => c[0] === "preview").length, 1);
  assert.equal(h.model.preview.products, 180); assert.deepEqual(JSON.parse(JSON.stringify(h.model.selection)), { products: true, whitelist: true, lottery: true });
  h.render([{ ...h.props, departmentId: "2" }]); await h.flush();
  assert.equal(h.model.sourceId, ""); assert.equal(h.model.preview, null);
  assert.equal(h.calls.filter(c => c[0] === "preview").length, 1); assert.equal(h.calls.filter(c => c[0] === "sources").at(-1)[1], 2); h.unmount();
});
test("late source responses never replace the latest selected activity", async () => {
  let late; const h = harness({ loadActivityCopyPreview: id => id === 7 ? new Promise(resolve => { late = resolve; }) : Promise.resolve({ ...preview, sourceId: id, products: 2 }) });
  h.model.setEnabled(true); await h.flush(); h.model.setSourceId("7"); await h.flush();
  h.model.setSourceId("8"); await h.flush(); late(preview); await h.flush();
  assert.equal(h.model.preview.sourceId, 8); assert.equal(h.model.preview.products, 2); h.unmount();
});
test("a rapid double click creates one task and request retry retains its idempotency key", async () => {
  let finish; const h = harness({ createActivityCopy: (...args) => { h.calls.push(["create", ...args]); return new Promise(resolve => { finish = resolve; }); } });
  await choose(h); const first = h.model.start(input); await h.model.start(input); assert.equal(h.calls.filter(c => c[0] === "create").length, 1);
  finish({ id: 10, status: "QUEUED", copiedFiles: 0, totalFiles: 2 }); await first; await h.flush();
  assert.equal(h.store.get("activity-copy:1"), "10"); h.unmount();
  let tries = 0; const keys = []; const retry = harness({ createActivityCopy: async (...args) => { keys.push(args[3]); if (++tries === 1) throw new Error("response lost"); return { id: 10, status: "QUEUED", copiedFiles: 0, totalFiles: 2 }; } });
  await choose(retry); await assert.rejects(retry.model.start(input), /response lost/); await retry.model.start(input); await retry.flush();
  assert.deepEqual(keys, ["stable-request-key", "stable-request-key"]); retry.unmount();
});
test("progress pauses while hidden and stops after completion; new activity becomes preferred", async () => {
  const h = harness(); await choose(h); await h.model.start(input); await h.flush();
  assert.equal(h.calls.filter(c => c[0] === "task").length, 1);
  await h.visible("hidden"); await h.runTimers(); assert.equal(h.calls.filter(c => c[0] === "task").length, 1); assert.equal(h.timers.size, 0);
  h.status("COMPLETED"); await h.visible("visible");
  assert.equal(h.calls.filter(c => c[0] === "task").length, 2); assert.equal(h.timers.size, 0); assert.equal(h.store.has("activity-copy:1"), false);
  assert.deepEqual(h.calls.slice(-2), [["preferred", "NEW"], ["navigate", "/admin"]]); h.unmount();
});
test("failed tasks retain the form and stop polling; retry and discard use the existing task", async () => {
  const h = harness(); await choose(h); h.status("FAILED"); await h.model.start(input); await h.flush();
  assert.equal(h.timers.size, 0); assert.equal(h.model.preview.sourceId, 7);
  await h.model.retry(); await h.flush(); assert.equal(h.calls.filter(c => c[0] === "retry").length, 1);
  h.status("FAILED"); await h.runTimers(); await h.model.discard(); await h.flush();
  assert.equal(h.model.task, null); assert.equal(h.store.has("activity-copy:1"), false); assert.equal(h.model.preview.sourceId, 7); h.unmount();
});
test("refresh can recover the saved task without reading historical configuration", async () => {
  const h = harness({}, "10"); await h.flush();
  assert.equal(h.calls.filter(c => c[0] === "task").length, 1); assert.equal(h.calls.filter(c => c[0] === "sources" || c[0] === "preview").length, 0); h.unmount(); assert.equal(h.timers.size, 0);
});
test("an uncertain POST persists its exact input before sending and survives refresh without duplicate creation", async () => {
  const first = harness({ createActivityCopy: async () => {
    assert.equal(JSON.parse(first.store.get("activity-copy:1")).input.name, input.name);
    throw new Error("response lost");
  } });
  await choose(first); await assert.rejects(first.model.start(input), /response lost/); await first.flush();
  assert.equal(first.model.pending.input.name, input.name);
  const saved = first.store.get("activity-copy:1"); first.unmount();
  const recovered = harness({}, saved); await recovered.flush();
  assert.equal(recovered.calls.length, 0); assert.equal(recovered.model.pending.requestKey, "stable-request-key");
  await recovered.model.retrySubmission(); await recovered.flush();
  const submitted = recovered.calls.find(c => c[0] === "create");
  assert.deepEqual(JSON.parse(JSON.stringify(submitted[1])), input); assert.equal(submitted[4], "stable-request-key");
  assert.equal(recovered.model.pending, null); assert.equal(recovered.store.get("activity-copy:1"), "10"); recovered.unmount();
});
test("a confirmed validation rejection releases pending form protection", async () => {
  class Rejected extends Error { status = 409; }
  const h = harness({ ApiError: Rejected, createActivityCopy: async () => { throw new Rejected("来源配置已变化"); } });
  await choose(h); await assert.rejects(h.model.start(input), /来源配置/); await h.flush();
  assert.equal(h.model.pending, null); assert.equal(h.store.has("activity-copy:1"), false); h.unmount();
});
test("completed tasks with removed targets stop polling and can be cleared for a new creation", async () => {
  const h = harness({ loadActivityCopyTask: async () => ({ id: 10, status: "COMPLETED", totalFiles: 0, copiedFiles: 0 }) }, "10");
  await h.flush(); assert.equal(h.timers.size, 0); assert.match(h.model.taskError, /已被移除/);
  assert.equal(h.store.has("activity-copy:1"), false); h.model.reset(); await h.flush(); assert.equal(h.model.task, null); h.unmount();
});
test("copy API sends new times, a source stamp and only the selected configuration modules", async () => {
  let saved; const { createActivityCopy } = loadModule("app/services/api/activity-copy.ts", { "./client": { api: async (path, options, csrf) => { saved = { path, body: JSON.parse(options.body), csrf }; return { data: { id: 10 } }; } } });
  await createActivityCopy(input, preview, { products: true, whitelist: false, lottery: true }, "request-123");
  assert.equal(saved.path, "/admin/activity-copies"); assert.equal(saved.csrf, "admin"); assert.equal(saved.body.startsAt, "2099-01-01T01:00:00.000Z");
  assert.deepEqual(saved.body.selection, { products: true, whitelist: false, lottery: true }); assert.equal(saved.body.sourceStamp, "saved-version"); assert.equal(Object.hasOwn(saved.body, "attendance"), false);
});
test("new activity drawer exposes three optional modules and disables missing configuration", () => {
  const { NewActivityDrawer } = loadModule("app/features/admin/NewActivityDrawer.tsx", { "../../api": {}, "../../admin-context": { useAdminIdentity: () => ({ roleCode: "SUPER_ADMIN" }) } });
  const activities = { creatingActivity: false, newActivity: { ...input, departmentId: "1" }, setNewActivity() {}, setNewActivityOpen() {}, departments: [], minimumFutureAt: "",
    copy: { enabled: true, sourceId: "7", sources: [{ id: 7, name: "历史活动", code: "OLD", status: "ARCHIVED" }], preview: { ...preview, rounds: 0 }, selection: { products: true, whitelist: true, lottery: false }, task: null } };
  const html = renderToStaticMarkup(React.createElement(NewActivityDrawer, { activities }));
  assert.equal((html.match(/type="checkbox"/g) || []).length, 4); assert.match(html, /暂无配置/); assert.match(html, /现场到场名单需重新导入/); assert.match(html, /已归档/);
});
