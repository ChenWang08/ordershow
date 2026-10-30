"use client";

import { formatBeijingTime } from "../shared/time";


import { useState } from "react";
import type { H5OrderModel } from "./useH5OrderFlow";
import { ProductArt } from "./ProductArt";
import { money } from "../shared/utils";
import { groupByProductLine } from "./h5-domain";
import { H5OrderRefresh } from "./H5OrderRefresh";

export function H5SubmittedPage({ model }: { model: H5OrderModel }) {
  const [formalRequestId, setFormalRequestId] = useState<number | null>(null);
  const { pendingChangeRequest: request, runtimeOrder: order, activityClosed, orderStatus, customerOrderReadOnly } = model;
  const pending = request?.status === "PENDING";
  const rejected = request?.status === "REJECTED";
  const showingRequest = pending && request.requestType === "MODIFY" && formalRequestId !== request.id;
  const items = showingRequest ? request.items : order?.items ?? [];
  const groups = groupByProductLine(items, item => item.productLine?.trim() || "未分类");
  const amount = showingRequest ? request.requestedTotalAmount : order?.totalAmount;
  const boxes = showingRequest ? request.requestedTotalQuantity : order?.totalQuantity;
  const state = pending ? `${request.requestType === "WITHDRAW" ? "撤回" : "修改"}申请待审核`
    : rejected ? "申请已驳回" : orderStatus === "withdrawn" ? "订单已撤回" : orderStatus === "voided" ? "订单已作废" : "订货已成功提交";
  const note = pending ? (showingRequest ? "以下为最新申请内容，审核通过后生效。" : request.requestType === "WITHDRAW" ? "撤回申请正在审核，以下保留原订单明细，审核通过后才撤回。" : "以下为当前生效订单，待审核申请尚未生效。")
    : rejected ? `驳回原因：${request.reviewReason || "请联系管理员确认"}。以下为当前正式订单。`
    : orderStatus === "withdrawn" ? "商品明细和订单号已保留，当前订单不计入有效订货。"
    : orderStatus === "voided" ? "订单已由管理员作废，当前不计入有效订货；订货截止前可重新提交，直接恢复并沿用原订单号。" : "以下为当前生效订单。";
  if (model.visibleStep !== "submitted") return null;
  return <section className="h5-page submitted-page">
    <header className="simple-header"><button disabled={model.runtimeBusy} onClick={() => model.setStep("verify")}>‹</button><b>我的订单</b><span /></header>
    {model.runtimeMessage && <div className="verify-error" role="alert">{model.runtimeMessage}</div>}
    <div className={`submitted-state-card ${rejected || orderStatus === "withdrawn" || orderStatus === "voided" ? "withdrawn" : ""}`}>
      <span className="submitted-status">{pending ? "待审核" : rejected ? "已驳回" : orderStatus === "withdrawn" ? "已撤回" : orderStatus === "voided" ? "已作废" : "已提交"}</span>
      <h2>{state}</h2><p>{note}</p>
    </div>
    <H5OrderRefresh model={model} />
    {model.draftMessage && <div className="h5-draft-status" role="status">{model.draftMessage}</div>}
    {pending && request.requestType === "MODIFY" && <button className="ghost-btn" style={{marginBottom:16,width:"100%"}} onClick={() => setFormalRequestId(showingRequest ? request.id : null)}>
      {showingRequest ? `查看${orderStatus === "withdrawn" ? "已撤回" : "当前生效"}订单 V${order?.currentVersion}` : "查看待审核申请"}
    </button>}
    <div className="submitted-meta">
      <p><span>订单编号</span><b>{order?.orderNo || "—"}</b></p>
      {pending && <p><span>申请时间</span><b>{formatBeijingTime(request.requestedAt)}</b></p>}
      {!pending && <p><span>最后修改时间</span><b>{model.orderUpdatedAt}</b></p>}
      <p><span>{orderStatus === "submitted" ? "当前生效版本" : "当前订单版本"}</span><b>V{order?.currentVersion ?? model.orderVersion}</b></p>
      {request && <p><span>申请状态</span><b>{pending ? "待审核" : "已驳回"}</b></p>}
      <p><span>经销商</span><b>{model.dealerName}</b></p>
    </div>
    <div className="confirm-list submitted-list">{groups.map(group => <section className="submitted-line-group" key={group.line}>
      <header className="order-line-group-heading"><b>{group.line}</b><span>{group.items.length} 种 · {group.items.reduce((sum,i)=>sum+i.quantity,0)} 箱</span></header>
      {group.items.map(item => {
        const product = model.catalog.find(p=>p.id===String(item.productId));
        return <div key={item.productId}>
          <ProductArt atlas={product?.atlas ?? 0} imageUrl={product?.imageUrl} alt={item.materialName}/>
          <p>{product ? <button type="button" className="order-product-name-button" onClick={()=>model.setPreviewProduct(product)}>{item.materialName}</button> : <span>{item.materialName}</span>}<small className="product-line-label">项目组：{group.line}</small>
            <span>{item.casePrice == null ? "—" : `¥${money(Number(item.casePrice))}/箱`} · 小计 {item.lineAmount == null ? "—" : `¥${money(Number(item.lineAmount))}`}</span>
          </p><strong>× {item.quantity}</strong>
        </div>;
      })}
    </section>)}</div>
    <div className="summary-card">
      <p className="grand-total"><span>{showingRequest ? "申请总金额" : "订单总金额"}</span><b>{amount == null ? "—" : `¥${money(Number(amount))}`}</b></p>
      {groups.map(group=><p className="line-amount-row" key={group.line}><span>项目组：{group.line}</span><b>¥{money(group.items.reduce((sum,i)=>sum+Number(i.lineAmount ?? 0),0))}</b></p>)}
      <p><span>{showingRequest ? "申请数量" : "订货数量"}</span><b>{boxes ?? 0} 箱 · {items.length} 种商品</b></p>
    </div>
    {activityClosed && <div className="submitted-note">订货已截止，不能新增或修改申请；截止前已提交的申请仍可由后台审核。</div>}
    {model.orderEvents.length > 0 && <section className="submitted-events"><h3>操作记录</h3>{model.orderEvents.map((event,index)=><p key={index}><b>{event.time} {event.title}</b><span>{event.detail}</span></p>)}</section>}
    <div className="submitted-actions">
      {!customerOrderReadOnly && <button className="primary-btn" disabled={model.runtimeBusy || model.pendingSubmission || model.orderNeedsRefresh} onClick={() => void model.startEditingOrder()}>{model.runtimeBusy ? "正在核对最新订单…" : orderStatus === "withdrawn" || orderStatus === "voided" ? "重新订货" : pending ? "继续修改订单" : "修改订单"}</button>}
      <button className="ghost-btn" disabled={model.runtimeBusy} onClick={()=>void model.resetEntry()}>返回活动首页</button>
    </div>
  </section>;
}
