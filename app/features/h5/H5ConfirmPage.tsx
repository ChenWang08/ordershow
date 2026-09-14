"use client";

import type { H5OrderModel } from "./useH5OrderFlow";
import { ProductArt } from "./ProductArt";
import { money } from "../shared/utils";
import { priceBreakdown, tierPriceLabel } from "./h5-domain";

export function H5ConfirmPage({ model }: { model: H5OrderModel }) {
  const { runtimeBusy, runtimeMessage, orderNeedsRefresh, setStep, setPreviewProduct, orderStatus, customerOrderReadOnly, quantities, visibleStep, selected, totalAmount, identityBranch, identityLabel, dealerName, submitOrder, reloadLatestOrder } = model;
  return <>
          {visibleStep === "confirm" && (
            <section className="h5-page confirm-page">
              <header className="simple-header"><button onClick={() => setStep("order")}>‹</button><b>确认订单</b><span /></header>
              <div className="confirm-hero"><span>请核对订货信息</span><h2>{dealerName}</h2><small>{identityLabel}{identityBranch ? ` · ${identityBranch}` : ""}</small></div>
              <div className="confirm-list">
                {selected.map((product) => (
                  <div key={product.id}>
                    <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
                    <p><button type="button" className="order-product-name-button" onClick={() => setPreviewProduct(product)}>{product.name}</button><span>¥{money(priceBreakdown(product, quantities[product.id]).displayPrice)}/箱{tierPriceLabel(product, quantities[product.id]) ? ` · ${tierPriceLabel(product, quantities[product.id])}` : ""}</span></p>
                    <strong>× {quantities[product.id]}</strong>
                  </div>
                ))}
              </div>
              <div className="summary-card">
                <p className="grand-total"><span>订单总金额</span><b>¥{money(totalAmount)}</b></p>
              </div>
              <label className="agreement"><input type="checkbox" defaultChecked /> 我已核对商品与订货数量</label>
              {orderNeedsRefresh && <button disabled={runtimeBusy} onClick={reloadLatestOrder}>加载最新订单并重新核对（放弃本次未提交修改）</button>}
              {runtimeMessage && <div className="verify-error" role="alert">{runtimeMessage}</div>}
              <button className="submit-order" disabled={customerOrderReadOnly || runtimeBusy} onClick={() => void submitOrder()}>{runtimeBusy ? "正在提交…" : orderStatus === "none" ? "确认提交订单" : orderStatus === "withdrawn" ? "重新提交订单" : "确认修改并提交"}</button>
            </section>
          )}

  </>;
}
