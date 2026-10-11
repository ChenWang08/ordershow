"use client";

import type { H5OrderModel } from "./useH5OrderFlow";
import { ProductArt } from "./ProductArt";
import { QuantityInput } from "./QuantityInput";
import { money } from "../shared/utils";
import { priceBreakdown, tierPriceLabel } from "./h5-domain";

export function H5CatalogPage({ model }: { model: H5OrderModel }) {
  const { activityClosed, setStep, setRebateFilter, line, setLine, search, setSearch, setPreviewProduct, cartOpen, setCartOpen, orderStatus, customerOrderReadOnly, setCancelConfirmOpen, quantities, setQuantities, visibleStep, lineOptions, hasRebateSplit, effectiveRebateFilter, visibleProducts, visibleProductGroups, selectedLineGroups, selected, totalBoxes, totalAmount, importedIdentity, identityLabel, dealerName, displayBranch, displayPhone, changeQty, draftMessage } = model;
  return <>
          {visibleStep === "order" && (
            <section className="h5-page order-page">
              <header className="order-header">
                <button className="text-btn" onClick={() => setStep(orderStatus === "none" ? "verify" : "submitted")}>‹</button>
                <div><b>订货会</b><span>{identityLabel}</span></div>
                <span aria-hidden="true" />
              </header>
              <div className="order-scroll-area" role="region" aria-label="商品选择" tabIndex={0}>
              <div className="dealer-card">
                <span>已识别经销商</span>
                <b>{dealerName}</b>
                <small>{identityLabel} · {displayBranch || "未标注分公司"} · {importedIdentity?.dealerName || "已验证客户"} · 手机 {displayPhone}</small>
              </div>
              <div className="policy-note"><b>订货提示</b><span>{activityClosed ? "活动已截止，当前订单仅可查看。" : orderStatus === "none" ? "所有商品按箱订购。增加数量或新增商品直接生效，减少、删除商品或取消订货需要审核。" : "增加数量或新增商品直接生效；减少、删除商品或取消订货需审核。已撤回或已作废订单可重新提交恢复。"}</span></div>
              {draftMessage && <div className="h5-draft-status" role="status">{draftMessage}</div>}
              <div className="product-toolbar">
                <div className={`segment${hasRebateSplit ? "" : " single"}`} role="tablist" aria-label="商品返利类型">
                  {hasRebateSplit ? <>
                    <button role="tab" aria-selected={effectiveRebateFilter === "PARTICIPATING"} className={effectiveRebateFilter === "PARTICIPATING" ? "active" : ""} onClick={() => setRebateFilter("PARTICIPATING")}>返利产品</button>
                    <button role="tab" aria-selected={effectiveRebateFilter === "NOT_PARTICIPATING"} className={effectiveRebateFilter === "NOT_PARTICIPATING" ? "active" : ""} onClick={() => setRebateFilter("NOT_PARTICIPATING")}>非返利产品</button>
                  </> : <button role="tab" aria-selected="true" className="active" onClick={() => setRebateFilter("ALL")}>全部商品</button>}
                </div>
                <label className="search-box">⌕<input placeholder="搜索商品" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
              </div>
              <div className="line-tabs">
                {lineOptions.map((item) => (
                  <button key={item} className={line === item ? "active" : ""} onClick={() => setLine(item)}>{item}</button>
                ))}
              </div>
              <div className="product-list">
                {visibleProductGroups.map((group) => (
                  <section className="product-line-group" key={group.line}>
                  <header className="product-line-heading"><b>{group.line}</b><span>{group.items.length} 种商品</span></header>
                  {group.items.map((product) => (
                  <article className="product-card" key={product.id}>
                  <button type="button" className="product-image product-image-button" aria-label={`查看${product.name}商品详情`} onClick={() => setPreviewProduct(product)}><ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} /></button>
                  <div className="product-info">
                      <h3><button type="button" className="product-name-button" onClick={() => setPreviewProduct(product)}>{product.name}</button></h3>
                      {product.description && <p className="product-description" title={product.description}>{product.description}</p>}
                      <div className="product-action">
                        <div className="product-price-block"><strong>{product.isOrderable ? <>¥{money(priceBreakdown(product, quantities[product.id] || 0).displayPrice)}<small>/箱</small></> : "价格待完善"}</strong>{product.isOrderable && tierPriceLabel(product, quantities[product.id] || 0) && <small>{tierPriceLabel(product, quantities[product.id] || 0)}</small>}</div>
                        <div className="stepper">
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)} disabled={activityClosed || !product.isOrderable || !quantities[product.id]}>−</button>
                          <QuantityInput label={`${product.name}订货箱数`} disabled={activityClosed} value={quantities[product.id] || 0} onChange={(value) => setQuantities((old) => ({ ...old, [product.id]: value }))} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)} disabled={activityClosed || !product.isOrderable}>＋</button>
                        </div>
                      </div>
                    </div>
                  </article>
                  ))}
                  </section>
                ))}
                {visibleProducts.length === 0 && <div className="empty-state">没有符合条件的商品</div>}
              </div>
              </div>
              <div className="order-bar">
                <button className="cart-summary" aria-label="查看已选商品明细" disabled={activityClosed || !totalBoxes} onClick={() => setCartOpen(true)}>
                  <span>已选 {selected.length} 种 · {totalBoxes} 箱 <em>查看明细⌃</em></span><b>¥{money(totalAmount)}</b>
                </button>
                <button className="confirm-cart-btn" disabled={customerOrderReadOnly || (!totalBoxes && orderStatus === "none")} onClick={() => totalBoxes ? setStep("confirm") : setCancelConfirmOpen(true)}>{totalBoxes || orderStatus === "none" ? "确认订单" : "取消本次订货"}</button>
              </div>
            </section>
          )}

          {visibleStep === "order" && cartOpen && (
            <div className="cart-sheet-layer">
              <button className="cart-sheet-backdrop" aria-label="关闭购物明细" onClick={() => setCartOpen(false)} />
              <section className="cart-sheet" aria-label="已选商品明细">
                <header><div><b>已选商品</b><span>{selected.length} 种 · {totalBoxes} 箱</span></div><button disabled={!selected.length} onClick={() => setQuantities({})}>清空</button></header>
                <div className="cart-sheet-list">
                  {selectedLineGroups.map((group) => (
                    <section className="cart-line-group" key={group.line}>
                    <header className="order-line-group-heading"><b>{group.line}</b><span>{group.items.reduce((sum, item) => sum + item.quantity, 0)} 箱</span></header>
                    {group.items.map(({ product }) => (
                    <article key={product.id}>
                      <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
                      <div className="cart-item-info">
                        <button type="button" className="cart-item-name-button" onClick={() => setPreviewProduct(product)}>{product.name}</button>
                        <small className="product-line-label">项目组：{group.line}</small>
                        <span>¥{money(priceBreakdown(product, quantities[product.id]).displayPrice)}/箱{tierPriceLabel(product, quantities[product.id]) ? ` · ${tierPriceLabel(product, quantities[product.id])}` : ""}</span>
                        <strong>小计 ¥{money(priceBreakdown(product, quantities[product.id]).amount)}</strong>
                      </div>
                      <div className="cart-item-actions">
                        <button className="remove-item" disabled={activityClosed} onClick={() => setQuantities((old) => ({ ...old, [product.id]: 0 }))}>删除</button>
                        <div className="stepper">
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)} disabled={activityClosed}>−</button>
                          <QuantityInput label={`${product.name}订货箱数`} disabled={activityClosed} value={quantities[product.id] || 0} onChange={(value) => setQuantities((old) => ({ ...old, [product.id]: value }))} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)} disabled={activityClosed}>＋</button>
                        </div>
                      </div>
                    </article>
                    ))}
                    </section>
                  ))}
                  {!selected.length && <div className="cart-empty">还没有选择商品</div>}
                </div>
                <footer><div><span>合计</span><b>¥{money(totalAmount)}</b><small>共 {totalBoxes} 箱</small></div><button disabled={customerOrderReadOnly || (!totalBoxes && orderStatus === "none")} onClick={() => { setCartOpen(false); if (totalBoxes) setStep("confirm"); else setCancelConfirmOpen(true); }}>{totalBoxes || orderStatus === "none" ? "去确认订单" : "取消本次订货"}</button></footer>
              </section>
            </div>
          )}

  </>;
}
