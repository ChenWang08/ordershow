"use client";

import { useEffect, useRef } from "react";
import type { H5OrderModel } from "./useH5OrderFlow";
import { ProductArt } from "./ProductArt";
import { QuantityInput } from "./QuantityInput";
import { money } from "../shared/utils";
import { priceBreakdown, tierPriceLabel, unitPriceText } from "./h5-domain";

export function H5CatalogPage({ model }: { model: H5OrderModel }) {
  const { activityClosed, setStep, setRebateFilter, line, setLine, search, setSearch, setPreviewProduct, cartOpen, setCartOpen, orderStatus, customerOrderReadOnly, setCancelConfirmOpen, quantities, setQuantities, visibleStep, lineOptions, hasRebateSplit, effectiveRebateFilter, visibleProducts, visibleProductGroups, selectedLineGroups, selected, totalBoxes, totalAmount, importedIdentity, identityLabel, dealerName, displayBranch, displayPhone, changeQty, draftMessage } = model;
  const { catalogSearch } = model;
  const editingDisabled = customerOrderReadOnly || model.pendingSubmission || model.orderNeedsRefresh || model.runtimeBusy;
  const scrollArea = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const savedScroll = useRef<number | null>(null);
  const previousScope = useRef(catalogSearch.scope);
  const activeLine = useRef<HTMLButtonElement>(null);
  const previousResult = useRef(catalogSearch.searchResultKey);
  const changeSearch = (value: string) => {
    if (!search.trim() && value.trim()) savedScroll.current = scrollArea.current?.scrollTop ?? 0;
    setSearch(value);
  };
  useEffect(() => {
    if (previousScope.current !== catalogSearch.scope) {
      savedScroll.current = null;
      previousScope.current = catalogSearch.scope;
    }
    if (visibleStep !== "order" || previousResult.current === catalogSearch.searchResultKey) return;
    previousResult.current = catalogSearch.searchResultKey;
    const container = scrollArea.current;
    if (!container) return;
    if (!catalogSearch.searching) {
      if (savedScroll.current !== null) container.scrollTop = savedScroll.current;
      savedScroll.current = null;
    } else if (toolbar.current) {
      container.scrollTop = Math.max(0, container.scrollTop + toolbar.current.getBoundingClientRect().top - container.getBoundingClientRect().top - 8);
    }
  }, [catalogSearch.scope, catalogSearch.searchResultKey, catalogSearch.searching, visibleStep]);
  useEffect(() => {
    const button = activeLine.current;
    const parent = button?.parentElement;
    if (button && parent) parent.scrollLeft = Math.max(0, button.offsetLeft - parent.offsetLeft - 16);
  }, [line, visibleStep]);
  return <>
          {visibleStep === "order" && (
            <section className="h5-page order-page">
              <header className="order-header">
                <button className="text-btn" onClick={() => setStep(orderStatus === "none" ? "verify" : "submitted")}>‹</button>
                <div><b>订货会</b><span>{identityLabel}</span></div>
                <span aria-hidden="true" />
              </header>
              <div ref={scrollArea} className="order-scroll-area" role="region" aria-label="商品选择" tabIndex={0}>
              <div className="dealer-card">
                <span>已识别经销商</span>
                <b>{dealerName}</b>
                <small>{identityLabel} · {displayBranch || "未标注分公司"} · {importedIdentity?.dealerName || "已验证客户"} · 手机 {displayPhone}</small>
              </div>
              <div className="policy-note"><b>订货提示</b><span>{activityClosed ? "活动已截止，当前订单仅可查看。" : orderStatus === "none" ? "所有商品按箱订购。增加数量或新增商品直接生效，减少、删除商品或取消订货需要审核。" : "增加数量或新增商品直接生效；减少、删除商品或取消订货需审核。已撤回或已作废订单可重新提交恢复。"}</span></div>
              {draftMessage && <div className="h5-draft-status" role="status">{draftMessage}</div>}
              {model.runtimeMessage && <div className="verify-error" role="alert">{model.runtimeMessage}</div>}
              <div ref={toolbar} className="product-toolbar">
                <div className={`segment${hasRebateSplit ? catalogSearch.searching ? " search-segment" : "" : " single"}`} role="tablist" aria-label="商品返利类型">
                  {hasRebateSplit ? <>
                    {catalogSearch.searching && <button role="tab" aria-selected={effectiveRebateFilter === "ALL"} className={effectiveRebateFilter === "ALL" ? "active" : ""} onClick={catalogSearch.showAllSearchResults}>全部结果</button>}
                    <button role="tab" aria-selected={effectiveRebateFilter === "PARTICIPATING"} className={effectiveRebateFilter === "PARTICIPATING" ? "active" : ""} onClick={() => setRebateFilter("PARTICIPATING")}>返利产品</button>
                    <button role="tab" aria-selected={effectiveRebateFilter === "NOT_PARTICIPATING"} className={effectiveRebateFilter === "NOT_PARTICIPATING" ? "active" : ""} onClick={() => setRebateFilter("NOT_PARTICIPATING")}>非返利产品</button>
                  </> : <button role="tab" aria-selected="true" className="active" onClick={() => setRebateFilter("ALL")}>全部商品</button>}
                </div>
                <div className="search-box">⌕<input aria-label="搜索全部商品名称、编码或项目组" placeholder="搜索全部商品名称／编码／项目组" value={search} enterKeyHint="search"
                  onChange={(e) => changeSearch(e.target.value)} onCompositionStart={catalogSearch.startSearchComposition}
                  onCompositionEnd={(e) => catalogSearch.endSearchComposition(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); catalogSearch.submitSearch(); } }} />
                  {search && <button type="button" className="clear-product-search" aria-label="清空商品搜索" onClick={() => changeSearch("")}>×</button>}</div>
              </div>
              <div className="line-tabs">
                {lineOptions.map((item) => (
                  <button key={item} ref={line === item ? activeLine : undefined} aria-pressed={line === item} className={line === item ? "active" : ""} onClick={() => setLine(item)}>{item}</button>
                ))}
              </div>
              {(catalogSearch.searching || catalogSearch.searchPending) && <div className="catalog-search-status" role="status">
                {catalogSearch.searchPending ? "正在搜索…" : `当前：${effectiveRebateFilter === "ALL" ? "全部结果" : effectiveRebateFilter === "PARTICIPATING" ? "返利产品" : "非返利产品"} · ${line}，显示 ${visibleProducts.length} / ${catalogSearch.totalMatches} 件`}
                {!catalogSearch.searchPending && visibleProducts.length < catalogSearch.totalMatches && <button type="button" onClick={catalogSearch.showAllSearchResults}>查看全部结果</button>}
              </div>}
              <div className="product-list" aria-busy={catalogSearch.searchPending}>
                {visibleProductGroups.map((group) => (
                  <section className="product-line-group" key={group.line}>
                  <header className="product-line-heading"><b>{group.line}</b><span>{group.items.length} 种商品</span></header>
                  {group.items.map((product) => (
                  <article className="product-card" key={product.id}>
                  <button type="button" className="product-image product-image-button" aria-label={`查看${product.name}商品详情`} onClick={() => setPreviewProduct(product)}><ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} /></button>
                  <div className="product-info">
                      <h3><button type="button" className="product-name-button" onClick={() => setPreviewProduct(product)}>{product.name}</button></h3>
                      {catalogSearch.searching && <small className="catalog-product-location">{product.rebate === true ? "返利产品" : product.rebate === false ? "非返利产品" : "不区分返利"} · {product.line || "未分类"}</small>}
                      {product.description && <p className="product-description" title={product.description}>{product.description}</p>}
                      <div className="product-action">
                        {product.isOrderable && tierPriceLabel(product, quantities[product.id] || 0) && <small className="product-tier-label">{tierPriceLabel(product, quantities[product.id] || 0)}</small>}
                        <div className="product-price-block"><strong>{product.isOrderable ? <>¥{unitPriceText(priceBreakdown(product, quantities[product.id] || 0).displayPrice)}<small>/箱</small></> : "价格待完善"}</strong></div>
                        <div className="stepper">
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)} disabled={editingDisabled || !product.isOrderable || !quantities[product.id]}>−</button>
                          <QuantityInput label={`${product.name}订货箱数`} disabled={editingDisabled || !product.isOrderable} value={quantities[product.id] || 0} onChange={(value) => setQuantities((old) => ({ ...old, [product.id]: value }))} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)} disabled={editingDisabled || !product.isOrderable}>＋</button>
                        </div>
                      </div>
                    </div>
                  </article>
                  ))}
                  </section>
                ))}
                {visibleProducts.length === 0 && !catalogSearch.searchPending && <div className="empty-state">
                  {catalogSearch.searching ? catalogSearch.totalMatches > 0 ? <>当前分类无匹配商品，其他分类有 {catalogSearch.totalMatches} 件<button type="button" onClick={catalogSearch.showAllSearchResults}>查看全部结果</button></> : <>未找到相关商品<button type="button" onClick={() => changeSearch("")}>清空搜索</button></> : "没有符合条件的商品"}
                </div>}
              </div>
              </div>
              <div className="order-bar">
                <button className="cart-summary" aria-label="查看已选商品明细" disabled={activityClosed || !totalBoxes} onClick={() => setCartOpen(true)}>
                  <span>已选 {selected.length} 种 · {totalBoxes} 箱 <em>查看明细⌃</em></span><b>¥{money(totalAmount)}</b>
                </button>
                <button className="confirm-cart-btn" disabled={editingDisabled || (!totalBoxes && orderStatus === "none")} onClick={() => totalBoxes ? setStep("confirm") : setCancelConfirmOpen(true)}>{totalBoxes || orderStatus === "none" ? "确认订单" : "取消本次订货"}</button>
              </div>
            </section>
          )}

          {visibleStep === "order" && cartOpen && (
            <div className="cart-sheet-layer">
              <button className="cart-sheet-backdrop" aria-label="关闭购物明细" onClick={() => setCartOpen(false)} />
              <section className="cart-sheet" aria-label="已选商品明细">
                <header><div><b>已选商品</b><span>{selected.length} 种 · {totalBoxes} 箱</span></div><button disabled={editingDisabled || !selected.length} onClick={() => setQuantities({})}>清空</button></header>
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
                        <span>¥{unitPriceText(priceBreakdown(product, quantities[product.id]).displayPrice)}/箱{tierPriceLabel(product, quantities[product.id]) ? ` · ${tierPriceLabel(product, quantities[product.id])}` : ""}</span>
                        <strong>小计 ¥{money(priceBreakdown(product, quantities[product.id]).amount)}</strong>
                      </div>
                      <div className="cart-item-actions">
                        <button className="remove-item" disabled={editingDisabled} onClick={() => setQuantities((old) => ({ ...old, [product.id]: 0 }))}>删除</button>
                        <div className="stepper">
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)} disabled={editingDisabled}>−</button>
                          <QuantityInput label={`${product.name}订货箱数`} disabled={editingDisabled} value={quantities[product.id] || 0} onChange={(value) => setQuantities((old) => ({ ...old, [product.id]: value }))} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)} disabled={editingDisabled}>＋</button>
                        </div>
                      </div>
                    </article>
                    ))}
                    </section>
                  ))}
                  {!selected.length && <div className="cart-empty">还没有选择商品</div>}
                </div>
                <footer><div><span>合计</span><b>¥{money(totalAmount)}</b><small>共 {totalBoxes} 箱</small></div><button disabled={editingDisabled || (!totalBoxes && orderStatus === "none")} onClick={() => { setCartOpen(false); if (totalBoxes) setStep("confirm"); else setCancelConfirmOpen(true); }}>{totalBoxes || orderStatus === "none" ? "去确认订单" : "取消本次订货"}</button></footer>
              </section>
            </div>
          )}

  </>;
}
