"use client";

import type { ProductImportRow } from "../../domain/import-domain";
import type { ActivityStatus } from "../shared/types";
import { ProductImageUploadCard } from "./products/ProductImageUploadCard";
import { ProductImportTable } from "./products/ProductImportTable";
import type { ImportTaskIds } from "./product-module-types";
import type { useProductImport } from "./useProductImport";
import type { useProductEditor } from "./useProductEditor";

type ProductImportPageProps = {
  activityStatus: ActivityStatus;
  productRows: ProductImportRow[];
  productImportCompleted: boolean;
  serverImportBlocking: ImportTaskIds;
  productImport: ReturnType<typeof useProductImport>;
  productEditor: ReturnType<typeof useProductEditor>;
};

export function ProductImportPage({
  activityStatus, productRows, productImportCompleted, serverImportBlocking, productImport, productEditor,
}: ProductImportPageProps) {
  const activityStarted = activityStatus === "running" || activityStatus === "closed" || activityStatus === "finished";
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityPublished = activityStatus !== "draft";
  const baseDataReadOnly = activityStatus === "scheduled" || activityClosed;
  const { productFileName, productImportError, productImportWarnings, productSheetCounts, productImportInputCount, productImportStats, productImageFileName, productImageStats, resolvedProductImageAssets, productImageError, beginProductImport, cancelProductImport, confirmProductImport, handleProductFile, handleProductImageFile, removeProductImages } = productImport;
  const { openProductForm, setEditingProductRow, deleteProductRows } = productEditor;
  const parsedProductCount = productFileName ? productImportInputCount : 0;
  const removedProductCount = Math.max(0, parsedProductCount - productImportStats.total);
  return (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>{productImportCompleted ? "当前活动商品" : "活动商品导入"}</h2><p>{productImportCompleted ? "当前数据来自最近一次确认的完整 Excel；发布活动后锁定" : "上传完整商品 Excel，浏览器解析后替换当前商品目录"}</p></div><div className="panel-actions"><button className="secondary-button" disabled={baseDataReadOnly || (!productImportCompleted && (!productFileName || Boolean(productImportError)))} onClick={openProductForm}>＋ 手动添加商品</button>{productImportCompleted && <button className="admin-primary" disabled={activityPublished} onClick={beginProductImport}>重新导入 Excel</button>}</div></div>
            {!productImportCompleted && <div className="import-rule-hint"><b>全量替换规则</b><span>{activityPublished ? "活动已发布，商品 Excel 和批量图片导入已锁定；待开始状态可先撤回发布再修改。" : "每次 Excel 与本次 ZIP 构成一套独立批次，不比较上一版本，也不继承上一版本图片。上传只生成预览，点击确认且全部保存成功后，才会整体替换当前商品目录。"}</span></div>}
            {!productImportCompleted && <div className="dual-upload-grid product-import-upload-grid">
              <article className={`file-upload-card ${productFileName && !productImportError ? "ready" : ""}`}>
                <div className="file-card-heading"><span>XL</span><div><b>商品信息 Excel</b><small>统一文件 · 读取 1 个商品 Sheet</small></div><em>{productFileName ? (productImportError ? "解析失败" : "解析完成") : "待上传"}</em></div>
                {productFileName ? <p title={productFileName}>{productFileName}</p> : <p>尚未选择商品 Excel 文件</p>}
                <div className="sheet-tags"><span>Sheet 名称不限</span><span>客户类型：综合 / 特渠 / 空</span><span>是否返利：是 / 否 / 空</span><span>产品说明：可为空</span></div>
                <footer><small>{activityPublished ? "活动已发布，Excel 导入已锁定" : productFileName && !productImportError ? `识别 ${parsedProductCount} 条商品` : "必须包含 1 个非空商品 Sheet"}</small><div>{productFileName && <button type="button" disabled={activityPublished} onClick={cancelProductImport}>移除</button>}<label className={activityPublished ? "disabled" : ""}><input type="file" accept=".xlsx" disabled={activityPublished} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleProductFile(file); event.currentTarget.value = ""; }} />{productFileName ? "替换文件" : "选择文件"}</label></div></footer>
              </article>
              <ProductImageUploadCard fileName={productImageFileName} stats={productImageStats} assets={resolvedProductImageAssets} error={productImageError} disabled={activityPublished || (!productFileName && !productImportCompleted)} disabledMessage={activityPublished ? "活动已发布，批量图片导入已锁定" : undefined} onFile={handleProductImageFile} onRemove={removeProductImages} />
            </div>}
            {!productImportCompleted && productFileName && <div className="import-result"><div className="import-summary"><span className="success-icon">✓</span><p><b>{productImportError ? "文件解析失败" : "Excel 与图片预览完成 · 等待确认替换"}</b><small>{productImportError ? "请修正文件后重新选择" : `Excel 原始 ${parsedProductCount} 条、已移除 ${removedProductCount} 条、待发布 ${productImportStats.total} 条；有效 ${productImportStats.valid} 条、待完善 ${productImportStats.incomplete} 条、待核对 ${productImportStats.review} 条`}</small></p><strong>{productImportStats.total} 条待发布</strong></div>{productImportError && <div className="warning-box"><b>文件无法导入</b><span>{productImportError}</span></div>}{!productImportError && productImportWarnings.length > 0 && <div className="warning-box"><b>导入前检查提示</b>{productImportWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}{!productImportError && <><div className="sheet-counts">{productSheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>)}</div><div className="product-import-stats">{[["待发布商品", productImportStats.total], ["有效", productImportStats.valid], ["待核对", productImportStats.review], ["待完善", productImportStats.incomplete]].map(([label, count]) => <span key={label as string}><b>{count}</b><small>{label}</small></span>)}</div><ProductImportTable rows={productRows} onEdit={setEditingProductRow} readOnly={baseDataReadOnly} allowDelete={!activityPublished} onDelete={deleteProductRows} /><button className="admin-primary wide" disabled={!productImportStats.total || activityPublished || productImportStats.review > 0 || (serverImportBlocking.PRODUCT ?? 0) > 0} onClick={confirmProductImport}>{productImportStats.review > 0 || (serverImportBlocking.PRODUCT ?? 0) > 0 ? `请先处理 ${Math.max(productImportStats.review, serverImportBlocking.PRODUCT ?? 0)} 条待核对商品` : `确认替换当前商品 ${productImportStats.total} 条`}</button></>}</div>}
            {productImportCompleted && <><div className="import-completed-banner"><span className="success-icon">✓</span><p><b>本次商品目录替换完成</b><small>{activityClosed ? "活动已截止，商品数据只读。" : activityStatus === "scheduled" ? "活动已发布，商品已锁定；如需修改请先撤回发布。" : activityStarted ? "活动已开始，Excel 导入已锁定；待确认图片仍可逐个处理。" : "商品已发布；待确认图片保留在当前版本，可在下方逐个选择，确认前 H5 使用占位图。"}</small></p><div><strong>{productRows.length}</strong><small>商品总数</small></div><div><strong>{productRows.filter((row) => row.status === "有效").length}</strong><small>有效</small></div><div><strong>{productRows.filter((row) => row.imageStatus === "待确认").length}</strong><small>图片待确认</small></div><div><strong>{productRows.filter((row) => row.imageStatus === "未匹配").length}</strong><small>图片未匹配</small></div></div><div className="data-section-title"><div><b>当前活动商品</b><span>{productFileName} · 共 {productRows.length} 条 · {activityClosed ? "活动已截止，只读" : activityStatus === "scheduled" ? "活动已发布，只读" : activityStarted ? "活动已锁定，待确认图片可继续处理" : "可编辑、单条/批量删除"}</span></div></div><ProductImportTable rows={productRows} onEdit={setEditingProductRow} readOnly={baseDataReadOnly} allowDelete={!activityPublished} allowDeleteAll={!activityPublished} onDelete={deleteProductRows} /></>}
          </div>
  );
}
