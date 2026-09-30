import { ApiError, type AdminCustomer, type AdminOrderSummary, type RuntimeOrder, type RuntimeProduct } from "../../api";

export type OrderStatus = "已提交" | "已撤回" | "已作废";
export type CustomerType = "特渠" | "综合" | "不区分客户类型";

export type OrderVersionItem = {
  productId?: number;
  line: string;
  materialCode: string;
  materialName: string;
  spec: string;
  casePack: string;
  casePrice: string;
  appliedTierMinQuantity?: number;
  baseCasePrice?: string;
  basePriceQuantity?: number;
  tierCasePrice?: string;
  tierMinQuantity?: number;
  tierPriceQuantity?: number;
  pricingMode?: "WHOLE_ORDER" | "INCREMENTAL";
  quantity: number;
  subtotal: string;
};

export function estimateLineAmount(product: RuntimeProduct | OrderVersionItem, quantity: number) {
  const runtimeProduct = "id" in product;
  const basePrice = Number(runtimeProduct ? product.casePrice : product.baseCasePrice ?? product.casePrice);
  if (!Number.isFinite(basePrice)) return null;
  const tierMin = runtimeProduct ? product.priceTier?.minQuantity : product.tierMinQuantity;
  const tierPriceValue = runtimeProduct ? product.priceTier?.casePrice : product.tierCasePrice;
  const tierPrice = tierPriceValue == null ? null : Number(tierPriceValue);
  if (tierMin == null || tierPrice == null || !Number.isFinite(tierPrice)) return basePrice * quantity;
  const mode = runtimeProduct ? product.priceTier?.pricingMode || "WHOLE_ORDER" : product.pricingMode || "WHOLE_ORDER";
  if (mode === "INCREMENTAL") {
    const baseQuantity = Math.min(quantity, Math.max(0, tierMin - 1));
    return basePrice * baseQuantity + tierPrice * Math.max(0, quantity - baseQuantity);
  }
  return quantity >= tierMin ? tierPrice * quantity : basePrice * quantity;
}

export type OrderVersion = {
  version: string;
  action: string;
  at: string;
  amount: string;
  detail: string;
  operator: string;
  reason?: string;
  items: OrderVersionItem[];
};

export type OrderRecord = {
  id?: number;
  activityCustomerId?: number;
  no: string;
  dealer: string;
  dealerPhone: string;
  company: string;
  type: CustomerType;
  amount: string;
  boxes: number;
  tons: string;
  createdAt: string;
  submittedAt: string;
  updatedAt: string;
  withdrawnAt: string;
  withdrawReason: string;
  voidedAt: string;
  voidedReason: string;
  source: "客户" | "管理员";
  currentVersion: number;
  lockVersion: number;
  versions: OrderVersion[];
  items: OrderVersionItem[];
  permission: "可修改" | "可重新提交" | "已作废";
  status: OrderStatus;
  operationRecords: Array<{ time: string; title: string; detail: string }>;
};

