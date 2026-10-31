"use client";

import type { OrderManagementModel } from "./OrderManagement";

export function OrderFilterBar({ model }: { model: OrderManagementModel }) {
  const { activityStarted, activityClosed, orderCounts, loadError, orderFilter, setOrderFilter, customerType, setCustomerType, search, setSearch, setPage, exportOrders, editorBusy, openCreateEditor } = model;
  return <>
      <div className="panel-title"><div><h2>订单管理</h2><p>查看并维护订单商品、金额、版本和操作记录</p></div><div className="panel-actions"><button type="button" disabled={model.loading} onClick={model.refreshOrders}>{model.loading ? "正在读取…" : "刷新订单"}</button><button type="button" disabled={editorBusy || !activityStarted} onClick={() => void openCreateEditor()}>＋ 新增订单</button><button className="admin-primary" onClick={() => void exportOrders()}>导出订单</button></div></div>
      {!activityStarted && <div className="activity-closed-banner"><b>正式订单尚未开放</b><span>活动开始后，后台才可新增、调整或作废订单。</span></div>}
      {activityClosed && <div className="activity-closed-banner"><b>客户订货已截止</b><span>客户只能查看订单，后台管理员仍可新增、调整和作废订单。</span></div>}
      {loadError && <div className="warning-box"><b>订单数据加载失败</b><span>{loadError}</span></div>}
      <div className="filter-row">
        {([["全部", `全部 ${orderCounts.all}`], ["已提交", `已提交 ${orderCounts.submitted}`], ["已撤回", `已撤回 ${orderCounts.withdrawn}`], ["已作废", `已作废 ${orderCounts.voided}`]] as const).map(([value, label]) => <button key={value} className={orderFilter === value ? "active" : ""} onClick={() => { setOrderFilter(value); setPage(1); }}>{label}</button>)}
        <label className="order-type-filter"><span>客户类型</span><select value={customerType} onChange={(event) => { setCustomerType(event.target.value as typeof customerType); setPage(1); }}><option>全部</option><option>综合</option><option>特渠</option><option>不区分客户类型</option></select></label>
        <input placeholder="搜索订单号、经销商名称或手机号（完整号码/后四位）" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
      </div>
  </>;
}
