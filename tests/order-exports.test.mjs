import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";

class ApiError extends Error { constructor(status, code, message, traceId) { super(message); Object.assign(this, { status, code, traceId }); } }
const task = (status = "PENDING") => ({ id: 1, activityId: 7, status, stage: "READING", orderCount: 2, detailCount: 100,
  sheetCounts: [], filters: {}, createdAt: "2026-11-03T00:00:00Z", cancelRequested: false });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness(overrides = {}, args = [7, 1, true, true, {}]) {
  let visibilityState = "visible", nextKey = 0, status = "PENDING";
  const calls = [], listeners = new Map();
  const h = hookHarness("app/components/orders/useOrderExports.ts", "useOrderExports", args, {
    "../../api": {
      ApiError,
      loadOrderExports: async (id, signal) => { calls.push(["list", id, signal]); return [task(status)]; },
      createOrderExport: async (...values) => { calls.push(["create", ...values]); return task(); },
      cancelOrderExport: async (...values) => { calls.push(["cancel", ...values]); return { ...task(), cancelRequested: true }; },
      ...overrides,
    },
    "../../services/api/idempotency-key": { createIdempotencyKey: () => `test-key-${++nextKey}` },
  }, { Error, document: { get visibilityState() { return visibilityState; }, addEventListener: (n, f) => listeners.set(n, f), removeEventListener: n => listeners.delete(n) } });
  return { h, calls, listeners, setStatus: value => { status = value; }, visibility: async value => { visibilityState = value; listeners.get("visibilitychange")?.(); await h.flush(); } };
}
test("polling pauses while hidden or inactive and stops on terminal tasks and unmount", async () => {
  const { h, calls, visibility, setStatus, listeners } = harness();
  await h.flush(); assert.equal(calls.length, 1); assert.equal(h.timers.size, 1);
  await visibility("hidden"); await h.runTimers(); assert.equal(calls.length, 1); assert.equal(h.timers.size, 0);
  await visibility("visible"); assert.equal(calls.length, 2); setStatus("COMPLETED"); await h.runTimers(); assert.equal(h.timers.size, 0);
  h.render([7, 1, true, false, {}]); await h.flush(); assert.equal(listeners.size, 0); assert.equal(calls.length, 3);
  h.unmount(); assert.equal(calls.at(-1)[2].aborted, true);
});
test("denied roles or unfinished activities never fetch or create exports", async () => {
  const { h, calls } = harness({}, [7, 1, false, true, {}]); await h.flush(); await h.model.create();
  assert.equal(calls.length, 0); h.unmount();
});
test("double clicks submit once and network retries keep the request key", async () => {
  const pending = deferred(), creates = []; let attempt = 0;
  const { h } = harness({ createOrderExport: (...values) => { creates.push(values); return ++attempt === 1 ? pending.promise : Promise.resolve(task()); } }, [7, 1, true, true, { status: "SUBMITTED", keyword: " 客户 " }]);
  await h.flush(); const first = h.model.create(), second = h.model.create();
  assert.equal(creates.length, 1); pending.reject(new ApiError(500, "FAILED", "生成请求失败", "trace-123"));
  await Promise.all([first, second]); await h.flush(); assert.match(h.model.error, /trace-123/);
  await h.model.create(); await h.flush(); assert.equal(creates.length, 2); assert.equal(creates[0][2], creates[1][2]);
  assert.equal(creates[0][1].keyword, "客户"); assert.equal(h.model.tasks.length, 1);
  await h.model.create(); assert.notEqual(creates[2][2], creates[1][2]); h.unmount();
});
test("switching activity or account aborts requests and ignores late results", async () => {
  const late = deferred(); let oldSignal;
  const { h } = harness({ createOrderExport: (_id, _filters, _key, signal) => { oldSignal = signal; return late.promise; }, loadOrderExports: async id => id === 7 ? [task()] : [] });
  await h.flush(); const old = h.model.create(); h.render([8, 2, true, true, {}]); await h.flush();
  assert.equal(oldSignal.aborted, true); late.resolve(task()); await old; await h.flush();
  assert.equal(h.model.tasks.length, 0); assert.equal(h.model.busy, false); h.unmount();
});
test("cancel signals the backend and refreshes durable state", async () => {
  const { h, calls } = harness(); await h.flush(); await h.model.cancel(1); await h.flush();
  assert.equal(calls.filter(c => c[0] === "cancel").length, 1); assert.ok(calls.filter(c => c[0] === "list").length >= 2); h.unmount();
});
test("role and whole-event completion control the button; archive still allows export", () => {
  const { OrderFilterBar } = loadModule("app/components/orders/OrderFilterBar.tsx");
  const model = { activityStarted: true, activityClosed: true, orderCounts: {}, orderFilter: "全部", customerType: "全部", search: "", exports: { busy: false } };
  const render = extra => renderToStaticMarkup(React.createElement(OrderFilterBar, { model: { ...model, ...extra } }));
  assert.doesNotMatch(render({ canExport: false }), />导出订单<\/button>/);
  assert.match(render({ canExport: true, activityFinished: false }), /disabled="" title="整场活动结束后/);
  const archived = render({ canExport: true, activityFinished: true, readOnly: true });
  assert.match(archived, /title="后台生成 CSV 压缩包"/); assert.doesNotMatch(archived, /disabled="" title="后台生成/);
});
test("task panel shows four counts, snapshot, CSV help and authenticated native download", () => {
  const { OrderExportPanel } = loadModule("app/components/orders/OrderExportPanel.tsx", {
    "../../api": { orderExportDownloadUrl: (a, t) => `/api/v1/admin/activities/${a}/exports/${t}/download` },
    "../../features/shared/time": { formatBeijingTime: v => v },
  });
  const model = { activityId: 7, canExport: true, activityFinished: true, exports: { checkedAt: Date.now(), tasks: [{ ...task("COMPLETED"), sheetCounts: [2, 100, 50, 3], snapshotAt: "2026-11-03T01:00:00Z", expiresAt: "2099-01-01T00:00:00Z" }], error: "", busy: false, loading: false } };
  const html = renderToStaticMarkup(React.createElement(OrderExportPanel, { model }));
  assert.match(html, /exports\/1\/download/); assert.match(html, /下载 ZIP/); assert.match(html, /有效商品 50 行/); assert.match(html, /有效分公司 3 行/);
  assert.match(html, /数据快照/); assert.match(html, /设为文本/); assert.doesNotMatch(html, /导出说明.txt/);
  model.exports.tasks[0].expiresAt = "2000-01-01T00:00:00Z";
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(OrderExportPanel, { model })), /下载 ZIP/);
});
