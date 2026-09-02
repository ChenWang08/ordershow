"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  exportAdminOrders,
  loadAdminOrder,
  loadAdminOrders,
  type AdminOrderSummary,
  type RuntimeOrder,
} from "../../api";

type OrderStatus = "已提交" | "已撤回";
type CustomerType = "特渠" | "综合";

type OrderVersionItem = {
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

type OrderVersion = {
  version: string;
  action: string;
  at: string;
  amount: string;
  detail: string;
  operator: string;
  items: OrderVersionItem[];
};

type OrderRecord = {
  id?: number;
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
  versions: OrderVersion[];
  permission: "可修改" | "可重新提交";
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

function maskPhone(phone: string) {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function toOrderRecord(order: AdminOrderSummary | RuntimeOrder): OrderRecord {
  const detail = order as RuntimeOrder;
  const customerType: CustomerType = order.customerType === "SPECIAL" ? "特渠" : "综合";
  const versions: OrderVersion[] = [...(detail.versions ?? [])]
    .sort((left, right) => left.version - right.version)
    .map((version) => ({
      version: `V${version.version}`,
      action: version.version === 1 ? "首次提交" : "修改后提交",
      at: formatDate(version.submittedAt),
      amount: formatMoney(version.totalAmount),
      detail: `${version.totalQuantity} 箱 · ${version.items?.length ?? 0} 种商品`,
      operator: "经销商手机端",
      items: (version.items ?? []).map((item) => ({
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
  };
  return {
    id: order.id,
    no: order.orderNo,
    dealer: order.dealerFullName,
    dealerPhone: order.phoneMasked,
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
    versions,
    permission: order.status === "WITHDRAWN" ? "可重新提交" : "可修改",
    status: order.status === "WITHDRAWN" ? "已撤回" : "已提交",
    operationRecords: (detail.operations ?? []).map((operation) => ({
      time: formatDate(operation.occurredAt),
      title: operationLabels[operation.type] || operation.type,
      detail: `${operation.source === "H5" ? "经销商手机端" : operation.source}${operation.orderVersion ? ` · V${operation.orderVersion}` : ""}${operation.reason ? ` · ${operation.reason}` : ""}`,
    })),
  };
}

export function OrderManagement({ activityClosed, activityId, activityName }: { activityClosed: boolean; activityId: number; activityName: string }) {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [orderCounts, setOrderCounts] = useState({ all: 0, submitted: 0, withdrawn: 0 });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [orderFilter, setOrderFilter] = useState<"全部" | OrderStatus>("全部");
  const [customerType, setCustomerType] = useState<"全部" | CustomerType>("全部");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedNo, setSelectedNo] = useState<string | null>(null);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const selected = orders.find((order) => order.no === selectedNo) ?? null;

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const status = orderFilter === "已提交" ? "SUBMITTED" : orderFilter === "已撤回" ? "WITHDRAWN" : undefined;
        const runtimeCustomerType = customerType === "综合" ? "GENERAL" : customerType === "特渠" ? "SPECIAL" : undefined;
        const [current, all, submitted, withdrawn] = await Promise.all([
          loadAdminOrders(activityId, { status, customerType: runtimeCustomerType, keyword: search, page, size: 50 }),
          loadAdminOrders(activityId, { page: 1, size: 1 }),
          loadAdminOrders(activityId, { status: "SUBMITTED", page: 1, size: 1 }),
          loadAdminOrders(activityId, { status: "WITHDRAWN", page: 1, size: 1 }),
        ]);
        if (!active) return;
        setOrders(current.data.map(toOrderRecord));
        setTotalPages(Math.max(1, current.page.totalPages));
        setOrderCounts({ all: all.page.totalElements, submitted: submitted.page.totalElements, withdrawn: withdrawn.page.totalElements });
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
  }, [activityId, customerType, orderFilter, page, search]);

  const filteredOrders = useMemo(() => orders.filter((order) => {
    const keyword = search.trim();
    const digits = keyword.replace(/\D/g, "");
    const matchesPhone = Boolean(keyword) && (order.dealerPhone.includes(keyword) || (digits.length > 0 && order.dealerPhone.includes(digits)));
    return (orderFilter === "全部" || order.status === orderFilter)
      && (customerType === "全部" || order.type === customerType)
      && (!keyword || order.no.includes(keyword) || order.dealer.includes(keyword) || matchesPhone);
  }), [customerType, orderFilter, orders, search]);

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

  const exportOrders = () => exportAdminOrders(activityId, {
    status: orderFilter === "已提交" ? "SUBMITTED" : orderFilter === "已撤回" ? "WITHDRAWN" : undefined,
    customerType: customerType === "综合" ? "GENERAL" : customerType === "特渠" ? "SPECIAL" : undefined,
    keyword: search,
  }, activityName);

  const currentVersion = selected?.versions.at(-1) ?? null;
  const currentVersionId = currentVersion?.version;
  const operationRecords = selected?.operationRecords ?? [];

  return (
    <div className="admin-panel order-management-panel">
      <div className="panel-title"><div><h2>订单管理</h2><p>后台只读查看商品明细、金额、版本和操作记录</p></div><button className="admin-primary" onClick={() => void exportOrders()}>导出订单</button></div>
      {activityClosed && <div className="activity-closed-banner"><b>活动已截止</b><span>所有订单进入只读状态，当前仅可查看商品明细和版本记录。</span></div>}
      {loadError && <div className="warning-box"><b>订单数据加载失败</b><span>{loadError}</span></div>}
      <div className="filter-row">
        {([["全部", `全部 ${orderCounts.all}`], ["已提交", `已提交 ${orderCounts.submitted}`], ["已撤回", `已撤回 ${orderCounts.withdrawn}`]] as const).map(([value, label]) => <button key={value} className={orderFilter === value ? "active" : ""} onClick={() => { setOrderFilter(value); setPage(1); }}>{label}</button>)}
        <label className="order-type-filter"><span>客户类型</span><select value={customerType} onChange={(event) => { setCustomerType(event.target.value as typeof customerType); setPage(1); }}><option>全部</option><option>综合</option><option>特渠</option></select></label>
        <input placeholder="搜索订单号、经销商名称或手机号后四位" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
      </div>
      <div className="data-table order-table">
        <div className="table-row table-head">{["订单编号", "经销商", "经销商电话", "类型", "金额", "创建时间", "最后修改", "状态 / 客户权限"].map((label) => <b key={label}>{label}</b>)}</div>
        {filteredOrders.map((order) => <button className="table-row clickable-row" key={order.no} onClick={() => void openOrder(order)}><span>{order.no}</span><span>{order.dealer}</span><span>{maskPhone(order.dealerPhone)}</span><span>{order.type}</span><span>{order.amount}</span><span>{order.createdAt}</span><span>{order.updatedAt}</span><span className={`status-cell ${order.status === "已撤回" ? "withdrawn" : ""}`}><b>{order.status}</b><small>{activityClosed ? "已截止" : order.permission}</small></span></button>)}
        {filteredOrders.length === 0 && <div className="order-empty-row">{loading ? "正在加载订单…" : "没有符合条件的订单"}</div>}
      </div>
      <div className="order-pagination"><span>第 {page} / {totalPages} 页 · 每页最多 50 张</span><div><button disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button></div></div>
      {selected && <div className="order-drawer-backdrop" onClick={() => { setSelectedNo(null); setExpandedVersion(null); }}><aside className="order-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>订单详情 · {selected.status}</span><h2>{selected.no}</h2></div><button onClick={() => { setSelectedNo(null); setExpandedVersion(null); }}>×</button></header>
        <div className="order-summary-grid">
          <p><span>经销商</span><b>{selected.dealer}</b><small>{selected.company} · {maskPhone(selected.dealerPhone)}</small></p><p><span>客户类型</span><b>{selected.type}</b><small>{selected.status}</small></p><p><span>订货箱数</span><b>{selected.boxes} 箱</b><small>{selected.tons} 吨</small></p><p><span>订单金额</span><b className="red">{selected.amount}</b><small>含税经销价</small></p><p><span>创建 / 首次提交</span><b>{selected.createdAt}</b><small>{selected.submittedAt}</small></p><p><span>最后修改 / 编辑权限</span><b>{selected.updatedAt}</b><small>{activityClosed ? "已截止" : selected.permission}</small></p>
          {selected.status === "已撤回" && <p><span>撤回时间</span><b>{selected.withdrawnAt}</b><small>{selected.withdrawReason} · 明细和订单号保留</small></p>}
        </div>
        <section className="drawer-section"><h3>商品明细 <small>{currentVersion?.version} 商品快照</small></h3><div className="drawer-items order-snapshot-items">{currentVersion?.items.map((item) => <article key={`${selected.no}-${item.materialCode}`}><div className="order-item-primary"><span><small>产品线</small>{item.line}</span><span><small>物料代码</small>{item.materialCode}</span><b><small>物料名称</small>{item.materialName}</b><span><small>规格</small>{item.spec}</span><span><small>箱规</small>{item.casePack}</span><em><small>{item.pricingMode === "INCREMENTAL" ? "分段计价" : "成交元/箱"}</small>{item.pricingMode === "INCREMENTAL" ? <>{item.basePriceQuantity ?? 0}箱×¥{item.baseCasePrice}；{item.tierPriceQuantity ?? 0}箱×¥{item.tierCasePrice}<small>第 {item.tierMinQuantity} 箱起超出部分优惠</small></> : <>¥{item.casePrice}{item.appliedTierMinQuantity && <small>满 {item.appliedTierMinQuantity} 箱整批优惠</small>}</>}</em><span><small>订货箱数</small>{item.quantity} 箱</span><strong><small>金额</small>¥{item.subtotal}</strong></div></article>)}</div><p className="order-snapshot-note">商品明细为 {currentVersion?.version} 提交时的价格快照；历史金额不随商品调价变化。</p></section>
        <section className="drawer-section"><h3>版本记录 <small>共 {selected.versions.length} 个版本</small></h3><div className="order-version-list">{selected.versions.map((version) => { const current = version.version === currentVersionId; return <div className="order-version-record" key={`${selected.no}-${version.version}`}><div className="order-version-summary"><span>{version.version}</span><div><b>{version.action}{current && <em className="version-current-badge">当前版本</em>}</b><small>{version.at} · {version.operator}</small><p>{version.detail}</p></div><strong>{version.amount}</strong>{current ? <span className="version-current-note">商品明细见上方</span> : <button type="button" onClick={() => setExpandedVersion(expandedVersion === version.version ? null : version.version)}>{expandedVersion === version.version ? "收起明细" : "查看商品明细"}</button>}</div>{expandedVersion === version.version && !current && <div className="order-version-detail"><div className="order-version-detail-head"><b>{version.version} 商品快照</b><span>{version.items.length} 种商品 · {version.amount}</span></div><div className="order-version-items"><div className="order-version-item-head"><span>产品线</span><span>物料代码</span><b>物料名称</b><span>规格</span><span>箱规</span><span>元/箱</span><span>订货箱数</span><strong>金额</strong></div>{version.items.map((item) => <div className="order-version-item" key={`${version.version}-${item.materialCode}`}><div className="order-version-item-main"><span>{item.line}</span><span>{item.materialCode}</span><b>{item.materialName}</b><span>{item.spec}</span><span>{item.casePack}</span><span>¥{item.casePrice}</span><span>{item.quantity} 箱</span><strong>¥{item.subtotal}</strong></div></div>)}</div></div>}</div>; })}</div></section>
        <section className="drawer-section"><h3>操作记录</h3><div className="order-timeline">{operationRecords.map((record, index) => <p key={`${record.time}-${record.title}-${index}`}><b>{record.time} {record.title}</b><span>{record.detail}</span></p>)}</div></section>
        <footer><button className="admin-primary" onClick={() => setSelectedNo(null)}>关闭详情</button></footer>
      </aside></div>}
    </div>
  );
}
