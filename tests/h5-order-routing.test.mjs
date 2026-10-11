import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, webcrypto } from "node:crypto";
import { loadModule } from "./helpers/load-ts-module.mjs";
const { ApiError } = loadModule("app/services/api/client.ts");
const { createH5SubmissionManager } = loadModule("app/features/h5/h5-submission.ts", {
  "../../services/api/client": { ApiError },
}, { setTimeout, clearTimeout, AbortController });
const item = (productId, quantity) => ({ productId, quantity, materialName: "商品" + productId, casePrice: 10, lineAmount: quantity * 10 });
async function harness(status = "SUBMITTED", pending = null) {
  let cursor = 0, fail = false;
  const slots = [], calls = [], storage = new Map();
  const order = { id: 1, orderNo: "ORDER1", status, currentVersion: 2, lockVersion: 4,
    items: [item(1, 10)], operations: [], lastModifiedAt: "2026-10-10T01:00:00Z" };
  const api = {
    ApiError, apiAssetUrl: url => url,
    verifyPhone: async () => ({ activityId: 1, customerId: 2, customerType: "ALL", dealerFullName: "测试客户" }),
    loadH5Products: async () => [1, 2].map(id => ({ id, materialName: "商品" + id, images: [], casePrice: 10, customerType: "ALL", rebateStatus: "ALL", orderable: true })),
    loadH5Order: async () => order,
    loadH5OrderChangeRequest: async () => pending,
    loadH5OrderDraft: async () => null,
    createH5OrderChangeRequest: async (...args) => { calls.push(["review", ...args]); return { id: 8, status: "PENDING", requestType: args[3], items: args[4] }; },
    saveH5Order: async (...args) => {
      calls.push(["direct", ...args]);
      if (fail) throw new TypeError("lost response");
      return { ...order, status: "SUBMITTED", currentVersion: 3, lockVersion: 5, items: args[1].map(i => item(i.productId, i.quantity)) };
    },
  };
  const draft = { setDraftReady() {}, draftMessage: "", setDraftMessage() {}, draftOwnerIdRef: { current: null },
    lastSavedDraftSignatureRef: { current: "" }, latestDraftSnapshotRef: { current: null }, draftSaveTimerRef: { current: null },
    draftSaveChainRef: { current: Promise.resolve() }, queueDraftSync: async () => {} };
  const { useH5OrderFlow } = loadModule("app/features/h5/useH5OrderFlow.ts", {
    "../../api": api,
    "./useH5Draft": { useH5Draft: () => draft },
    "./h5-submission": { createH5SubmissionManager: options => createH5SubmissionManager({ ...options, uuid: randomUUID, sleep: async () => {} }) },
    react: {
      useEffect() {}, useMemo: fn => fn(),
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
        return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    },
  }, { crypto: { getRandomValues: values => webcrypto.getRandomValues(values) }, window: { clearTimeout, sessionStorage: {
    getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k),
  } } });
  const render = function useTestRender() { cursor = 0; return useH5OrderFlow({ activityStatus: "running", runtimeActivity: { code: "A", whitelistCustomerTypeMode: "UNSPECIFIED", regions: [] } }); };
  await render().verifyIdentity();
  return { render, calls, fail: value => { fail = value; } };
}
test("H5 pure increases use direct submission and clear the old pending application", async () => {
  const h = await harness("SUBMITTED", { id: 7, status: "PENDING", requestType: "MODIFY", items: [item(1, 5)] });
  h.render().setQuantities({ 1: 12, 2: 3 });
  await h.render().submitOrder();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0][0], "direct");
  assert.equal(h.calls[0][7], 4);
  assert.equal(h.render().pendingChangeRequest, null); assert.equal(h.render().step, "success");
});
test("mixed reductions are sent for review against the effective order", async () => {
  const h = await harness(); h.render().setQuantities({ 1: 9, 2: 100 });
  assert.equal(h.render().requiresReview, true);
  await h.render().submitOrder();
  assert.equal(h.calls[0][0], "review"); assert.equal(h.render().runtimeOrder.currentVersion, 2);
});
test("unchanged quantities issue no request and retain the existing application", async () => {
  const pending = { id: 7, status: "PENDING", requestType: "MODIFY", items: [item(1, 5)] };
  const h = await harness("SUBMITTED", pending); await h.render().submitOrder();
  assert.equal(h.calls.length, 0); assert.equal(h.render().pendingChangeRequest.id, 7);
});
test("withdrawn and voided orders can be edited and directly restored with fewer boxes", async () => {
  for (const status of ["WITHDRAWN", "VOIDED"]) {
    const h = await harness(status); assert.equal(h.render().customerOrderReadOnly, false);
    h.render().startEditingOrder(); assert.equal(h.render().step, "order");
    h.render().setQuantities({ 1: 5 }); await h.render().submitOrder();
    assert.equal(h.calls[0][0], "direct"); assert.equal(h.render().submitMode, "restore");
  }
});
test("an uncertain increase is recovered with the same key and lock version", async () => {
  const h = await harness(); h.render().setQuantities({ 1: 12 }); h.fail(true);
  await h.render().submitOrder(); assert.equal(h.render().pendingSubmission, true);
  h.fail(false); await h.render().recoverSubmission();
  assert.equal(h.calls[0][3], h.calls.at(-1)[3]); assert.equal(h.calls.at(-1)[7], 4);
  assert.equal(h.render().pendingSubmission, false); assert.equal(h.render().step, "success");
});

test("editing during a pending withdrawal starts from the effective items", async () => {
  const h = await harness("SUBMITTED", { id: 7, status: "PENDING", requestType: "WITHDRAW", items: [] });
  h.render().startEditingOrder();
  assert.equal(h.render().quantities[1], 10);
  h.render().setQuantities({ 1: 12 }); await h.render().submitOrder();
  assert.equal(h.calls[0][0], "direct");
});
