import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, webcrypto } from "node:crypto";
import { loadModule } from "./helpers/load-ts-module.mjs";
const { ApiError } = loadModule("app/services/api/client.ts");
const { createH5SubmissionManager } = loadModule("app/features/h5/h5-submission.ts", {
  "../../services/api/client": { ApiError },
}, { setTimeout, clearTimeout, AbortController });
const item = (productId, quantity) => ({ productId, quantity, materialName: "商品" + productId, casePrice: 10, lineAmount: quantity * 10 });
async function harness(status = "SUBMITTED", pending = null, activity = { code: "A", whitelistCustomerTypeMode: "UNSPECIFIED", regions: [] }) {
  let cursor = 0, fail = false, customerId = 2;
  const slots = [], calls = [], storage = new Map();
  const order = { id: 1, activityCustomerId: 2, orderNo: "ORDER1", status, currentVersion: 2, lockVersion: 4,
    items: [item(1, 10)], operations: [], lastModifiedAt: "2026-10-10T01:00:00Z" };
  const api = {
    ApiError, apiAssetUrl: url => url,
    verifyPhone: async (phone, selectedType) => {
      calls.push(["verify", phone, selectedType]);
      const type = selectedType || activity.availableCustomerTypes?.[0] || "ALL";
      customerId = type === "SPECIAL" ? 3 : 2;
      return { selectionRequired: false, csrfToken: "test", customer: { activityId: 1, customerId,
        customerType: type, regionCode: type === "GENERAL" ? "NORTH" : null, dealerFullName: "测试客户" } };
    },
    loadH5Products: async () => [1, 2].map(id => ({ id, materialName: "商品" + id, images: [], casePrice: 10, customerType: "ALL", rebateStatus: "ALL", orderable: true })),
    loadH5Order: async () => ({ ...order, activityCustomerId: customerId }),
    loadH5OrderChangeRequest: async () => pending ? { orderId: 1, baseVersion: 2, currentVersion: 2, ...pending } : null,
    createH5OrderChangeRequest: async (...args) => { calls.push(["review", ...args]); return { id: 8, status: "PENDING", requestType: args[3], items: args[4] }; },
    saveH5Order: async (...args) => {
      calls.push(["direct", ...args]);
      if (fail) throw new TypeError("lost response");
      return { ...order, status: "SUBMITTED", currentVersion: 3, lockVersion: 5, items: args[1].map(i => item(i.productId, i.quantity)) };
    },
  };
  const draft = { draftMessage: "", setDraftMessage() {}, restoreDraft: () => null,
    flushDraft: () => true, discardDraft: () => true, resetDraft: () => true, hasDraftChanges: () => false };
  const { useH5OrderFlow } = loadModule("app/features/h5/useH5OrderFlow.ts", {
    "../../api": api,
    "./useH5Draft": { useH5Draft: () => draft },
    "./h5-submission": { createH5SubmissionManager: options => createH5SubmissionManager({ ...options, uuid: randomUUID, sleep: async () => {} }) },
    react: {
      useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn,
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
        return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    },
  }, { crypto: { getRandomValues: values => webcrypto.getRandomValues(values) }, window: { clearTimeout, sessionStorage: {
    getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k),
  } } });
  const render = function useTestRender() { cursor = 0; return useH5OrderFlow({ activityStatus: "running", runtimeActivity: activity }); };
  render().setPhone("13800000001");
  await render().verifyIdentity();
  calls.length = 0;
  return { render, calls, draft, api, fail: value => { fail = value; } };
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
    await h.render().startEditingOrder(); assert.equal(h.render().step, "order");
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

test("recovery displays the administrator's latest quantities instead of the pending submission", async () => {
  const h = await harness();
  h.render().setQuantities({ 1: 12 }); h.fail(true);
  await h.render().submitOrder();
  assert.equal(h.render().pendingSubmission, true);
  const latest = { ...h.render().runtimeOrder, currentVersion: 4, lockVersion: 6,
    totalQuantity: 8, totalAmount: 80, items: [item(1, 8)] };
  h.api.saveH5Order = async (...args) => { h.calls.push(["direct", ...args]); return latest; };
  await h.render().recoverSubmission();
  assert.equal(h.calls[0][3], h.calls.at(-1)[3], "Recovery must retain the original idempotency key");
  assert.equal(h.calls.at(-1)[2][0].quantity, 12, "Recovery resends the same command, not a new edit");
  assert.equal(h.calls.length, 3, "No extra corrective submission may follow the replay");
  const model = h.render();
  assert.equal(model.pendingSubmission, false);
  assert.equal(model.runtimeOrder.currentVersion, 4);
  assert.equal(model.quantities[1], 8);
  assert.equal(model.orderViewBoxes, 8);
  assert.equal(model.orderViewAmount, 80);
});

