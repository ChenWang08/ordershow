import { apiAssetUrl, type RuntimeProduct, type RuntimeOrder, type RuntimeActivity } from "../../api";
import type { ProductImportRow, WhitelistRow } from "../../domain/import-domain";
import type { ActivityStatus } from "../shared/types";
import { money } from "../shared/utils";

export type H5Step = "channel" | "region" | "verify" | "order" | "confirm" | "success" | "submitted";
export type H5OrderStatus = "none" | "submitted" | "withdrawn" | "voided";
export type H5Channel = "综合客户" | "特渠专业客户" | "";
export type RebateFilter = "ALL" | "PARTICIPATING" | "NOT_PARTICIPATING";
export type Product = {
  id: string;
  name: string;
  line: string;
  spec: string;
  price: number;
  tierMinQuantity?: number;
  tierCasePrice?: number;
  tierPricingMode?: "WHOLE_ORDER" | "INCREMENTAL";
  rebate: boolean | "全部";
  gift: boolean;
  atlas: number;
  customerType: "综合" | "特渠" | "全部";
  branchScope: string[];
  status: "有效" | "待核对" | "待完善";
  isOrderable: boolean;
  materialCode?: string;
  casePack?: string;
  description?: string;
  imageUrl?: string;
  imageUrls?: string[];
};

export function splitBranchScope(value: string) {
  return value.split(/[，,、]/).map((item) => item.trim()).filter(Boolean);
}

export function productRowToProduct(row: ProductImportRow): Product {
  const lineAtlas = row.line === "酱油" ? 1 : row.line === "食醋" ? 2 : row.gift === "是" ? 3 : 0;
  const imageUrls = row.imageStatus === "待确认" || row.imageStatus === "未匹配"
    ? []
    : row.images?.map((image) => image.url) ?? [];
  return {
    id: row.id,
    name: row.materialName,
    line: row.line,
    spec: row.spec,
    price: Number(row.casePrice) || 0,
    tierMinQuantity: row.priceTierMinQuantity ? Number(row.priceTierMinQuantity) : undefined,
    tierCasePrice: row.priceTierCasePrice ? Number(row.priceTierCasePrice) : undefined,
    tierPricingMode: row.priceTierPricingMode,
    rebate: row.rebate === "" ? "全部" : row.rebate === "参与",
    gift: row.gift === "是",
    atlas: lineAtlas,
    customerType: row.customerType || "全部",
    branchScope: splitBranchScope(row.branchScope),
    status: row.status,
    isOrderable: Number(row.casePrice) > 0,
    materialCode: row.materialCode,
    casePack: row.casePack,
    description: row.description,
    imageUrl: imageUrls?.[0],
    imageUrls,
  };
}

export function runtimeProductToProduct(row: RuntimeProduct): Product {
  const imageUrls = [...row.images]
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.sortNo - b.sortNo || a.id - b.id)
    .map((image) => apiAssetUrl(image.url));
  return {
    id: String(row.id),
    name: row.materialName,
    line: row.productLine || row.categoryName || "未分类",
    spec: row.specification || row.casePack || "",
    price: Number(row.casePrice || 0),
    tierMinQuantity: row.priceTier?.minQuantity,
    tierCasePrice: row.priceTier?.casePrice,
    tierPricingMode: row.priceTier?.pricingMode,
    rebate: row.rebateStatus === "ALL" ? "全部" : row.rebateStatus === "PARTICIPATING",
    gift: row.giftBox,
    atlas: row.productLine === "酱油" ? 1 : row.productLine === "食醋" ? 2 : row.giftBox ? 3 : 0,
    customerType: row.customerType === "GENERAL" ? "综合" : row.customerType === "SPECIAL" ? "特渠" : "全部",
    branchScope: row.branchScope ?? [],
    status: row.dataStatus === "INCOMPLETE" ? "待完善" : "有效",
    isOrderable: row.orderable,
    materialCode: row.materialCode,
    casePack: row.casePack,
    description: row.description,
    imageUrl: imageUrls[0],
    imageUrls,
  };
}

