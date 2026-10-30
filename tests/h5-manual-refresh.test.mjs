import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";

const { ApiError } = loadModule("app/services/api/client.ts");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const item = quantity => ({ productId: 1, materialName: "合成商品", productLine: "调味品", quantity, casePrice: 10, lineAmount: quantity * 10 });
const order = (version = 1, quantity = 10, status = "SUBMITTED") => ({ id: 101, activityId: 1, activityCustomerId: 2,
  orderNo: "SYNTHETIC-1", currentVersion: version, lockVersion: version, status, items: [item(quantity)],
  totalAmount: quantity * 10, totalQuantity: quantity, operations: [], lastModifiedAt: "2026-10-30T01:00:00Z" });
const request = (status = "PENDING", version = 1, quantity = 5, type = "MODIFY") => ({ id: 501, orderId: 101,
  requestType: type, status, baseVersion: version, currentVersion: version, items: type === "MODIFY" ? [item(quantity)] : [],
  originalOrder: order(version), requestedAt: "2026-10-30T01:00:00Z" });
const activity = { id: 1, code: "SYNTHETIC", status: "ACTIVE", endsAt: "2099-01-01T00:00:00Z",
  whitelistCustomerTypeMode: "UNSPECIFIED", regions: [] };

async function harness(initialOrder = order(), initialRequest = null, draft = null) {
  let time = Date.parse("2026-10-30T02:00:00Z"), hidden = false;
  const reads = [], writes = [], listeners = new Map();
  const state = { order: initialOrder, request: initialRequest, draft, readError: null, gate: null, writeError: null };
  const listen = (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); };
  const unlisten = (type, fn) => listeners.get(type)?.delete(fn);
  class ClockDate extends Date { static now() { return time; } }
  const api = { ApiError, apiAssetUrl: url => url,
    verifyPhone: async () => ({ selectionRequired: false, customer: { activityId: 1, activityCode: "SYNTHETIC", customerId: 2,
      customerType: "ALL", dealerFullName: "合成客户" } }),
    loadH5Products: async () => { reads.push("products"); return [{ id: 1, materialName: "合成商品", casePrice: 10, images: [],
      customerType: "ALL", rebateStatus: "ALL", orderable: true }]; },
    loadH5Order: async options => {
      reads.push("order"); state.lastSignal = options?.signal;
      const snapshot = state.order;
      if (state.gate) await state.gate.promise;
      if (state.readError) throw state.readError;
      return snapshot;
    },
    loadH5OrderChangeRequest: async () => { reads.push("request"); return state.request; },
    loadH5OrderDraft: async () => { reads.push("draft"); return state.draft; },
    saveH5OrderDraft: async (...args) => writes.push(["draft", ...args]),
    deleteH5OrderDraft: async (...args) => writes.push(["deleteDraft", ...args]),
    saveH5Order: async (...args) => {
      writes.push(["submit", ...args]); if (state.writeError) throw state.writeError;
      state.order = order((state.order?.currentVersion ?? 0) + 1, args[1][0].quantity);
      return state.order;
    },
    createH5OrderChangeRequest: async (...args) => { writes.push(["request", ...args]); return request("PENDING", state.order.currentVersion, 5, args[3]); },
  };
  const h = hookHarness("app/features/h5/useH5OrderFlow.ts", "useH5OrderFlow",
    [{ activityStatus: "running", runtimeActivity: activity }], {
      "../../api": api,
      "./h5-submission": { createH5SubmissionManager: ({ send }) => ({ recover: async () => null,
        submit: (scope, body) => send({ scope, body, key: "synthetic-key" }), read: () => null, clear() {} }) },
    }, { Date: ClockDate, crypto: webcrypto,
      window: { addEventListener: listen, removeEventListener: unlisten, confirm: () => true },
      document: { get hidden() { return hidden; }, addEventListener: listen, removeEventListener: unlisten },
    });
  h.model.setPhone("13900000001"); await h.flush(); await h.model.verifyIdentity(); await h.flush();
  reads.length = 0; writes.length = 0;
  return { ...h, get model() { return h.model; }, get stateWrites() { return h.writes; }, state, reads, writes,
    advance: async ms => { time += ms; await h.runTimers(); },
    event: async (type, isHidden = false) => { hidden = isHidden; [...(listeners.get(type) ?? [])].forEach(fn => fn()); await h.flush(); },
  };
}

