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
