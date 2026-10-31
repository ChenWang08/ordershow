import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

const { calculateTierPrice } = loadModule("app/domain/tier-pricing.ts");
const { editablePriceTiers, priceTierInputErrors } = loadModule("app/domain/tier-pricing-form.ts");
const mocks = { "../../api": { apiAssetUrl: url => url, ApiError: class extends Error {} } };
const h5 = loadModule("app/features/h5/h5-domain.ts", mocks);
const orders = loadModule("app/components/orders/order-domain.ts", mocks);
const tiers = [{ minQuantity: 500, casePrice: 290 }, { minQuantity: 1000, casePrice: 280 }, { minQuantity: 2000, casePrice: 270 }, { minQuantity: 5000, casePrice: 260 }];

test("whole order and incremental amounts share exact inclusive thresholds across H5 and admin", () => {
  for (const mode of ["WHOLE_ORDER", "INCREMENTAL"]) for (const quantity of [0, 1, 499, 500, 501, 999, 1000, 1001, 1200, 1999, 2000, 4999, 5000, 999999]) {
    const result = calculateTierPrice(300, tiers, mode, quantity);
    const product = { price: 300, priceTiers: tiers, tierPricingMode: mode };
    const runtime = { id: 1, casePrice: 300, priceTier: { ...tiers[0], pricingMode: mode, tiers } };
    assert.equal(h5.priceBreakdown(product, quantity).amount, result.amount);
    assert.equal(orders.estimateLineAmount(runtime, quantity), result.amount);
    assert.equal(orders.estimateLineAmount({ baseCasePrice: "300", pricingMode: mode, pricingDetails: { tiers, segments: result.segments } }, quantity), result.amount);
    assert.equal(result.segments.reduce((sum, part) => sum + part.quantity, 0), quantity);
    assert.equal(Math.round(result.segments.reduce((sum, part) => sum + part.amount, 0) * 100), Math.round(result.amount * 100));
  }
  assert.equal(calculateTierPrice(300, tiers, "WHOLE_ORDER", 1200).amount, 336000);
  assert.equal(calculateTierPrice(300, tiers, "INCREMENTAL", 1200).amount, 350980);
  assert.equal(calculateTierPrice(300, tiers, "INCREMENTAL", 500).amount, 149990);
});

test("four decimal prices allocate segment rounding to match the final amount", () => {
  const result = calculateTierPrice(0.105, [{ minQuantity: 2, casePrice: 0.1049 }], "INCREMENTAL", 3);
  assert.equal(result.amount, 0.31);
  assert.deepEqual(Array.from(result.segments, part => part.amount), [0.11, 0.2]);
  assert.equal(h5.unitPriceText(0.1049), "0.1049");
});

test("current and historical order editing preserve four decimal base prices", () => {
  const details = { tiers: [{ minQuantity: 2, casePrice: 0.1049 }], segments: [] };
  const item = { productId: 1, materialName: "测试", quantity: 3, casePrice: 0.105, baseCasePrice: 0.105,
    tierCasePrice: 0.1049, tierMinQuantity: 2, pricingMode: "INCREMENTAL", pricingDetails: details, lineAmount: 0.31 };
  const record = orders.toOrderRecord({ items: [item], versions: [{ version: 1, items: [item], totalAmount: 0.31 }], totalAmount: 0.31 });
  assert.equal(record.items[0].baseCasePrice, "0.105");
  assert.equal(record.versions[0].items[0].tierCasePrice, "0.1049");
  assert.equal(orders.estimateLineAmount(record.items[0], 3), 0.31);
  assert.equal(orders.estimateLineAmount(record.versions[0].items[0], 3), 0.31);
});

test("invalid, duplicate, unordered and increasing discount rows cannot be saved", () => {
  const rows = tiers.map(tier => ({ minQuantity: String(tier.minQuantity), casePrice: String(tier.casePrice) }));
  assert.ok(!priceTierInputErrors(300, rows).some(Boolean));
  for (const row of [{ minQuantity: "500.5", casePrice: "290" }, { minQuantity: "", casePrice: "290" }, { minQuantity: "500", casePrice: "300" }, { minQuantity: "500", casePrice: "290.12345" }]) assert.ok(priceTierInputErrors(300, [row]).some(Boolean));
  assert.ok(priceTierInputErrors(300, [rows[0], rows[0]]).some(Boolean));
});