export function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatMoney(value: number) {
  return `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function customerTypeLabel(customerType: string) {
  return customerType === "SPECIAL" ? "特渠" : customerType === "GENERAL" ? "综合" : "不区分客户类型";
}

export function editorErrorMessage(reason: unknown, fallback: string) {
  if (!(reason instanceof ApiError)) return fallback;
  const code = reason.code && reason.code !== "INTERNAL_ERROR" ? `（${reason.code}）` : "";
  const trace = reason.traceId ? ` · 追踪号 ${reason.traceId}` : "";
  return `${reason.message}${code}${trace}`;
}

export function editorCustomerFromOrder(order: RuntimeOrder): AdminCustomer {
  const customerType = order.customerType === "SPECIAL" ? "SPECIAL" : order.customerType === "GENERAL" ? "GENERAL" : "ALL";
  return {
    id: order.activityCustomerId,
    customerType,
    regionCode: order.regionCode,
    branchName: order.branchName,
    dealerShortName: order.dealerShortName,
    dealerFullName: order.dealerFullName,
    phone: order.phone || order.phoneMasked,
    phoneMasked: order.phoneMasked,
    active: true,
    lockVersion: 0,
    updatedAt: order.lastModifiedAt,
  };
}

export function toOrderRecord(order: AdminOrderSummary | RuntimeOrder): OrderRecord {
  const detail = order as RuntimeOrder;
  const customerType: CustomerType = order.customerType === "SPECIAL" ? "特渠" : order.customerType === "GENERAL" ? "综合" : "不区分客户类型";
  const versions: OrderVersion[] = [...(detail.versions ?? [])]
    .sort((left, right) => left.version - right.version)
    .map((version) => ({
      version: `V${version.version}`,
      action: version.version === 1 ? "首次提交" : "修改后提交",
      at: formatDate(version.submittedAt),
      amount: formatMoney(version.totalAmount),
      detail: `${version.totalQuantity} 箱 · ${version.items?.length ?? 0} 种商品`,
      operator: version.submittedSource === "ADMIN" ? "管理员" : "客户",
      reason: version.reason,
      items: (version.items ?? []).map((item) => ({
        productId: item.productId,
        line: item.productLine || "未分类",
        materialCode: item.materialCode || "—",
        materialName: item.materialName,
        spec: item.specification || "—",
        casePack: item.casePack || "—",
        casePrice: Number(item.casePrice).toFixed(2),
        appliedTierMinQuantity: item.appliedTierMinQuantity,
        baseCasePrice: item.baseCasePrice == null ? undefined : Number(item.baseCasePrice).toFixed(2),
        basePriceQuantity: item.basePriceQuantity,
        tierCasePrice: item.tierCasePrice == null ? undefined : Number(item.tierCasePrice).toFixed(2),
        tierMinQuantity: item.tierMinQuantity,
        tierPriceQuantity: item.tierPriceQuantity,
        pricingMode: item.pricingMode,
        quantity: Number(item.quantity),
        subtotal: Number(item.lineAmount).toFixed(2),
      })),
    }));
  const operationLabels: Record<string, string> = {
    FIRST_SUBMIT: "客户首次提交",
    MODIFY_SUBMIT: "客户修改后提交",
    WITHDRAW: "客户撤回",
    RESUBMIT: "客户重新提交",
    ADMIN_CREATE: "管理员创建订单",
    ADMIN_ADJUST: "管理员调整订单",
    ADMIN_VOID: "管理员作废订单",
    ADMIN_RESTORE: "管理员恢复订单",
    H5_CHANGE_REQUESTED: "客户提交变更申请",
    H5_CHANGE_APPROVED: "管理员审核通过订单变更",
    H5_CHANGE_REJECTED: "订单变更申请已驳回",
  };
  const status: OrderStatus = order.status === "WITHDRAWN" ? "已撤回" : order.status === "VOIDED" ? "已作废" : "已提交";
  return {
    id: order.id,
    activityCustomerId: detail.activityCustomerId,
    no: order.orderNo,
    dealer: order.dealerFullName,
    dealerPhone: order.phone || order.phoneMasked,
    company: order.branchName || "未分公司",
    type: customerType,
    amount: formatMoney(order.totalAmount),
    boxes: Number(order.totalQuantity),
    tons: order.totalTons == null ? "—" : Number(order.totalTons).toFixed(3),
    createdAt: formatDate(order.firstSubmittedAt),
    submittedAt: formatDate(order.lastSubmittedAt),
    updatedAt: formatDate(order.lastModifiedAt),
    withdrawnAt: formatDate(detail.withdrawnAt),
    withdrawReason: detail.withdrawnReason || "客户主动撤回",
    voidedAt: formatDate(detail.voidedAt),
    voidedReason: detail.voidedReason || "管理员作废",
    source: order.createdSource === "ADMIN" ? "管理员" : "客户",
    currentVersion: order.currentVersion,
    lockVersion: order.lockVersion,
    versions,
    items: (detail.items ?? []).map((item) => ({
        productId: item.productId,
        line: item.productLine || "未分类",
        materialCode: item.materialCode || "—",
        materialName: item.materialName,
        spec: item.specification || "—",
        casePack: item.casePack || "—",
        casePrice: Number(item.casePrice).toFixed(2),
        appliedTierMinQuantity: item.appliedTierMinQuantity,
        baseCasePrice: item.baseCasePrice == null ? undefined : Number(item.baseCasePrice).toFixed(2),
        basePriceQuantity: item.basePriceQuantity,
        tierCasePrice: item.tierCasePrice == null ? undefined : Number(item.tierCasePrice).toFixed(2),
        tierMinQuantity: item.tierMinQuantity,
        tierPriceQuantity: item.tierPriceQuantity,
        pricingMode: item.pricingMode,
        quantity: Number(item.quantity),
        subtotal: Number(item.lineAmount).toFixed(2),
      })),
    permission: order.status === "WITHDRAWN" ? "可重新提交" : order.status === "VOIDED" ? "已作废" : "可修改",
    status,
    operationRecords: (detail.operations ?? []).map((operation) => ({
      time: formatDate(operation.occurredAt),
      title: operationLabels[operation.type] || operation.type,
      detail: `${operation.source === "H5" ? "客户" : operation.source === "ADMIN" ? "管理员" : operation.source === "SYSTEM" ? "系统" : operation.source}${operation.adminName ? `（${operation.adminName}）` : ""}${operation.orderVersion ? ` · V${operation.orderVersion}` : ""}${operation.reason ? ` · ${operation.reason}` : ""}`,
    })),
  };
}

export type OrderManagementProps = { activityClosed: boolean; activityStarted: boolean; activityId: number; activityName: string };
