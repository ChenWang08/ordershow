import type { OrderVersionItem } from "./order-domain";

export function OrderPricingBreakdown({ item }: { item: OrderVersionItem }) {
  if (item.pricingDetails?.segments.length) return <>{item.pricingDetails.segments.map((part, index) => <small key={index}>{part.quantity} 箱 × ¥{part.casePrice} ＝ ¥{part.amount.toFixed(2)}</small>)}</>;
  if (item.pricingMode === "INCREMENTAL") return <>{item.basePriceQuantity ?? 0}箱×¥{item.baseCasePrice}；{item.tierPriceQuantity ?? 0}箱×¥{item.tierCasePrice}<small>第 {item.tierMinQuantity} 箱起分段计价</small></>;
  return <>¥{item.casePrice}{item.appliedTierMinQuantity && <small>满 {item.appliedTierMinQuantity} 箱整批优惠</small>}</>;
}
