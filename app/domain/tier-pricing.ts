export type PriceStep = { minQuantity: number; casePrice: number };
export type PriceSegment = PriceStep & { maxQuantity: number | null; quantity: number; amount: number };
export type PricingDetails = { tiers: PriceStep[]; segments: PriceSegment[] };
export type PricingMode = "WHOLE_ORDER" | "INCREMENTAL";

// Prices have four decimal places in MySQL. Integer arithmetic matches server HALF_UP rounding.
function units(price: number) {
  const [whole, fraction] = price.toFixed(4).split(".");
  return BigInt(whole) * BigInt(10000) + BigInt(fraction);
}
const cents = (value: bigint) => (value + BigInt(50)) / BigInt(100);

export function calculateTierPrice(basePrice: number, tiers: readonly PriceStep[], mode: PricingMode | undefined, quantity: number) {
  // New rules include an independent first row; old snapshots still use the supplied base price.
  const explicitFirst = tiers[0]?.minQuantity === 1;
  if (explicitFirst) basePrice = tiers[0].casePrice;
  const discounts = explicitFirst ? tiers.slice(1) : tiers;
  const segments: PriceSegment[] = [];
  let total = BigInt(0);
  let baseQuantity = 0;
  let displayPrice = basePrice;
  if (mode === "INCREMENTAL" && tiers.length) {
    for (let index = -1; index < discounts.length; index++) {
      const minQuantity = index < 0 ? 1 : discounts[index].minQuantity;
      const maxQuantity = index + 1 < discounts.length ? discounts[index + 1].minQuantity - 1 : null;
      const charged = Math.max(0, Math.min(quantity, maxQuantity ?? quantity) - minQuantity + 1);
      if (!charged) break;
      const casePrice = index < 0 ? basePrice : discounts[index].casePrice;
      const next = total + units(casePrice) * BigInt(charged);
      segments.push({ minQuantity, maxQuantity, quantity: charged, casePrice, amount: Number(cents(next) - cents(total)) / 100 });
      total = next;
      if (index < 0) baseQuantity = charged;
    }
  } else {
    let applied: PriceStep | undefined;
    for (const tier of discounts) { if (quantity >= tier.minQuantity) applied = tier; else break; }
    displayPrice = applied?.casePrice ?? basePrice;
    baseQuantity = applied ? 0 : quantity;
    total = units(displayPrice) * BigInt(quantity);
    if (quantity > 0) segments.push({ minQuantity: applied?.minQuantity ?? 1, maxQuantity: null, quantity, casePrice: displayPrice, amount: Number(cents(total)) / 100 });
  }
  return { amount: Number(cents(total)) / 100, displayPrice, baseQuantity, tierQuantity: quantity - baseQuantity, segments };
}

export function legacyTiers(minQuantity?: number, casePrice?: number): PriceStep[] {
  return minQuantity == null || casePrice == null ? [] : [{ minQuantity, casePrice }];
}