test("ordinary and pending pages stay idle; return events share one read and 15-second cooldown", async () => {
  for (const pending of [null, request()]) {
    const h = await harness(order(), pending);
    assert.equal(h.model.step, "submitted"); assert.equal(h.intervals.size, 0);
    await h.advance(65_000); assert.deepEqual(h.reads, []);
    await h.event("visibilitychange", true); assert.deepEqual(h.reads, []);
    await h.event("visibilitychange"); await h.event("focus"); await h.event("pageshow");
    assert.deepEqual(h.reads, ["order", "request"]);
    await h.model.refreshOrderStatus(); assert.equal(h.reads.length, 2);
    await h.advance(14_999); await h.model.refreshOrderStatus(); assert.equal(h.reads.length, 2);
    await h.advance(1); await h.model.refreshOrderStatus(); await h.flush(); assert.equal(h.reads.length, 4);
    h.unmount();
  }
});

test("manual refresh and immediate edit share the same pending HTTP reads; edit bypasses cooldown", async () => {
  const h = await harness(); await h.advance(15_000);
  h.state.order = order(2, 8); h.state.gate = deferred();
  const refreshing = h.model.refreshOrderStatus(); await h.flush();
  const editing = h.model.startEditingOrder(); await h.flush();
  await h.model.startEditingOrder();
  assert.deepEqual(h.reads, ["order"]);
  h.state.gate.resolve(); await Promise.all([refreshing, editing]); await h.flush();
  assert.deepEqual(h.reads, ["order", "request"]); assert.equal(h.model.step, "order");
  assert.equal(h.model.quantities[1], 8); assert.equal(h.model.runtimeOrder.currentVersion, 2);
  h.unmount();
});

test("admin direct changes and approval are loaded before entering the cart without manual refresh", async () => {
  for (const initialRequest of [null, request()]) {
    const h = await harness(order(), initialRequest);
    h.state.order = order(2, 7);
    h.state.request = initialRequest ? { ...request("APPROVED"), currentVersion: 2 } : null;
    await h.model.startEditingOrder(); await h.flush();
    assert.equal(h.model.step, "order"); assert.equal(h.model.quantities[1], 7);
    assert.equal(h.model.runtimeOrder.currentVersion, 2); assert.equal(h.model.pendingChangeRequest, null);
    assert.deepEqual(h.reads, ["order", "request"], "No catalog/ranking request is needed"); h.unmount();
  }
});

test("pending and rejected modifications use the latest application; stale rejected content is ignored", async () => {
  for (const status of ["PENDING", "REJECTED"]) {
    const h = await harness(order(), request(status));
    h.state.request = { ...request(status, 1, 4), id: 502 };
    await h.model.startEditingOrder(); await h.flush();
    assert.equal(h.model.quantities[1], 4); assert.equal(h.model.pendingChangeRequest.id, 502); h.unmount();
  }
  const h = await harness(order(), request());
  h.state.order = order(2, 9); h.state.request = { ...request("REJECTED"), currentVersion: 2 };
  await h.model.startEditingOrder(); await h.flush();
  assert.equal(h.model.quantities[1], 9); assert.equal(h.model.pendingChangeRequest, null); h.unmount();
});

test("valid unsubmitted cart survives re-entry; changed order versions invalidate it with a notice", async () => {
  const h = await harness(); await h.model.startEditingOrder(); await h.flush();
  h.model.setQuantities({ 1: 13 }); await h.flush();
  h.model.setStep("submitted"); await h.flush();
  await h.model.startEditingOrder(); await h.flush(); assert.equal(h.model.quantities[1], 13);
  h.model.setStep("submitted"); await h.flush(); h.state.order = order(2, 8);
  await h.model.startEditingOrder(); await h.flush();
  assert.equal(h.model.quantities[1], 8); assert.match(h.model.draftMessage, /旧草稿未恢复/); h.unmount();
});

test("stored draft restores only against the current formal order version", async () => {
  for (const baseOrderVersion of [1, 2]) {
    const h = await harness(order(2, 8), null, { baseOrderVersion, items: [{ productId: 1, quantity: 13 }], updatedAt: "2026-10-30T01:00:00Z" });
    assert.equal(h.model.quantities[1], baseOrderVersion === 2 ? 13 : 8);
    assert.equal(h.model.step, baseOrderVersion === 2 ? "order" : "submitted"); h.unmount();
  }
});

