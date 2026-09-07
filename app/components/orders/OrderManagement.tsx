"use client";

import { useEffect, useMemo, useState } from "react";
import {
  adjustAdminOrder,
  ApiError,
  createAdminOrder,
  exportAdminOrders,
  loadAdminOrder,
  loadAdminOrders,
  loadAdminProducts,
  previewAdminOrder,
  searchAdminCustomers,
  voidAdminOrder,
  type AdminCustomer,
  type AdminOrderPreview,
  type AdminOrderSummary,
  type RuntimeOrder,
  type RuntimeProduct,
} from "../../api";

type OrderStatus = "已提交" | "已撤回" | "已作废";
type CustomerType = "特渠" | "综合" | "不区分客户类型";

type OrderVersionItem = {
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

function estimateLineAmount(product: RuntimeProduct | OrderVersionItem, quantity: number) {
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

type OrderVersion = {
  version: string;
  action: string;
  at: string;
  amount: string;
  detail: string;
  operator: string;
  reason?: string;
  items: OrderVersionItem[];
};

type OrderRecord = {
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

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatMoney(value: number) {
  return `¥${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function customerTypeLabel(customerType: string) {
  return customerType === "SPECIAL" ? "特渠" : customerType === "GENERAL" ? "综合" : "不区分客户类型";
}

function editorErrorMessage(reason: unknown, fallback: string) {
  if (!(reason instanceof ApiError)) return fallback;
  const code = reason.code && reason.code !== "INTERNAL_ERROR" ? `（${reason.code}）` : "";
  const trace = reason.traceId ? ` · 追踪号 ${reason.traceId}` : "";
  return `${reason.message}${code}${trace}`;
}

function editorCustomerFromOrder(order: RuntimeOrder): AdminCustomer {
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

function toOrderRecord(order: AdminOrderSummary | RuntimeOrder): OrderRecord {
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
      detail: `${operation.source === "H5" ? "客户" : operation.source === "ADMIN" ? "管理员" : operation.source}${operation.adminName ? `（${operation.adminName}）` : ""}${operation.orderVersion ? ` · V${operation.orderVersion}` : ""}${operation.reason ? ` · ${operation.reason}` : ""}`,
    })),
  };
}

export function OrderManagement({ activityClosed, activityStarted, activityId, activityName }: { activityClosed: boolean; activityStarted: boolean; activityId: number; activityName: string }) {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [orderCounts, setOrderCounts] = useState({ all: 0, submitted: 0, withdrawn: 0, voided: 0 });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [orderFilter, setOrderFilter] = useState<"全部" | OrderStatus>("全部");
  const [customerType, setCustomerType] = useState<"全部" | CustomerType>("全部");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedNo, setSelectedNo] = useState<string | null>(null);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editorMode, setEditorMode] = useState<"create" | "adjust" | null>(null);
  const [editorOrder, setEditorOrder] = useState<OrderRecord | null>(null);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [products, setProducts] = useState<RuntimeProduct[]>([]);
  const [editorCustomerId, setEditorCustomerId] = useState("");
  const [editorCustomerSnapshot, setEditorCustomerSnapshot] = useState<AdminCustomer | null>(null);
  const [editorCustomerSearch, setEditorCustomerSearch] = useState("");
  const [customerSearchBusy, setCustomerSearchBusy] = useState(false);
  const [editorQuantities, setEditorQuantities] = useState<Record<number, number>>({});
  const [editorExistingItems, setEditorExistingItems] = useState<OrderVersionItem[]>([]);
  const [editorProductSearch, setEditorProductSearch] = useState("");
  const [editorReason, setEditorReason] = useState("");
  const [editorPreview, setEditorPreview] = useState<AdminOrderPreview | null>(null);
  const [editorPreviewBusy, setEditorPreviewBusy] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorError, setEditorError] = useState("");
  const selected = orders.find((order) => order.no === selectedNo) ?? null;

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const status = orderFilter === "已提交" ? "SUBMITTED" : orderFilter === "已撤回" ? "WITHDRAWN" : orderFilter === "已作废" ? "VOIDED" : undefined;
        const runtimeCustomerType = customerType === "综合" ? "GENERAL" : customerType === "特渠" ? "SPECIAL" : customerType === "不区分客户类型" ? "ALL" : undefined;
        const [current, all, submitted, withdrawn, voided] = await Promise.all([
          loadAdminOrders(activityId, { status, customerType: runtimeCustomerType, keyword: search, page, size: 50 }),
          loadAdminOrders(activityId, { page: 1, size: 1 }),
          loadAdminOrders(activityId, { status: "SUBMITTED", page: 1, size: 1 }),
          loadAdminOrders(activityId, { status: "WITHDRAWN", page: 1, size: 1 }),
          loadAdminOrders(activityId, { status: "VOIDED", page: 1, size: 1 }),
        ]);
        if (!active) return;
        setOrders(current.data.map(toOrderRecord));
        setTotalPages(Math.max(1, current.page.totalPages));
        setOrderCounts({ all: all.page.totalElements, submitted: submitted.page.totalElements, withdrawn: withdrawn.page.totalElements, voided: voided.page.totalElements });
        setLoadError("");
      } catch (reason) {
        if (active) setLoadError(reason instanceof ApiError ? reason.message : "订单数据加载失败");
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activityId, customerType, orderFilter, page, reloadKey, search]);

  const filteredOrders = useMemo(() => orders.filter((order) => {
    const keyword = search.trim();
    const digits = keyword.replace(/\D/g, "");
    const matchesPhone = Boolean(keyword) && (order.dealerPhone.includes(keyword) || (digits.length > 0 && order.dealerPhone.includes(digits)));
    return (orderFilter === "全部" || order.status === orderFilter)
      && (customerType === "全部" || order.type === customerType)
      && (!keyword || order.no.includes(keyword) || order.dealer.includes(keyword) || matchesPhone);
  }), [customerType, orderFilter, orders, search]);

  const editorCustomer = editorCustomerSnapshot ?? customers.find((customer) => String(customer.id) === editorCustomerId) ?? null;
  const editorCustomerResults = customers.filter((customer) => customer.active);
  const customerProductMatches = useMemo(() => {
    if (!editorCustomer) return [];
    const branch = (editorCustomer.branchName || "").trim().toLowerCase();
    return products.filter((product) => {
      const typeMatches = editorCustomer.customerType === "ALL" || product.customerType === "ALL" || product.customerType === editorCustomer.customerType;
      const branchMatches = product.branchScope.length === 0 || product.branchScope.some((value) => value.trim().toLowerCase() === branch);
      return product.orderable && product.casePrice != null && typeMatches && branchMatches;
    });
  }, [editorCustomer, products]);
  const editorProducts = useMemo(() => {
    const keyword = editorProductSearch.trim().toLowerCase();
    return customerProductMatches.filter((product) => !keyword || product.materialName.toLowerCase().includes(keyword) || (product.materialCode || "").toLowerCase().includes(keyword));
  }, [customerProductMatches, editorProductSearch]);
  const existingProductIds = useMemo(() => new Set(editorExistingItems.map((item) => item.productId).filter((id): id is number => id != null)), [editorExistingItems]);
  const editorAddedProducts = useMemo(() => customerProductMatches.filter((product) => !existingProductIds.has(product.id) && (editorQuantities[product.id] || 0) > 0), [customerProductMatches, editorQuantities, existingProductIds]);
  const editorAddProducts = useMemo(() => editorProducts.filter((product) => !existingProductIds.has(product.id) && !(editorQuantities[product.id] > 0)), [editorProducts, editorQuantities, existingProductIds]);
  const editorItems = useMemo(() => Object.entries(editorQuantities)
    .map(([productId, quantity]) => ({ productId: Number(productId), quantity: Math.floor(Number(quantity)) }))
    .filter((item) => item.quantity > 0), [editorQuantities]);
  const editorTotalQuantity = useMemo(() => editorItems.reduce((total, item) => total + item.quantity, 0), [editorItems]);
  const editorEstimatedAmount = useMemo(() => {
    if (editorItems.length === 0) return 0;
    let total = 0;
    for (const item of editorItems) {
      const product = products.find((candidate) => candidate.id === item.productId);
      const snapshot = editorExistingItems.find((candidate) => candidate.productId === item.productId);
      const pricedProduct = product ?? snapshot;
      if (!pricedProduct) return null;
      const amount = estimateLineAmount(pricedProduct, item.quantity);
      if (amount == null) return null;
      total += amount;
    }
    return total;
  }, [editorExistingItems, editorItems, products]);

  useEffect(() => {
    if (editorMode !== "create") return;
    const keyword = editorCustomerSearch.trim();
    if (!keyword) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setCustomerSearchBusy(true);
      try {
        const rows = await searchAdminCustomers(activityId, keyword);
        if (active) setCustomers(rows.filter((customer) => customer.active));
      } catch (reason) {
        if (active) {
          setCustomers([]);
          setLoadError(editorErrorMessage(reason, "客户搜索失败，请稍后重试"));
        }
      } finally {
        if (active) setCustomerSearchBusy(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activityId, editorCustomerSearch, editorMode]);

  useEffect(() => {
    if (!editorMode || !editorCustomer || editorItems.length === 0) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setEditorPreviewBusy(true);
      try {
        const preview = await previewAdminOrder(activityId, editorCustomer.id, editorItems);
        if (active) { setEditorPreview(preview); setEditorPreviewBusy(false); setEditorError(""); }
      } catch (reason) {
        if (active) { setEditorPreview(null); setEditorPreviewBusy(false); setEditorError(editorErrorMessage(reason, "订单试算失败，请检查商品和客户范围")); }
      }
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [activityId, editorCustomer, editorItems, editorMode]);

  const openOrder = async (order: OrderRecord) => {
    setSelectedNo(order.no);
    setExpandedVersion(null);
    if (!order.id) return;
    try {
      const detail = toOrderRecord(await loadAdminOrder(activityId, order.id));
      setOrders((current) => current.map((item) => item.no === order.no ? detail : item));
    } catch (reason) {
      setLoadError(reason instanceof ApiError ? reason.message : "订单详情加载失败");
    }
  };

  const loadEditorResources = async (activityCustomerId?: number) => {
    const productRows = await loadAdminProducts(activityId, activityCustomerId ? { activityCustomerId } : {});
    setProducts(productRows);
    return { productRows };
  };

  const openCreateEditor = async () => {
    setEditorBusy(true); setEditorError("");
    try {
      await loadEditorResources();
      setEditorMode("create"); setEditorOrder(null); setEditorCustomerId(""); setEditorCustomerSnapshot(null); setCustomers([]); setEditorCustomerSearch(""); setCustomerSearchBusy(false);
      setEditorQuantities({}); setEditorExistingItems([]);
      setEditorProductSearch(""); setEditorReason(""); setEditorPreview(null); setEditorPreviewBusy(false);
    } catch (reason) {
      setLoadError(editorErrorMessage(reason, "订单编辑数据加载失败"));
    } finally { setEditorBusy(false); }
  };

  const openAdjustEditor = async (order: OrderRecord) => {
    if (!order.id) return;
    setEditorBusy(true); setEditorError("");
    try {
      const detail = await loadAdminOrder(activityId, order.id);
      await loadEditorResources(detail.activityCustomerId);
      const record = toOrderRecord(detail);
      const quantities = Object.fromEntries((detail.items || []).filter((item) => item.productId).map((item) => [item.productId, Number(item.quantity)]));
      setEditorMode("adjust"); setEditorOrder(record); setEditorCustomerId(String(detail.activityCustomerId)); setEditorCustomerSnapshot(editorCustomerFromOrder(detail)); setCustomers([]); setEditorCustomerSearch(""); setCustomerSearchBusy(false);
      setEditorExistingItems(record.items);
      setEditorQuantities(quantities); setEditorProductSearch(""); setEditorReason(""); setEditorPreview(null); setEditorPreviewBusy(false);
      setOrders((current) => current.map((item) => item.no === record.no ? record : item));
    } catch (reason) {
      setLoadError(editorErrorMessage(reason, "订单编辑数据加载失败"));
    } finally { setEditorBusy(false); }
  };

  const closeEditor = () => {
    if (editorBusy) return;
    setEditorMode(null); setEditorOrder(null); setEditorCustomerId(""); setEditorCustomerSnapshot(null); setEditorCustomerSearch(""); setEditorExistingItems([]);
    setEditorError(""); setEditorPreview(null); setEditorPreviewBusy(false);
  };

  const setEditorQuantity = (productId: number, value: number) => {
    const quantity = Math.min(999999, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0));
    setEditorQuantities((current) => ({ ...current, [productId]: quantity }));
    setEditorPreview(null); setEditorPreviewBusy(false);
    setEditorError("");
  };

  const saveEditor = async () => {
    if (!editorCustomer || editorItems.length === 0 || !editorReason.trim() || !editorPreview || editorPreviewBusy) return;
    setEditorBusy(true); setEditorError("");
    try {
      const saved = editorMode === "create"
        ? await createAdminOrder(activityId, editorCustomer.id, editorItems, editorReason.trim())
        : await adjustAdminOrder(activityId, editorOrder!.id!, editorOrder!.currentVersion, editorOrder!.lockVersion, editorItems, editorReason.trim());
      const record = toOrderRecord(saved);
      setOrders((current) => {
        const exists = current.some((item) => item.id === record.id);
        return exists ? current.map((item) => item.id === record.id ? record : item) : [record, ...current];
      });
      setSelectedNo(record.no); setReloadKey((value) => value + 1); setEditorMode(null); setEditorOrder(null);
    } catch (reason) {
      setEditorError(editorErrorMessage(reason, "订单保存失败，请稍后重试"));
    } finally { setEditorBusy(false); }
  };

  const voidSelected = async () => {
    if (!selected?.id || selected.status === "已作废") return;
    const reason = window.prompt("请输入作废原因");
    if (!reason?.trim()) return;
    if (!window.confirm(`确认作废订单 ${selected.no}？订单历史会保留。`)) return;
    setEditorBusy(true);
    try {
      const saved = await voidAdminOrder(activityId, selected.id, selected.currentVersion, selected.lockVersion, reason.trim());
      const record = toOrderRecord(saved);
      setOrders((current) => current.map((item) => item.id === record.id ? record : item));
      setReloadKey((value) => value + 1);
    } catch (reasonValue) {
      setLoadError(reasonValue instanceof ApiError ? reasonValue.message : "订单作废失败");
    } finally { setEditorBusy(false); }
  };


  const exportOrders = () => exportAdminOrders(activityId, {
    status: orderFilter === "已提交" ? "SUBMITTED" : orderFilter === "已撤回" ? "WITHDRAWN" : orderFilter === "已作废" ? "VOIDED" : undefined,
    customerType: customerType === "综合" ? "GENERAL" : customerType === "特渠" ? "SPECIAL" : customerType === "不区分客户类型" ? "ALL" : undefined,
    keyword: search,
  }, activityName);


  const operationRecords = selected?.operationRecords ?? [];
  const editorAmountLabel = editorPreview
    ? formatMoney(editorPreview.totalAmount)
    : editorTotalQuantity === 0
      ? "¥0.00"
      : editorEstimatedAmount != null
        ? `约 ${formatMoney(editorEstimatedAmount)}`
      : editorPreviewBusy
        ? "试算中…"
        : editorError
          ? "试算失败"
          : "待试算";
  const editorTonsLabel = editorPreview
    ? editorPreview.totalTons == null ? "—" : Number(editorPreview.totalTons).toFixed(3)
    : editorTotalQuantity === 0 ? "—" : editorPreviewBusy ? "试算中…" : "待试算";

  return (
    <div className="admin-panel order-management-panel">
      <div className="panel-title"><div><h2>订单管理</h2><p>查看并维护订单商品、金额、版本和操作记录</p></div><div className="panel-actions"><button type="button" disabled={editorBusy || !activityStarted} onClick={() => void openCreateEditor()}>＋ 新增订单</button><button className="admin-primary" onClick={() => void exportOrders()}>导出订单</button></div></div>
      {!activityStarted && <div className="activity-closed-banner"><b>正式订单尚未开放</b><span>活动开始后，后台才可新增、调整或作废订单。</span></div>}
      {activityClosed && <div className="activity-closed-banner"><b>客户订货已截止</b><span>客户只能查看订单，后台管理员仍可新增、调整和作废订单。</span></div>}
      {loadError && <div className="warning-box"><b>订单数据加载失败</b><span>{loadError}</span></div>}
      <div className="filter-row">
        {([["全部", `全部 ${orderCounts.all}`], ["已提交", `已提交 ${orderCounts.submitted}`], ["已撤回", `已撤回 ${orderCounts.withdrawn}`], ["已作废", `已作废 ${orderCounts.voided}`]] as const).map(([value, label]) => <button key={value} className={orderFilter === value ? "active" : ""} onClick={() => { setOrderFilter(value); setPage(1); }}>{label}</button>)}
        <label className="order-type-filter"><span>客户类型</span><select value={customerType} onChange={(event) => { setCustomerType(event.target.value as typeof customerType); setPage(1); }}><option>全部</option><option>综合</option><option>特渠</option><option>不区分客户类型</option></select></label>
        <input placeholder="搜索订单号、经销商名称或手机号（完整号码/后四位）" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
      </div>
      <div className="data-table order-table">
        <div className="table-row table-head">{["订单编号", "经销商", "经销商电话", "类型", "来源", "金额", "创建时间", "最后修改", "状态 / 客户权限"].map((label) => <b key={label}>{label}</b>)}</div>
        {filteredOrders.map((order) => <button className="table-row clickable-row" key={order.no} onClick={() => void openOrder(order)}><span>{order.no}</span><span>{order.dealer}</span><span>{order.dealerPhone}</span><span>{order.type}</span><span>{order.source}</span><span>{order.amount}</span><span>{order.createdAt}</span><span>{order.updatedAt}</span><span className={`status-cell ${order.status === "已撤回" ? "withdrawn" : order.status === "已作废" ? "voided" : ""}`}><b>{order.status}</b><small>{activityClosed ? "客户只读" : order.permission}</small></span></button>)}
        {filteredOrders.length === 0 && <div className="order-empty-row">{loading ? "正在加载订单…" : "没有符合条件的订单"}</div>}
      </div>
      <div className="order-pagination"><span>第 {page} / {totalPages} 页 · 每页最多 50 张</span><div><button disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button></div></div>
      {selected && <div className="order-drawer-backdrop" onClick={() => { setSelectedNo(null); setExpandedVersion(null); }}><aside className="order-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>订单详情 · {selected.status}</span><h2>{selected.no}</h2></div><button onClick={() => { setSelectedNo(null); setExpandedVersion(null); }}>×</button></header>
        <div className="order-summary-grid">
          <p><span>经销商</span><b>{selected.dealer}</b><small>{selected.company} · {selected.dealerPhone}</small></p><p><span>客户类型</span><b>{selected.type}</b><small>{selected.status}</small></p><p><span>订单来源</span><b>{selected.source}</b><small>当前 V{selected.currentVersion}</small></p><p><span>订货箱数</span><b>{selected.boxes} 箱</b><small>{selected.tons} 吨</small></p><p><span>订单金额</span><b className="red">{selected.amount}</b><small>含税经销价</small></p><p><span>创建 / 首次提交</span><b>{selected.createdAt}</b><small>{selected.submittedAt}</small></p><p><span>最后修改 / 客户权限</span><b>{selected.updatedAt}</b><small>{activityClosed ? "客户只读" : selected.permission}</small></p>
          {selected.status === "已撤回" && <p><span>撤回时间</span><b>{selected.withdrawnAt}</b><small>{selected.withdrawReason} · 明细和订单号保留</small></p>}
          {selected.status === "已作废" && <p><span>作废时间</span><b>{selected.voidedAt}</b><small>{selected.voidedReason} · 明细和订单号保留</small></p>}
        </div>
        <section className="drawer-section"><h3>商品明细 <small>当前成交明细</small></h3><div className="drawer-items order-snapshot-items">{selected.items.map((item) => <article key={`${selected.no}-${item.materialCode}`}><div className="order-item-primary"><span><small>产品线</small>{item.line}</span><span><small>物料代码</small>{item.materialCode}</span><b><small>物料名称</small>{item.materialName}</b><span><small>规格</small>{item.spec}</span><span><small>箱规</small>{item.casePack}</span><em><small>{item.pricingMode === "INCREMENTAL" ? "分段计价" : "成交元/箱"}</small>{item.pricingMode === "INCREMENTAL" ? <>{item.basePriceQuantity ?? 0}箱×¥{item.baseCasePrice}；{item.tierPriceQuantity ?? 0}箱×¥{item.tierCasePrice}<small>第 {item.tierMinQuantity} 箱起超出部分优惠</small></> : <>¥{item.casePrice}{item.appliedTierMinQuantity && <small>满 {item.appliedTierMinQuantity} 箱整批优惠</small>}</>}</em><span><small>订货箱数</small>{item.quantity} 箱</span><strong><small>金额</small>¥{item.subtotal}</strong></div></article>)}</div><p className="order-snapshot-note">商品价格随当前活动商品价格自动更新。</p></section>
        <section className="drawer-section"><h3>版本记录 <small>共 {selected.versions.length} 个版本</small></h3><div className="order-version-list">{selected.versions.map((version) => { const current = false; return <div className="order-version-record" key={`${selected.no}-${version.version}`}><div className="order-version-summary"><span>{version.version}</span><div><b>{version.action}{current && <em className="version-current-badge">当前版本</em>}</b><small>{version.at} · {version.operator}</small><p>{version.detail}{version.reason ? ` · ${version.reason}` : ""}</p></div><strong>{version.amount}</strong>{current ? <span className="version-current-note">商品明细见上方</span> : <button type="button" onClick={() => setExpandedVersion(expandedVersion === version.version ? null : version.version)}>{expandedVersion === version.version ? "收起明细" : "查看商品明细"}</button>}</div>{expandedVersion === version.version && !current && <div className="order-version-detail"><div className="order-version-detail-head"><b>{version.version} 商品快照</b><span>{version.items.length} 种商品 · {version.amount}</span></div><div className="order-version-items"><div className="order-version-item-head"><span>产品线</span><span>物料代码</span><b>物料名称</b><span>规格</span><span>箱规</span><span>元/箱</span><span>订货箱数</span><strong>金额</strong></div>{version.items.map((item) => <div className="order-version-item" key={`${version.version}-${item.materialCode}`}><div className="order-version-item-main"><span>{item.line}</span><span>{item.materialCode}</span><b>{item.materialName}</b><span>{item.spec}</span><span>{item.casePack}</span><span>¥{item.casePrice}</span><span>{item.quantity} 箱</span><strong>¥{item.subtotal}</strong></div></div>)}</div></div>}</div>; })}</div></section>
        <section className="drawer-section"><h3>操作记录</h3><div className="order-timeline">{operationRecords.map((record, index) => <p key={`${record.time}-${record.title}-${index}`}><b>{record.time} {record.title}</b><span>{record.detail}</span></p>)}</div></section>
        <footer><button type="button" disabled={!activityStarted} onClick={() => void openAdjustEditor(selected)}>{selected.status === "已作废" || selected.status === "已撤回" ? "调整并恢复订单" : "调整订单"}</button>{selected.status !== "已作废" && <button type="button" className="danger-action" disabled={editorBusy || !activityStarted} onClick={() => void voidSelected()}>作废订单</button>}<button className="admin-primary" onClick={() => setSelectedNo(null)}>关闭详情</button></footer>
      </aside></div>}
      {editorMode && <div className="order-drawer-backdrop" onClick={closeEditor}><aside className="order-drawer order-editor-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>{editorMode === "create" ? "新增订单" : "调整订单"}</span><h2>{editorMode === "create" ? "管理员创建订单" : editorOrder?.no}</h2></div><button type="button" disabled={editorBusy} onClick={closeEditor}>×</button></header>
        <section className="drawer-section order-editor-section">
          {editorMode === "create" && !editorCustomer && <>
            <label><span>搜索客户</span><input autoFocus value={editorCustomerSearch} onChange={(event) => { const value = event.target.value; setEditorCustomerSearch(value); setCustomers([]); setCustomerSearchBusy(Boolean(value.trim())); setEditorError(""); }} placeholder="输入经销商名称、简称、分公司或手机号" /></label>
            <div className="order-editor-customer-results">
              {customerSearchBusy && <p className="order-editor-empty">正在搜索客户…</p>}
              {!customerSearchBusy && !editorCustomerSearch.trim() && <p className="order-editor-empty">请输入经销商名称或手机号开始搜索</p>}
              {!customerSearchBusy && editorCustomerSearch.trim() && editorCustomerResults.map((customer) => <button type="button" key={customer.id} onClick={async () => { setEditorCustomerId(String(customer.id)); setEditorCustomerSnapshot(customer); setEditorCustomerSearch(""); setEditorQuantities({}); setEditorPreview(null); setEditorPreviewBusy(false); setEditorError(""); setEditorBusy(true); try { await loadEditorResources(customer.id); } catch (reason) { setEditorError(editorErrorMessage(reason, "客户商品目录加载失败，请稍后重试")); } finally { setEditorBusy(false); } }}><b>{customer.dealerFullName}</b><span>{customer.dealerShortName || "无简称"} · {customerTypeLabel(customer.customerType)} · {customer.branchName || "未分公司"} · {customer.phone || customer.phoneMasked}</span></button>)}
              {!customerSearchBusy && editorCustomerSearch.trim() && editorCustomerResults.length === 0 && <p className="order-editor-empty">没有找到匹配客户，请换个名称或手机号</p>}
            </div>
          </>}
          {editorCustomer && <div className={`order-editor-customer ${editorMode === "adjust" ? "locked" : ""}`}><div><b>{editorCustomer.dealerFullName}</b><span>{customerTypeLabel(editorCustomer.customerType)} · {editorCustomer.branchName || "未分公司"} · {editorCustomer.phone || editorCustomer.phoneMasked}</span></div>{editorMode === "create" ? <button type="button" disabled={editorBusy} onClick={() => { setEditorCustomerSnapshot(null); setEditorCustomerId(""); setEditorCustomerSearch(""); setCustomers([]); setCustomerSearchBusy(false); setEditorQuantities({}); setEditorPreview(null); setEditorPreviewBusy(false); }}>更换客户</button> : <small>订单客户已锁定，仅调整商品</small>}</div>}
          {editorCustomer && <>
            <label><span>{editorMode === "adjust" ? "添加商品（可选）" : "搜索商品"}</span><input value={editorProductSearch} onChange={(event) => { setEditorProductSearch(event.target.value); setEditorError(""); }} placeholder={editorMode === "adjust" ? "输入商品名称或物料代码后添加" : "输入物料名称或代码"} /></label>
            {editorMode === "adjust" ? <>
              <div className="order-editor-current-items">
                <div className="order-editor-subheading"><b>当前订单商品</b><span>调整箱数，数量为 0 时移除</span></div>
                {editorExistingItems.map((item) => {
                  const productId = item.productId ?? 0;
                  const quantity = editorQuantities[productId] ?? 0;
                  return <article className={quantity === 0 ? "is-removed" : ""} key={`current-${productId}-${item.materialCode}`}><div><b>{item.materialName}</b><span>{item.materialCode} · {item.line} · ¥{item.casePrice}/箱</span><small>{quantity === 0 ? "保存后将从新版本移除" : `当前调整数量：${quantity} 箱`}</small></div><div className="order-quantity-control"><button type="button" aria-label="减少箱数" disabled={editorBusy || productId === 0} onClick={() => setEditorQuantity(productId, quantity - 1)}>−</button><input aria-label={`${item.materialName}箱数`} type="number" min="0" max="999999" value={quantity || ""} onChange={(event) => setEditorQuantity(productId, Number(event.target.value))} /><button type="button" aria-label="增加箱数" disabled={editorBusy || productId === 0} onClick={() => setEditorQuantity(productId, quantity + 1)}>＋</button></div></article>;
                })}
                {editorExistingItems.length === 0 && <p className="order-editor-empty">当前版本没有可调整商品</p>}
              </div>
              {editorAddedProducts.length > 0 && <div className="order-editor-current-items order-editor-added-items"><div className="order-editor-subheading"><b>已添加商品</b><span>可继续调整数量</span></div>{editorAddedProducts.map((product) => { const quantity = editorQuantities[product.id] ?? 0; return <article key={`added-${product.id}`}><div><b>{product.materialName}</b><span>{product.materialCode || "无物料代码"} · {product.productLine || "未分类"} · ¥{Number(product.casePrice).toFixed(2)}/箱</span></div><div className="order-quantity-control"><button type="button" aria-label="减少箱数" disabled={editorBusy} onClick={() => setEditorQuantity(product.id, quantity - 1)}>−</button><input aria-label={`${product.materialName}箱数`} type="number" min="0" max="999999" value={quantity || ""} onChange={(event) => setEditorQuantity(product.id, Number(event.target.value))} /><button type="button" aria-label="增加箱数" disabled={editorBusy} onClick={() => setEditorQuantity(product.id, quantity + 1)}>＋</button></div></article>; })}</div>}
              {editorProductSearch.trim() && <div className="order-editor-products order-editor-add-products">{editorAddProducts.map((product) => <article key={product.id}><div><b>{product.materialName}</b><span>{product.materialCode || "无物料代码"} · {product.productLine || "未分类"} · ¥{Number(product.casePrice).toFixed(2)}/箱</span></div><div className="order-quantity-control"><button type="button" aria-label="减少箱数" disabled={editorBusy || !(editorQuantities[product.id] > 0)} onClick={() => setEditorQuantity(product.id, (editorQuantities[product.id] || 0) - 1)}>−</button><input aria-label={`${product.materialName}箱数`} type="number" min="0" max="999999" value={editorQuantities[product.id] || ""} onChange={(event) => setEditorQuantity(product.id, Number(event.target.value))} /><button type="button" aria-label="增加箱数" disabled={editorBusy} onClick={() => setEditorQuantity(product.id, (editorQuantities[product.id] || 0) + 1)}>＋</button></div></article>)}{editorAddProducts.length === 0 && <p className="order-editor-empty">没有找到可添加的商品</p>}</div>}
            </> : <div className="order-editor-products">{editorProducts.map((product) => <article key={product.id}><div><b>{product.materialName}</b><span>{product.materialCode || "无物料代码"} · {product.productLine || "未分类"} · ¥{Number(product.casePrice).toFixed(2)}/箱</span></div><div className="order-quantity-control"><button type="button" aria-label="减少箱数" disabled={editorBusy || !(editorQuantities[product.id] > 0)} onClick={() => setEditorQuantity(product.id, (editorQuantities[product.id] || 0) - 1)}>−</button><input aria-label={`${product.materialName}箱数`} type="number" min="0" max="999999" value={editorQuantities[product.id] || ""} onChange={(event) => setEditorQuantity(product.id, Number(event.target.value))} /><button type="button" aria-label="增加箱数" disabled={editorBusy} onClick={() => setEditorQuantity(product.id, (editorQuantities[product.id] || 0) + 1)}>＋</button></div></article>)}{editorProducts.length === 0 && <p className="order-editor-empty">没有符合当前客户范围的可订商品</p>}</div>}
          </>}
          <label><span>操作原因</span><textarea rows={3} maxLength={500} value={editorReason} onChange={(event) => setEditorReason(event.target.value)} placeholder="请填写客户确认或订单调整原因" /></label>
          {editorError && <div className="warning-box"><b>{editorPreview ? "订单保存失败" : "订单试算失败"}</b><span>{editorError}</span></div>}
          <div className="order-editor-preview"><p><span>商品种类</span><b>{editorItems.length} 种</b></p><p><span>订货箱数</span><b>{editorTotalQuantity} 箱</b></p><p><span>订单金额</span><b className={!editorPreview ? "pending" : ""}>{editorAmountLabel}</b></p><p><span>订货吨数</span><b className={!editorPreview ? "pending" : ""}>{editorTonsLabel}</b></p></div>
          {editorEstimatedAmount != null && editorTotalQuantity > 0 && !editorPreview && <p className="order-editor-preview-note">金额为当前商品价格估算，保存前以服务器试算结果为准。</p>}
        </section>
        <footer><button type="button" disabled={editorBusy} onClick={closeEditor}>取消</button><button type="button" className="admin-primary" disabled={editorBusy || editorPreviewBusy || !editorCustomer || editorItems.length === 0 || !editorReason.trim() || !editorPreview} onClick={() => void saveEditor()}>{editorBusy ? "正在保存…" : editorMode === "create" ? "创建订单" : "保存并生成新版本"}</button></footer>
      </aside></div>}
    </div>
  );
}
