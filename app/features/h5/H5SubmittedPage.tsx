"use client";

import type { H5OrderModel } from "./useH5OrderFlow";
import { ProductArt } from "./ProductArt";
import { money } from "../shared/utils";
import { priceBreakdown, tierPriceLabel } from "./h5-domain";

export function H5SubmittedPage({ model }: { model: H5OrderModel }) {
  const { activityClosed, runtimeOrder, runtimeMessage, setStep, setPreviewProduct, orderStatus, customerOrderReadOnly, orderVersion, orderUpdatedAt, orderWithdrawnAt, orderEvents, visibleStep, orderViewQuantities, orderViewSelected, orderViewLineGroups, orderViewLineSummaries, orderViewBoxes, orderViewAmount, dealerName, startEditingOrder } = model;
  return <>
          {visibleStep === "submitted" && (
            <section className="h5-page submitted-page">
              {runtimeMessage && <div className="verify-error" role="status">{runtimeMessage}</div>}
              <header className="simple-header"><button onClick={() => setStep("verify")}>‹</button><b>我的订单</b><span /></header>
              <div className={`submitted-state-card ${orderStatus === "withdrawn" || orderStatus === "voided" ? "withdrawn" : ""}`}>
                <span className="submitted-status">{orderStatus === "withdrawn" ? "已撤回" : orderStatus === "voided" ? "已作废" : "已提交"}</span>
                <h2>{orderStatus === "withdrawn" ? "当前订单已撤回" : orderStatus === "voided" ? "当前订单已由管理员作废" : "您的订货已成功提交"}</h2>
                <p>{orderStatus === "withdrawn" ? "商品明细和订单号已保留，截止前可继续订货并重新提交。" : orderStatus === "voided" ? "订单号、商品明细和历史版本已保留。如需恢复，请联系管理员调整订单。" : "订单截止前可修改或取消本次订货，修改后将以最新提交内容为准。"}</p>
              </div>
              <div className="submitted-meta">
                <p><span>订单编号</span><b>{runtimeOrder?.orderNo || "ZYORDER280018"}</b></p>
                <p><span>最后提交时间</span><b>{orderUpdatedAt}</b></p>
                <p><span>当前版本</span><b>V{orderVersion}</b></p>
                <p><span>编辑权限</span><b className={customerOrderReadOnly ? "muted" : ""}>{orderStatus === "voided" ? "仅可查看" : activityClosed ? "已截止" : orderStatus === "withdrawn" ? "可重新提交" : "可修改或取消"}</b></p>
                {orderStatus === "withdrawn" && orderWithdrawnAt && <p><span>取消时间</span><b>{orderWithdrawnAt}</b></p>}
                <p><span>经销商</span><b>{dealerName}</b></p>
              </div>
              <div className="confirm-list submitted-list">
                {orderViewLineGroups.map((group) => (
                  <section className="submitted-line-group" key={group.line}>
                  <header className="order-line-group-heading"><b>{group.line}</b><span>{group.items.length} 种 · {group.items.reduce((sum, item) => sum + item.quantity, 0)} 箱</span></header>
                  {group.items.map(({ product, quantity }) => (
                  <div key={product.id}>
                    <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
                    <p><button type="button" className="order-product-name-button" onClick={() => setPreviewProduct(product)}>{product.name}</button><small className="product-line-label">产线：{group.line}</small><span>¥{money(priceBreakdown(product, orderViewQuantities[product.id]).displayPrice)}/箱{tierPriceLabel(product, orderViewQuantities[product.id]) ? ` · ${tierPriceLabel(product, orderViewQuantities[product.id])}` : ""}</span></p>
                    <strong>× {quantity}</strong>
                  </div>
                  ))}
                  </section>
                ))}
              </div>
              <div className="summary-card">
                <p className="grand-total"><span>订单总金额</span><b>¥{money(runtimeOrder?.totalAmount ?? orderViewAmount)}</b></p>
                {orderViewLineSummaries.map((summary) => <p className="line-amount-row" key={summary.line}><span>产线：{summary.line}</span><b>¥{money(summary.amount)}</b></p>)}
                <p><span>订货数量</span><b>{orderViewBoxes} 箱 · {orderViewSelected.length} 种商品</b></p>
              </div>
              <div className="submitted-note">{orderStatus === "voided" ? "该订单已由管理员作废，不计入有效订单、金额统计和抽奖资格；客户侧仅可查看。" : activityClosed ? "活动已截止，当前订单仅可查看，不能修改、取消或重新提交。" : orderStatus === "withdrawn" ? "该订单当前不计入有效订单、金额统计和抽奖资格；截止前可点击“继续订货”恢复提交。" : "订单状态会同步至管理后台和活动看板；如需调整商品或数量，请点击“修改订单”。"}</div>
              {orderEvents.length > 0 && <section className="submitted-events"><h3>操作记录</h3>{orderEvents.map((event, index) => <p key={`${event.time}-${index}`}><b>{event.time} {event.title}</b><span>{event.detail}</span></p>)}</section>}
              <div className="submitted-actions">
                {!customerOrderReadOnly && (orderStatus === "withdrawn" ? <button className="primary-btn" onClick={startEditingOrder}>继续订货</button> : <button className="primary-btn" onClick={startEditingOrder}>修改订单</button>)}
                <button className="ghost-btn" onClick={() => setStep("channel")}>返回活动首页</button>
              </div>
            </section>
          )}

  </>;
}
