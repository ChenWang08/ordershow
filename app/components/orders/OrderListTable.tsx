"use client";

import type { OrderManagementModel } from "./OrderManagement";

export function OrderListTable({ model }: { model: OrderManagementModel }) {
  const { activityClosed, loading, page, setPage, totalPages, filteredOrders, openOrder } = model;
  return <>
      <div className="data-table order-table">
        <div className="table-row table-head">{["订单编号", "经销商", "经销商电话", "类型", "来源", "金额", "创建时间", "最后修改", "状态 / 客户权限"].map((label) => <b key={label}>{label}</b>)}</div>
        {filteredOrders.map((order) => <button className="table-row clickable-row" key={order.no} onClick={() => void openOrder(order)}><span>{order.no}</span><span>{order.dealer}</span><span>{order.dealerPhone}</span><span>{order.type}</span><span>{order.source}</span><span>{order.amount}</span><span>{order.createdAt}</span><span>{order.updatedAt}</span><span className={`status-cell ${order.status === "已撤回" ? "withdrawn" : order.status === "已作废" ? "voided" : ""}`}><b>{order.status}</b><small>{activityClosed ? "客户只读" : order.permission}</small></span></button>)}
        {filteredOrders.length === 0 && <div className="order-empty-row">{loading ? "正在加载订单…" : "没有符合条件的订单"}</div>}
      </div>
      <div className="order-pagination"><span>第 {page} / {totalPages} 页 · 每页最多 50 张</span><div><button disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button disabled={page >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button></div></div>
  </>;
}
