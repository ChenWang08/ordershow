"use client";

import type { H5OrderModel } from "./useH5OrderFlow";
import { ProductArt } from "./ProductArt";
import { money } from "../shared/utils";
import { priceBreakdown, tierPriceLabel, unitPriceText } from "./h5-domain";

export function H5ConfirmPage({ model }: { model: H5OrderModel }) {
  const { requiresReview, pendingSubmission, runtimeBusy, runtimeMessage, orderNeedsRefresh, setStep, setPreviewProduct, orderStatus, customerOrderReadOnly, quantities, visibleStep, selectedLineGroups, selectedLineSummaries, totalAmount, identityBranch, identityLabel, dealerName, submitOrder, reloadLatestOrder } = model;
  return <>
          {visibleStep === "confirm" && (
            <section className="h5-page confirm-page">
              <header className="simple-header"><button onClick={() => setStep("order")}>‹</button><b>确认订单</b><span /></header>
              <div className="confirm-hero"><span>请核对订货信息</span><h2>{dealerName}</h2><small>{identityLabel}{identityBranch ? ` · ${identityBranch}` : ""}</small></div>
              <div className="confirm-list">
                {selectedLineGroups.map((group) => (
                  <section className="confirm-line-group" key={group.line}>
                  <header className="order-line-group-heading"><b>{group.line}</b><span>{group.items.length} 种 · {group.items.reduce((sum, item) => sum + item.quantity, 0)} 箱</span></header>
                  {group.items.map(({ product, quantity }) => (
                  <div key={product.id}>
                    <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
                    <p><button type="button" className="order-product-name-button" onClick={() => setPreviewProduct(product)}>{product.name}</button><small className="product-line-label">项目组：{group.line}</small><span>¥{unitPriceText(priceBreakdown(product, quantities[product.id]).displayPrice)}/箱{tierPriceLabel(product, quantities[product.id]) ? ` · ${tierPriceLabel(product, quantities[product.id])}` : ""}</span></p>
                    <strong>× {quantity}</strong>
                  </div>
                  ))}
                  </section>
                ))}
              </div>
              <div className="summary-card">
                <p className="grand-total"><span>订单总金额</span><b>¥{money(totalAmount)}</b></p>
                {selectedLineSummaries.map((summary) => <p className="line-amount-row" key={summary.line}><span>项目组：{summary.line}</span><b>¥{money(summary.amount)}</b></p>)}
              </div>
              {requiresReview && <div className="submitted-note">本次包含商品减量或删除，整次变更需后台审核；审核通过前原订单仍有效。</div>}
              <label className="agreement"><input type="checkbox" defaultChecked /> 我已核对商品与订货数量</label>
              {orderNeedsRefresh && <button disabled={runtimeBusy} onClick={reloadLatestOrder}>加载最新订单并重新核对（放弃本次未提交修改）</button>}
              {runtimeMessage && <div className="verify-error" role="alert">{runtimeMessage}</div>}
              <button className="submit-order" disabled={customerOrderReadOnly || runtimeBusy} onClick={() => void submitOrder()}>{runtimeBusy ? "正在提交…" : pendingSubmission ? "确认上次提交结果" : requiresReview ? "提交变更审核" : orderStatus === "none" ? "确认提交订单" : orderStatus === "withdrawn" || orderStatus === "voided" ? "重新提交并恢复订单" : "确认提交"}</button>
            </section>
          )}

  </>;
}