export type SubmittedOrderItem = { product: Product; quantity: number; lineAmount?: number };

export function productLineLabel(line: string | null | undefined) {
  return line?.trim() || "未分类";
}

export function groupByProductLine<T>(items: readonly T[], getLine: (item: T) => string | null | undefined) {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const line = productLineLabel(getLine(item));
    const group = groups.get(line);
    if (group) group.push(item);
    else groups.set(line, [item]);
  });
  return Array.from(groups, ([line, groupedItems]) => ({ line, items: groupedItems }));
}

export function priceBreakdown(product: Product, quantity: number) {
  if (product.tierMinQuantity == null || product.tierCasePrice == null) {
    return { amount: quantity * product.price, displayPrice: product.price, baseQuantity: quantity, tierQuantity: 0 };
  }
  if (product.tierPricingMode === "INCREMENTAL") {
    const baseQuantity = Math.min(quantity, product.tierMinQuantity - 1);
    const tierQuantity = Math.max(0, quantity - baseQuantity);
    return { amount: baseQuantity * product.price + tierQuantity * product.tierCasePrice,
      displayPrice: product.price, baseQuantity, tierQuantity };
  }
  const applied = quantity >= product.tierMinQuantity;
  return { amount: quantity * (applied ? product.tierCasePrice : product.price),
    displayPrice: applied ? product.tierCasePrice : product.price, baseQuantity: applied ? 0 : quantity, tierQuantity: applied ? quantity : 0 };
}

export function summarizeOrderLineAmounts(items: readonly SubmittedOrderItem[]) {
  const summaries = new Map<string, { line: string; amount: number }>();
  items.forEach((item) => {
    const line = productLineLabel(item.product.line);
    const summary = summaries.get(line) ?? { line, amount: 0 };
    const amount = typeof item.lineAmount === "number" && Number.isFinite(item.lineAmount)
      ? item.lineAmount
      : priceBreakdown(item.product, item.quantity).amount;
    summary.amount += amount;
    summaries.set(line, summary);
  });
  return Array.from(summaries.values());
}

export function tierPriceLabel(product: Product, quantity: number) {
  if (product.tierMinQuantity == null || product.tierCasePrice == null) return "";
  if (product.tierPricingMode === "INCREMENTAL") {
    return quantity >= product.tierMinQuantity
      ? `前${product.tierMinQuantity - 1}箱¥${money(product.price)}，超出${quantity - product.tierMinQuantity + 1}箱¥${money(product.tierCasePrice)}`
      : `第${product.tierMinQuantity}箱起，超出部分¥${money(product.tierCasePrice)}/箱`;
  }
  return quantity >= product.tierMinQuantity
    ? `已享满${product.tierMinQuantity}箱整批优惠`
    : `满${product.tierMinQuantity}箱，整批¥${money(product.tierCasePrice)}/箱`;
}

export type H5DraftSnapshot = {
  customerId: number;
  baseOrderVersion: number;
  baseSignature: string;
  signature: string;
  items: Array<{ productId: number; quantity: number }>;
};

export function h5QuantitySignature(items: Array<{ productId: number; quantity: number }>) {
  return JSON.stringify(items.filter((item) => item.quantity > 0).sort((a, b) => a.productId - b.productId));
}

export function h5OrderItems(order: RuntimeOrder | null) {
  return order?.items.map((item) => ({ productId: item.productId, quantity: item.quantity })) ?? [];
}

export type H5Props = { activityStatus: ActivityStatus; importedRows: ProductImportRow[] | null; importedWhitelistRows: WhitelistRow[] | null; runtimeActivity: RuntimeActivity | null };

/** Compare each original product; totals and pending applications are not the baseline. */
export function h5RequiresReview(order: Pick<RuntimeOrder, "status" | "items"> | null, items: Array<{ productId: number; quantity: number }>): boolean {
  if (order?.status !== "SUBMITTED") return false;
  const next = new Map(items.map(item => [item.productId, item.quantity]));
  return order.items.some(item => (next.get(item.productId ?? 0) ?? 0) < item.quantity);
}
