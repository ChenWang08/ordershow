export type PriceTierInput = { minQuantity: string; casePrice: string };

export function editablePriceTiers(basePrice: string, tiers: readonly PriceTierInput[]): PriceTierInput[] {
  const rows = tiers.map(tier => ({ ...tier }));
  return rows[0]?.minQuantity === "1" ? rows : [{ minQuantity: "1", casePrice: basePrice }, ...rows];
}

export function priceTierInputErrors(basePrice: number, tiers: readonly PriceTierInput[]) {
  return tiers.map((tier, index) => {
    const min = Number(tier.minQuantity);
    const price = Number(tier.casePrice);
    const first = index === 0 && min === 1;
    const previousMin = index === 0 ? 0 : Number(tiers[index - 1].minQuantity);
    const previousPrice = index === 0 ? basePrice : Number(tiers[index - 1].casePrice);
    if (!tier.minQuantity.trim() || !Number.isInteger(min) || min < (index === 0 ? 1 : 2) || min > 999999 || min <= previousMin) return "起始箱数须为整数，第一档从 1 箱起，后续档位须为 2～999999 且大于上一档";
    if (!tier.casePrice.trim() || !Number.isFinite(price) || price <= 0 || (!first && price >= previousPrice) || !/^\d+(\.\d{1,4})?$/.test(tier.casePrice.trim())) return first ? "箱价须大于 0，最多 4 位小数" : "箱价须大于 0、低于上一档，最多 4 位小数";
    return "";
  });
}