test("offline/500/503 retain confirmed data and time; failed preflight never enters editing", async () => {
  for (const error of [new TypeError("offline"), new ApiError(500, "ERROR", "失败"), new ApiError(503, "BUSY", "繁忙")]) {
    const h = await harness(); const previous = h.model.lastSuccessAt;
    await h.advance(15_000); h.state.readError = error;
    await h.model.refreshOrderStatus(); await h.flush();
    assert.equal(h.model.runtimeOrder.currentVersion, 1); assert.equal(h.model.quantities[1], 10);
    assert.equal(h.model.lastSuccessAt, previous); assert.match(h.model.runtimeMessage, /刷新失败/);
    await h.model.refreshOrderStatus(); assert.equal(h.reads.length, 1, "failure still has cooldown");
    await h.model.startEditingOrder(); await h.flush(); assert.equal(h.model.step, "submitted");
    assert.match(h.model.runtimeMessage, /无法进入修改|加载失败/); h.unmount();
  }
});

test("inconsistent snapshots and another customer's response do not populate a cart", async () => {
  for (const latest of [{ nextOrder: order(2), nextRequest: request() },
    { nextOrder: { ...order(2), activityCustomerId: 3 }, nextRequest: null },
    { nextOrder: { ...order(), lockVersion: 2 }, nextRequest: request() }]) {
    const h = await harness(); h.state.order = latest.nextOrder; h.state.request = latest.nextRequest;
    await h.model.startEditingOrder(); await h.flush();
    assert.equal(h.model.step, "submitted"); assert.equal(h.model.runtimeOrder.currentVersion, 1); h.unmount();
  }
});

test("returning to an editing cart leaves edits untouched; final submission still detects admin changes", async () => {
  const h = await harness(); await h.model.startEditingOrder(); await h.flush();
  h.model.setQuantities({ 1: 13 }); await h.flush(); h.state.order = order(2, 8);
  const before = h.reads.length; await h.advance(65_000); await h.event("focus"); await h.event("visibilitychange");
  assert.equal(h.reads.length, before); assert.equal(h.model.quantities[1], 13);
  h.state.writeError = new ApiError(409, "ORDER_VERSION_CONFLICT", "订单已更新");
  await h.model.submitOrder(); await h.flush();
  assert.equal(h.model.orderNeedsRefresh, true); assert.equal(h.model.quantities[1], 13);
  assert.equal(h.writes.find(w => w[0] === "submit")[1], 1, "Original expectedVersion is kept for backend validation"); h.unmount();
});

test("withdrawal checks latest data and asks for another confirmation after an admin update", async () => {
  const h = await harness(); h.state.order = order(2, 8);
  await h.model.withdrawOrder(); await h.flush();
  assert.equal(h.writes.filter(w => w[0] === "request").length, 0);
  assert.equal(h.model.runtimeOrder.currentVersion, 2); assert.match(h.model.runtimeMessage, /订单已更新/);
  await h.model.withdrawOrder(); await h.flush();
  const sent = h.writes.find(w => w[0] === "request"); assert.equal(sent[3], 2); assert.equal(sent[4], "WITHDRAW"); h.unmount();
});

test("first submission renders its response without a second read; success page remains idle", async () => {
  const h = await harness(null); h.model.setQuantities({ 1: 3 }); await h.flush();
  await h.model.submitOrder(); await h.flush();
  assert.equal(h.model.step, "success"); assert.equal(h.model.quantities[1], 3); assert.deepEqual(h.reads, []);
  await h.advance(65_000); assert.deepEqual(h.reads, []); h.unmount();
});

test("unmount and customer reset abort pending reads and discard late results", async () => {
  for (const reset of [false, true]) {
    const h = await harness(); await h.advance(15_000); h.state.gate = deferred();
    const pending = h.model.refreshOrderStatus(); await h.flush(); const signal = h.state.lastSignal;
    if (reset) { await h.model.resetEntry(); await h.flush(); } else h.unmount();
    assert.equal(signal.aborted, true); const before = h.stateWrites;
    h.state.gate.resolve(); await pending; await h.flush();
    if (reset) { assert.equal(h.model.runtimeOrder, null); assert.equal(h.model.step, "verify"); h.unmount(); }
    else assert.equal(h.stateWrites, before);
  }
});
