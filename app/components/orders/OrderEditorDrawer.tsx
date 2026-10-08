"use client";

import type { OrderManagementModel } from "./OrderManagement";
import { customerTypeLabel } from "./order-domain";
import { OrderQuantityControl } from "./OrderQuantityControl";

export function OrderEditorDrawer({ model }: { model: OrderManagementModel }) {
  const { setEditingQuantityId, changeEditorCustomer, editorMode, editorOrder, setCustomers, editorCustomerSearch, setEditorCustomerSearch, customerSearchBusy, setCustomerSearchBusy, editorQuantities, editorExistingItems, editorProductSearch, setEditorProductSearch, editorReason, setEditorReason, editorPreview, editorPreviewBusy, editorBusy, editorError, setEditorError, editorCustomer, editorCustomerResults, editorProducts, editorAddedProducts, editorAddProducts, editorItems, editorTotalQuantity, editorEstimatedAmount, closeEditor, setEditorQuantity, saveEditor, selectEditorCustomer, editorAmountLabel, editorTonsLabel } = model;
  const quantityControl = (id: number, name: string) => <OrderQuantityControl name={name} quantity={editorQuantities[id] ?? 0} disabled={editorBusy || id === 0} onChange={(quantity) => setEditorQuantity(id, quantity)} onEditing={(editing) => setEditingQuantityId(editing ? id : null)} />;
  const addedProductsSection = <div className="order-editor-current-items order-editor-added-items"><div className="order-editor-subheading"><b>已添加商品 · {editorAddedProducts.filter(product => editorQuantities[product.id] > 0).length} 种</b><span>修改箱数，数量为 0 时移除</span></div><div className="order-editor-selected-list">{editorAddedProducts.map(product => <article key={product.id}><div><b>{product.materialName}</b><span>{product.materialCode || "无物料代码"} · {product.productLine || "未分类"} · ¥{Number(product.casePrice).toFixed(2)}/箱</span></div>{quantityControl(product.id, product.materialName)}</article>)}</div>{editorAddedProducts.length === 0 && <p className="order-editor-empty">在下方商品列表填写数量，即可添加商品</p>}</div>;
  return <>
      {editorMode && <div className="order-drawer-backdrop"><aside className="order-drawer order-editor-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>{editorMode === "create" ? "新增订单" : "调整订单"}</span><h2>{editorMode === "create" ? "管理员创建订单" : editorOrder?.no}</h2></div><button type="button" disabled={editorBusy} onClick={closeEditor}>×</button></header>
        <section className="drawer-section order-editor-section">
          {editorMode === "create" && !editorCustomer && <>
            <label><span>搜索客户</span><input autoFocus disabled={editorBusy} value={editorCustomerSearch} onChange={(event) => { const value = event.target.value; setEditorCustomerSearch(value); setCustomers([]); setCustomerSearchBusy(Boolean(value.trim())); setEditorError(""); }} placeholder="输入经销商名称、简称、分公司或手机号" /></label>
            <div className="order-editor-customer-results">
              {customerSearchBusy && <p className="order-editor-empty">正在搜索客户…</p>}
              {!customerSearchBusy && !editorCustomerSearch.trim() && <p className="order-editor-empty">请输入经销商名称或手机号开始搜索</p>}
              {!customerSearchBusy && editorCustomerSearch.trim() && editorCustomerResults.map((customer) => <button type="button" disabled={editorBusy} key={customer.id} onClick={() => void selectEditorCustomer(customer)}><b>{customer.dealerFullName}</b><span>{customer.dealerShortName || "无简称"} · {customerTypeLabel(customer.customerType)} · {customer.branchName || "未分公司"} · {customer.phone || customer.phoneMasked}</span></button>)}
              {!customerSearchBusy && editorCustomerSearch.trim() && editorCustomerResults.length === 0 && <p className="order-editor-empty">没有找到匹配客户，请换个名称或手机号</p>}
            </div>
          </>}
          {editorCustomer && <div className={`order-editor-customer ${editorMode === "adjust" ? "locked" : ""}`}><div><b>{editorCustomer.dealerFullName}</b><span>{customerTypeLabel(editorCustomer.customerType)} · {editorCustomer.branchName || "未分公司"} · {editorCustomer.phone || editorCustomer.phoneMasked}</span></div>{editorMode === "create" ? <button type="button" disabled={editorBusy} onClick={changeEditorCustomer}>更换客户</button> : <small>订单客户已锁定，仅调整商品</small>}</div>}
          {editorCustomer && <>
            {editorMode === "adjust" ? <>
              <div className="order-editor-current-items">
                <div className="order-editor-subheading"><b>当前订单商品</b><span>调整箱数，数量为 0 时移除</span></div>
                <div className="order-editor-selected-list">{editorExistingItems.map((item) => {
                  const productId = item.productId ?? 0;
                  const quantity = editorQuantities[productId] ?? 0;
                  return <article className={quantity === 0 ? "is-removed" : ""} key={`current-${productId}-${item.materialCode}`}><div><b>{item.materialName}</b><span>{item.materialCode} · {item.line} · ¥{item.casePrice}/箱</span><small>{quantity === 0 ? "保存后将从新版本移除" : `当前调整数量：${quantity} 箱`}</small></div>{quantityControl(productId, item.materialName)}</article>;
                })}</div>
                {editorExistingItems.length === 0 && <p className="order-editor-empty">当前版本没有可调整商品</p>}
              </div>
              {addedProductsSection}
              <label><span>搜索并添加商品</span><input disabled={editorBusy} value={editorProductSearch} onChange={(event) => { setEditorProductSearch(event.target.value); setEditorError(""); }} placeholder="输入商品名称或物料代码，填写数量即可添加" /></label>
              {editorProductSearch.trim() && <div className="order-editor-products order-editor-add-products">{editorAddProducts.map((product) => <article key={product.id}><div><b>{product.materialName}</b><span>{product.materialCode || "无物料代码"} · {product.productLine || "未分类"} · ¥{Number(product.casePrice).toFixed(2)}/箱</span>{editorQuantities[product.id] > 0 && <small className="order-product-selected">已添加 · {editorQuantities[product.id]} 箱</small>}</div>{quantityControl(product.id, product.materialName)}</article>)}{editorAddProducts.length === 0 && <p className="order-editor-empty">没有找到可添加的商品</p>}</div>}
            </> : <>{addedProductsSection}<label><span>搜索并添加商品</span><input disabled={editorBusy} value={editorProductSearch} onChange={(event) => { setEditorProductSearch(event.target.value); setEditorError(""); }} placeholder="输入商品名称或物料代码，填写数量即可添加" /></label><div className="order-editor-products">{editorProducts.map((product) => <article key={product.id}><div><b>{product.materialName}</b><span>{product.materialCode || "无物料代码"} · {product.productLine || "未分类"} · ¥{Number(product.casePrice).toFixed(2)}/箱</span>{editorQuantities[product.id] > 0 && <small className="order-product-selected">已添加 · {editorQuantities[product.id]} 箱</small>}</div>{quantityControl(product.id, product.materialName)}</article>)}{editorProducts.length === 0 && <p className="order-editor-empty">没有符合当前客户范围的可订商品</p>}</div></>}
          </>}
          <label><span>操作原因</span><textarea disabled={editorBusy} rows={3} maxLength={500} value={editorReason} onChange={(event) => setEditorReason(event.target.value)} placeholder="请填写客户确认或订单调整原因" /></label>
          {editorError && <div className="warning-box"><b>{editorPreview ? "订单保存失败" : "订单试算失败"}</b><span>{editorError}</span></div>}
          <div className="order-editor-preview"><p><span>商品种类</span><b>{editorItems.length} 种</b></p><p><span>订货箱数</span><b>{editorTotalQuantity} 箱</b></p><p><span>订单金额</span><b className={!editorPreview ? "pending" : ""}>{editorAmountLabel}</b></p><p><span>订货吨数</span><b className={!editorPreview ? "pending" : ""}>{editorTonsLabel}</b></p></div>
          {editorEstimatedAmount != null && editorTotalQuantity > 0 && !editorPreview && <p className="order-editor-preview-note">金额为当前商品价格估算，保存前以服务器试算结果为准。</p>}
        </section>
        <footer><button type="button" disabled={editorBusy} onClick={closeEditor}>取消</button><button type="button" className="admin-primary" disabled={editorBusy || editorPreviewBusy || !editorCustomer || editorItems.length === 0 || !editorReason.trim() || !editorPreview} onClick={() => void saveEditor()}>{editorBusy ? "正在保存…" : editorMode === "create" ? "创建订单" : "保存并生成新版本"}</button></footer>
      </aside></div>}
  </>;
}
