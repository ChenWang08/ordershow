import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";
import { memoryStorage } from "./helpers/memory-storage.mjs";

const { ApiError } = loadModule("app/services/api/client.ts");
const { createH5LocalDraftStore, h5LocalDraftKey } = loadModule("app/features/h5/h5-local-draft.ts", { "../../api": { apiAssetUrl: x => x } });
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

const draftContext = (baseOrder = order(), baseRequest = null) => ({ activityId: 1, activityCode: "SYNTHETIC", customerId: 2,
  endsAt: activity.endsAt, order: baseOrder, request: baseRequest });
function seedDraft(storage, baseOrder = order(), baseRequest = null, items = [{ productId: 1, quantity: 13 }]) {
  createH5LocalDraftStore({ storage: () => storage, now: () => Date.parse("2026-10-30T01:00:00Z") }).save(draftContext(baseOrder, baseRequest), items);
}

async function harness(initialOrder = order(), initialRequest = null, options = {}) {
  let time = Date.parse("2026-10-30T02:00:00Z"), hidden = false;
  const reads = [], writes = [], listeners = new Map();
  const storage = options.storage ?? memoryStorage();
  const state = { order: initialOrder, request: initialRequest, readError: null, gate: null, writeError: null,
    customerId: 2, recovered: options.recovered ?? null, recoveryError: options.recoveryError ?? null, pending: false,
    products: [{ id: 1, materialName: "合成商品", casePrice: 10, images: [], customerType: "ALL", rebateStatus: "ALL", orderable: true }] };
  const listen = (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); };
  const unlisten = (type, fn) => listeners.get(type)?.delete(fn);
  class ClockDate extends Date { static now() { return time; } }
  const api = { ApiError, apiAssetUrl: url => url,
    verifyPhone: async () => ({ selectionRequired: false, customer: { activityId: 1, activityCode: "SYNTHETIC", customerId: state.customerId,
      customerType: "ALL", dealerFullName: "合成客户" } }),
    loadH5Products: async () => { reads.push("products"); return state.products; },
    loadH5Order: async options => {
      reads.push("order"); state.lastSignal = options?.signal;
      const snapshot = state.order;
      if (state.gate) await state.gate.promise;
      if (state.readError) throw state.readError;
      return snapshot;
    },
    loadH5OrderChangeRequest: async () => { reads.push("request"); return state.request; },
    loadH5OrderDraft: async () => { reads.push("draft"); throw new Error("Legacy server drafts must not be read or migrated"); },
    saveH5OrderDraft: async (...args) => { writes.push(["draft", ...args]); throw new Error("No server autosave"); },
    deleteH5OrderDraft: async (...args) => { writes.push(["deleteDraft", ...args]); throw new Error("No server drafts"); },
    saveH5Order: async (...args) => {
      writes.push(["submit", ...args]); if (state.writeError) throw state.writeError;
      state.order = order((state.order?.currentVersion ?? 0) + 1, args[1][0].quantity);
      return state.order;
    },
    createH5OrderChangeRequest: async (...args) => {
      writes.push(["request", ...args]); if (state.writeError) throw state.writeError;
      return request("PENDING", state.order.currentVersion, args[4]?.[0]?.quantity ?? 5, args[3]);
    },
  };
  const h = hookHarness("app/features/h5/useH5OrderFlow.ts", "useH5OrderFlow",
    [{ activityStatus: options.activityStatus ?? "running", runtimeActivity: activity }], {
      "../../api": api,
      "./h5-submission": { createH5SubmissionManager: ({ send }) => ({ recover: async () => {
        if (state.recoveryError) throw state.recoveryError;
        return state.recovered;
      }, submit: (scope, body) => send({ scope, body, key: "synthetic-key" }), read: () => state.pending, clear() {} }) },
    }, { Date: ClockDate, crypto: webcrypto,
      window: { localStorage: options.storageError ? { getItem() { throw options.storageError; }, setItem() { throw options.storageError; }, removeItem() { throw options.storageError; } } : storage,
        addEventListener: listen, removeEventListener: unlisten, confirm: () => true },
      document: { get hidden() { return hidden; }, addEventListener: listen, removeEventListener: unlisten },
    });
  h.model.setPhone("13900000001"); await h.flush(); await h.model.verifyIdentity(); await h.flush();
  const entryReads = [...reads]; reads.length = 0; writes.length = 0;
  return { ...h, get model() { return h.model; }, get stateWrites() { return h.writes; }, state, reads, writes,
    storage, entryReads, advance: async ms => { time += ms; await h.runTimers(); },
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
  for (const latest of [request("REJECTED"), request("PENDING", 1, 4)]) {
    const pending = await harness(order(), request());
    await pending.model.startEditingOrder(); await pending.flush();
    pending.model.setQuantities({ 1: 3 }); await pending.flush();
    pending.model.setStep("submitted"); await pending.flush();
    pending.state.request = latest;
    await pending.model.startEditingOrder(); await pending.flush();
    assert.equal(pending.model.quantities[1], latest.items[0].quantity);
    assert.match(pending.model.draftMessage, /旧草稿未恢复/); pending.unmount();
  }
});

