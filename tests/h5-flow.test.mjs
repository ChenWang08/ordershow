import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

const domain = loadModule("app/features/h5/h5-domain.ts", { "../../api": { apiAssetUrl: (url) => url } });

test("H5 pricing keeps whole-order and incremental tier boundaries", () => {
  const product = { price: 136, tierMinQuantity: 1500, tierCasePrice: 134, tierPricingMode: "WHOLE_ORDER" };
  assert.equal(domain.priceBreakdown(product, 1499).amount, 203864);
  assert.equal(domain.priceBreakdown(product, 1500).amount, 201000);
  assert.equal(domain.priceBreakdown({ ...product, tierPricingMode: "INCREMENTAL" }, 1500).amount, 203998);
  assert.equal(domain.priceBreakdown({ ...product, tierPricingMode: "INCREMENTAL" }, 1501).amount, 204132);
});

test("draft signatures ignore zero quantities and product order", () => {
  assert.equal(domain.h5QuantitySignature([{ productId: 2, quantity: 0 }, { productId: 3, quantity: 4 }, { productId: 1, quantity: 2 }]),
    domain.h5QuantitySignature([{ productId: 1, quantity: 2 }, { productId: 3, quantity: 4 }]));
});

function draftHarness(overrides = {}) {
  const calls = [];
  const slots = [];
  let cursor = 0;
  const api = {
    ApiError: class ApiError extends Error {},
    saveH5OrderDraft: async (...args) => calls.push(["save", ...args]),
    deleteH5OrderDraft: async (...args) => calls.push(["delete", ...args]),
    ...overrides,
  };
  const { useH5Draft } = loadModule("app/features/h5/useH5Draft.ts", {
    "../../api": api,
    react: {
      useEffect: () => {},
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = value; }];
      },
    },
  });
  return { calls, render: function useDraftRender() { cursor = 0; return useH5Draft({ activityClosed: false, catalog: [], quantities: {}, runtimeIdentity: null, runtimeOrder: null }); } };
}

const snapshot = (signature = "changed") => ({ customerId: 1, baseOrderVersion: 2, baseSignature: "base", signature, items: [{ productId: 3, quantity: 4 }] });

test("draft save is skipped after the customer changes", async () => {
  const harness = draftHarness();
  const model = harness.render();
  model.draftOwnerIdRef.current = 2;
  await model.queueDraftSync(snapshot());
  assert.deepEqual(harness.calls, []);
});

test("reverting to the submitted quantities deletes the draft", async () => {
  const harness = draftHarness();
  const model = harness.render();
  model.draftOwnerIdRef.current = 1;
  await model.queueDraftSync(snapshot("base"));
  assert.deepEqual(harness.calls, [["delete", 1]]);
  assert.equal(model.lastSavedDraftSignatureRef.current, "base");
});

test("draft writes remain serialized and duplicate snapshots are skipped", async () => {
  let release;
  const writes = [];
  const harness = draftHarness({ saveH5OrderDraft: async () => { writes.push("save"); await new Promise((resolve) => { release = resolve; }); } });
  const model = harness.render();
  model.draftOwnerIdRef.current = 1;
  const first = model.queueDraftSync(snapshot());
  const duplicate = model.queueDraftSync(snapshot());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
  release(); await first; await duplicate;
  assert.equal(writes.length, 1);
});

test("failed draft writes do not block a later retry", async () => {
  let attempts = 0;
  const harness = draftHarness({ saveH5OrderDraft: async () => { if (++attempts === 1) throw new Error("offline"); } });
  const model = harness.render();
  model.draftOwnerIdRef.current = 1;
  await model.queueDraftSync(snapshot());
  assert.equal(model.lastSavedDraftSignatureRef.current, "");
  await model.queueDraftSync(snapshot());
  assert.equal(attempts, 2);
  assert.equal(model.lastSavedDraftSignatureRef.current, "changed");
});

const oldOrder = { status: "SUBMITTED", items: [{ productId: 1, quantity: 10 }, { productId: 2, quantity: 5 }] };
test("only per-product reductions require review, including mixed changes with higher totals", () => {
  assert.equal(domain.h5RequiresReview(oldOrder, [{ productId: 1, quantity: 12 }, { productId: 2, quantity: 5 }, { productId: 3, quantity: 1 }]), false);
  assert.equal(domain.h5RequiresReview(oldOrder, oldOrder.items), false);
  assert.equal(domain.h5RequiresReview(oldOrder, [{ productId: 1, quantity: 9 }, { productId: 2, quantity: 100 }]), true);
  assert.equal(domain.h5RequiresReview(oldOrder, [{ productId: 1, quantity: 100 }]), true);
});
test("first orders and both inactive statuses bypass the old quantities", () => {
  const items = [{ productId: 1, quantity: 1 }];
  assert.equal(domain.h5RequiresReview(null, items), false);
  for (const status of ["WITHDRAWN", "VOIDED"]) assert.equal(domain.h5RequiresReview({ ...oldOrder, status }, items), false);
});
