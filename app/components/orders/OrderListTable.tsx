"use client";

import type { OrderManagementModel } from "./OrderManagement";
import { OrderPagination } from "./OrderPagination";

export function OrderListTable({ model }: { model: OrderManagementModel }) {
  const { activityClosed, loading, page, setPage, totalPages, filteredOrders, openOrder } = model;
  return <>
      <div className="data-table order-table">
        <div className="table-row table-head">{["订单编号", "经销商", "经销商电话", "类型", "来源", "金额", "创建时间", "最后修改", "状态 / 客户权限"].map((label) => <b key={label}>{label}</b>)}</div>
        {filteredOrders.map((order) => <button className="table-row clickable-row" key={order.no} onClick={() => void openOrder(order)}><span>{order.no}</span><span>{order.dealer}</span><span>{order.dealerPhone}</span><span>{order.type}</span><span>{order.source}</span><span>{order.amount}</span><span>{order.createdAt}</span><span>{order.updatedAt}</span><span className={`status-cell ${order.status === "已撤回" ? "withdrawn" : order.status === "已作废" ? "voided" : ""}`}><b>{order.status}</b>{order.pendingChangeRequestId != null && <span className="review-link" role="button" tabIndex={0} onClick={e=>{e.stopPropagation();void model.changeRequests.open(order.pendingChangeRequestId!);}} onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();e.stopPropagation();void model.changeRequests.open(order.pendingChangeRequestId!);}}}>变更审核中</span>}<small>{activityClosed ? "客户只读" : order.permission}</small></span></button>)}
        {filteredOrders.length === 0 && <div className="order-empty-row">{loading ? "正在加载订单…" : "没有符合条件的订单"}</div>}
      </div>
      <OrderPagination page={page} totalPages={totalPages} total={model.total} loading={loading} onPage={setPage} />
  </>;
}