test("entry restores browser drafts after fresh order/review reads; legacy server drafts are never loaded", async () => {
  for (const pending of [null, request(), request("REJECTED")]) {
    const storage = memoryStorage(); seedDraft(storage, order(), pending);
    const h = await harness(order(), pending, { storage });
    assert.equal(h.model.quantities[1], 13); assert.equal(h.model.step, "order");
    assert.equal(h.model.draftMessage, "");
    assert.deepEqual(h.entryReads, ["products", "order", "request"]);
    h.unmount();
  }
});

test("a changed order ID, business/lock version, status or same-ID application status/content invalidates the stored cart", async () => {
  const scenarios = [
    { latestOrder: { ...order(), id: 102 } }, { latestOrder: order(2, 8) },
    { latestOrder: { ...order(), lockVersion: 2 } }, { latestOrder: order(1, 10, "WITHDRAWN") },
    { oldRequest: request(), latestRequest: request("REJECTED") },
    { oldRequest: request(), latestRequest: request("PENDING", 1, 4) },
    { oldRequest: request(), latestOrder: order(2, 5), latestRequest: { ...request("APPROVED"), currentVersion: 2 } },
  ];
  for (const scenario of scenarios) {
    const storage = memoryStorage(); seedDraft(storage, order(), scenario.oldRequest ?? null);
    const h = await harness(scenario.latestOrder ?? order(), scenario.latestRequest ?? null, { storage });
    assert.equal(h.model.step, "submitted"); assert.notEqual(h.model.quantities[1], 13);
    assert.match(h.model.draftMessage, /旧草稿未恢复/);
    assert.equal(storage.getItem(h5LocalDraftKey(draftContext())), null);
    await h.model.startEditingOrder(); await h.flush();
    assert.equal(h.model.quantities[1], scenario.latestRequest && scenario.latestRequest.status !== "APPROVED" ? scenario.latestRequest.items[0].quantity : (scenario.latestOrder ?? order()).items[0].quantity);
    h.unmount();
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

test("rapid cart changes and confirmation previews, hide/show and live-room exit never call the draft server", async () => {
  const h = await harness(null);
  for (let i = 0; i < 30; i++) { h.model.changeQty("1", 1); await h.flush(); }
  assert.equal(h.model.totalBoxes, 30); assert.equal(h.model.totalAmount, 300);
  h.model.setStep("confirm"); await h.flush();
  assert.equal(h.model.totalAmount, 300);
  h.model.setStep("order"); await h.flush();
  await h.event("visibilitychange", true); await h.event("pagehide"); await h.event("visibilitychange");
  assert.equal(await h.model.prepareLiveRoomExit(), true);
  assert.deepEqual(h.reads, []); assert.deepEqual(h.writes, []);
  assert.equal(JSON.parse(h.storage.getItem(h5LocalDraftKey(draftContext()))).items[0].quantity, 30);
  h.unmount();
  const reentered = await harness(null, null, { storage: h.storage });
  assert.equal(reentered.model.quantities[1], 30); reentered.unmount();
});

test("switching customers flushes only the previous local cart and restores each customer's own draft", async () => {
  const h = await harness(); await h.model.startEditingOrder(); await h.flush();
  h.model.setQuantities({ 1: 13 }); await h.flush();
  await h.model.resetEntry(); await h.flush();
  assert.equal(h.model.runtimeOrder, null); assert.equal(Object.keys(h.model.quantities).length, 0);
  h.state.customerId = 3; h.state.order = { ...order(), activityCustomerId: 3 };
  h.model.setPhone("13900000002"); await h.flush(); await h.model.verifyIdentity(); await h.flush();
  assert.equal(h.model.quantities[1], 10); assert.equal(h.model.step, "submitted");
  await h.model.resetEntry(); await h.flush();
  h.state.customerId = 2; h.state.order = order();
  h.model.setPhone("13900000001"); await h.flush(); await h.model.verifyIdentity(); await h.flush();
  assert.equal(h.model.quantities[1], 13); assert.equal(h.model.step, "order");
  assert.equal(h.writes.length, 0); assert.equal(h.reads.includes("draft"), false); h.unmount();
});

test("returning to formal quantities removes the draft; failed submission/reload preserves it; confirmed success clears it", async () => {
  const h = await harness(); await h.model.startEditingOrder(); await h.flush();
  h.model.setQuantities({ 1: 13 }); await h.flush(); await h.advance(800);
  const key = h5LocalDraftKey(draftContext()); assert.notEqual(h.storage.getItem(key), null);
  h.model.setQuantities({ 1: 10 }); await h.flush(); await h.advance(800);
  assert.equal(h.storage.getItem(key), null);
  h.model.setQuantities({ 1: 13 }); await h.flush();
  h.state.writeError = new ApiError(503, "BUSY", "繁忙");
  await h.model.submitOrder(); await h.flush();
  assert.equal(h.model.quantities[1], 13); assert.notEqual(h.storage.getItem(key), null);
  h.state.readError = new ApiError(503, "BUSY", "繁忙");
  await h.model.reloadLatestOrder(); await h.flush();
  assert.equal(h.model.quantities[1], 13); assert.notEqual(h.storage.getItem(key), null);
  h.state.readError = null; h.state.writeError = null;
  await h.model.submitOrder(); await h.flush(); await h.advance(800);
  assert.equal(h.model.step, "success"); assert.equal(h.storage.getItem(key), null);
  await h.event("pagehide"); h.unmount(); assert.equal(h.storage.getItem(key), null, "Old snapshots cannot resurrect after success");
});

test("review and withdrawal success clear the local draft but permit further pending-application edits", async () => {
  for (const action of ["modify", "withdraw"]) {
    const h = await harness(); await h.model.startEditingOrder(); await h.flush();
    h.model.setQuantities({ 1: 5 }); await h.flush(); await h.advance(800);
    if (action === "modify") await h.model.submitOrder(); else await h.model.withdrawOrder();
    await h.flush(); await h.advance(800);
    const key = h5LocalDraftKey(draftContext()); assert.equal(h.storage.getItem(key), null);
    h.state.request = h.model.pendingChangeRequest;
    await h.model.startEditingOrder(); await h.flush();
    h.model.setQuantities({ 1: 4 }); await h.flush(); await h.advance(800);
    assert.notEqual(h.storage.getItem(key), null); assert.equal(h.model.step, "order"); h.unmount();
  }
});

test("unavailable local storage warns without blocking calculations, submission or customer switching", async () => {
  const h = await harness(null, null, { storageError: new Error("Storage blocked") });
  h.model.setQuantities({ 1: 3 }); await h.flush(); await h.advance(800);
  assert.match(h.model.draftMessage, /刷新或关闭页面/); assert.equal(h.model.totalAmount, 30);
  await h.model.submitOrder(); await h.flush(); assert.equal(h.model.step, "success");
  await h.model.resetEntry(); await h.flush(); assert.equal(h.model.step, "verify");
  assert.deepEqual(h.writes.map(w => w[0]), ["submit"]); h.unmount();
});

test("an uncertain recovered submission cannot restore editable drafts; confirmed replay clears the saved cart", async () => {
  const storage = memoryStorage(); seedDraft(storage);
  const h = await harness(order(), null, { storage, recoveryError: new Error("Still pending") });
  assert.equal(h.model.pendingSubmission, true); assert.equal(h.model.step, "submitted");
  assert.equal(h.model.quantities[1], 10); await h.model.startEditingOrder(); await h.flush();
  assert.equal(h.model.step, "submitted"); assert.notEqual(storage.getItem(h5LocalDraftKey(draftContext())), null);
  h.model.changeQty("1", 5); await h.flush(); assert.equal(h.model.quantities[1], 10);
  h.state.recoveryError = null; h.state.recovered = order(2, 13);
  await h.model.recoverSubmission(); await h.flush(); await h.advance(800);
  assert.equal(h.model.step, "success"); assert.equal(storage.getItem(h5LocalDraftKey(draftContext())), null); h.unmount();
});

test("closed activities never restore carts and unavailable products are removed from a restored draft", async () => {
  const storage = memoryStorage(); seedDraft(storage, null);
  const closed = await harness(null, null, { storage, activityStatus: "closed" });
  assert.equal(Object.keys(closed.model.quantities).length, 0); assert.equal(storage.getItem(h5LocalDraftKey(draftContext())), null); closed.unmount();
  seedDraft(storage, null, null, [{ productId: 1, quantity: 3 }, { productId: 99, quantity: 5 }]);
  const h = await harness(null, null, { storage });
  assert.equal(h.model.quantities[1], 3); assert.equal(h.model.quantities[99], undefined);
  assert.match(h.model.draftMessage, /部分商品已不可订购/); h.unmount();
});