test("server order snapshots retain all tiers, independent of the current catalog", () => {
  const product = h5.runtimeProductToProduct({ id: 1, materialName: "测试商品", casePrice: 300, customerType: "ALL", rebateStatus: "ALL", orderable: true, dataStatus: "ACTIVE", images: [], priceTier: { ...tiers[0], pricingMode: "INCREMENTAL", tiers } });
  assert.equal(h5.priceBreakdown(product, 1200).amount, 350980);
  assert.match(h5.tierPriceLabel(product, 1200), /499箱.*500箱.*201箱/);
});

test("an independent first tier drives every threshold in H5, admin and immutable snapshots", () => {
  const rules = [{ minQuantity: 1, casePrice: 298 }, { minQuantity: 100, casePrice: 290 }, { minQuantity: 500, casePrice: 280 }];
  for (const mode of ["WHOLE_ORDER", "INCREMENTAL"]) for (const quantity of [0, 1, 99, 100, 101, 499, 500, 501, 999999]) {
    const expected = mode === "WHOLE_ORDER" ? quantity * (quantity < 100 ? 298 : quantity < 500 ? 290 : 280)
      : Math.min(quantity, 99) * 298 + Math.min(Math.max(quantity - 99, 0), 400) * 290 + Math.max(quantity - 499, 0) * 280;
    const result = calculateTierPrice(300, rules, mode, quantity);
    assert.equal(result.amount, expected);
    assert.equal(calculateTierPrice(999, rules, mode, quantity).amount, expected);
    assert.equal(h5.priceBreakdown({ price: 300, priceTiers: rules, tierPricingMode: mode }, quantity).amount, expected);
    assert.equal(orders.estimateLineAmount({ id: 1, casePrice: 999, priceTier: { ...rules[1], pricingMode: mode, tiers: rules } }, quantity), expected);
    assert.equal(orders.estimateLineAmount({ baseCasePrice: "298", pricingMode: mode, pricingDetails: { tiers: rules, segments: result.segments } }, quantity), expected);
    assert.equal(result.segments.reduce((sum, part) => sum + part.quantity, 0), quantity);
  }
  assert.equal(calculateTierPrice(300, rules, "WHOLE_ORDER", 0).displayPrice, 298);
  assert.equal(calculateTierPrice(300, rules, "INCREMENTAL", 500).amount, 145782);
});

test("a single first tier, clearing rules and four decimal first prices remain valid", () => {
  for (const mode of ["WHOLE_ORDER", "INCREMENTAL"]) {
    assert.equal(calculateTierPrice(300, [{ minQuantity: 1, casePrice: 350 }], mode, 3).amount, 1050);
    assert.equal(calculateTierPrice(300, [], mode, 3).amount, 900);
    const result = calculateTierPrice(300, [{ minQuantity: 1, casePrice: 0.105 }, { minQuantity: 2, casePrice: 0.1049 }], mode, 3);
    assert.equal(result.amount, 0.31);
  }
  assert.match(h5.tierPriceLabel({ price: 300, priceTiers: [{ minQuantity: 1, casePrice: 350 }] }, 0), /1箱起¥350/);
});

test("first tier inputs are independent of the ordinary price and old rules retain their amounts", () => {
  const legacy = [{ minQuantity: "100", casePrice: "290" }];
  const restored = editablePriceTiers("300", legacy);
  assert.deepEqual(Array.from(restored, tier => ({ ...tier })), [{ minQuantity: "1", casePrice: "300" }, ...legacy]);
  const custom = [{ minQuantity: "1", casePrice: "350" }, { minQuantity: "100", casePrice: "340" }];
  assert.ok(!priceTierInputErrors(300, custom).some(Boolean));
  assert.equal(editablePriceTiers("999", custom)[0].casePrice, "350");
  for (const price of ["", "0", "-1", "350.12345"]) assert.ok(priceTierInputErrors(300, [{ minQuantity: "1", casePrice: price }]).some(Boolean));
  assert.ok(priceTierInputErrors(300, [custom[0], { minQuantity: "100", casePrice: "350" }]).some(Boolean));
  for (const mode of ["WHOLE_ORDER", "INCREMENTAL"]) for (const quantity of [1, 99, 100, 101]) {
    assert.equal(calculateTierPrice(300, restored.map(tier => ({ minQuantity: Number(tier.minQuantity), casePrice: Number(tier.casePrice) })), mode, quantity).amount,
      calculateTierPrice(300, [{ minQuantity: 100, casePrice: 290 }], mode, quantity).amount);
  }
});