test("editing during a pending withdrawal starts from the effective items", async () => {
  const h = await harness("SUBMITTED", { id: 7, status: "PENDING", requestType: "WITHDRAW", items: [] });
  await h.render().startEditingOrder();
  assert.equal(h.render().quantities[1], 10);
  h.render().setQuantities({ 1: 12 }); await h.render().submitOrder();
  assert.equal(h.calls[0][0], "direct");
});

const mixedActivity = { code: "A", availableCustomerTypes: ["GENERAL", "SPECIAL"], regions: [{ code: "NORTH", name: "北区" }] };

test("returning home remembers the phone, clears the old identity and requires a new type confirmation", async () => {
  const h = await harness("SUBMITTED", null, mixedActivity);
  const login = h.api.verifyPhone;
  h.api.verifyPhone = async (phone, type) => type ? login(phone, type) : { selectionRequired: true, customerTypes: ["GENERAL", "SPECIAL"] };
  for (const type of ["GENERAL", "SPECIAL", "GENERAL"]) {
    await h.render().resetEntry();
    assert.equal(h.render().phone, "13800000001");
    assert.equal(h.render().runtimeOrder, null);
    assert.equal(h.render().orderStatus, "none");
    assert.equal(Object.keys(h.render().quantities).length, 0);
    assert.equal(h.render().visibleStep, "verify");
    assert.equal(h.render().identityLabel, "手机号验证");
    await h.render().verifyIdentity();
    await h.render().verifyIdentity(type);
    assert.deepEqual(h.calls.at(-1), ["verify", "13800000001", type]);
    assert.equal(h.render().step, "submitted");
  }
});

test("single-type and unspecified activities retain their direct entry policy after reset", async () => {
  for (const activity of [{ code: "A", availableCustomerTypes: ["GENERAL"], regions: [] }, { code: "A", availableCustomerTypes: ["SPECIAL"], regions: [] }, { code: "A", whitelistCustomerTypeMode: "UNSPECIFIED", regions: [] }]) {
    const h = await harness("SUBMITTED", null, activity);
    await h.render().resetEntry();
    assert.equal(h.render().visibleStep, "verify");
    h.render().setPhone("13800000001");
    await h.render().verifyIdentity();
    assert.deepEqual(h.calls.at(-1), ["verify", "13800000001", undefined]);
  }
});

test("failed verification after a switch cannot expose the previous order", async () => {
  const h = await harness("SUBMITTED", null, mixedActivity);
  await h.render().resetEntry("综合客户");
  h.render().setRegion("SOUTH"); h.render().setStep("verify");
  h.api.verifyPhone = async () => { throw new Error("unavailable"); };
  await h.render().verifyIdentity();
  assert.equal(h.render().step, "verify");
  assert.equal(h.render().runtimeOrder, null);
  assert.equal(h.render().identityLabel, "手机号验证");
  assert.notEqual(h.render().verifyError, "");
});

test("verification is serialized with channel switching even before rerender", async () => {
  const h = await harness("SUBMITTED", null, mixedActivity);
  await h.render().resetEntry("特渠专业客户");
  let release;
  let requests = 0;
  h.api.verifyPhone = async () => { requests++; await new Promise(resolve => { release = resolve; }); return { selectionRequired: false, customer: { activityId: 1, customerId: 3, customerType: "SPECIAL" }, csrfToken: "test" }; };
  h.render().setPhone("13800000001");
  const model = h.render();
  const verifying = model.verifyIdentity();
  await model.verifyIdentity();
  await model.resetEntry("综合客户");
  assert.equal(requests, 1);
  release(); await verifying;
  assert.equal(h.render().channel, "特渠专业客户");
});
