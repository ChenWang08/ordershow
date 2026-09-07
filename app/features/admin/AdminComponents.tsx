"use client";

/* eslint-disable @next/next/no-img-element -- product images are runtime and local preview URLs. */

import { useMemo, useState } from "react";
import type { AdminAttendee, AttendanceMatchPreview } from "../../api";
import { attendanceCustomerType, compareProductRows, compareWhitelistRows, createImportRowId, normalizeWhitelistName, productImportIdentityKey, whitelistIdentityKey, whitelistPhoneIsValid, type AttendanceFieldKey, type AttendanceImportDraft, type AttendanceRow, type DeleteTarget, type ProductImageAsset, type ProductImageStats, type ProductImageStatus, type ProductImportRow, type WhitelistCustomerTypeMode, type WhitelistRow } from "../../domain/import-domain";
import { createManualProductImageAssets, productImageRelationStatus, productImageStatusForAssets } from "../../domain/product-images";
import { ProductImageViewer } from "../shared/components/ProductImageViewer";
import { normalizePhone, normalizeSearchText } from "../shared/utils";
import { normalizeMaterialCode } from "./admin-utils";

export function DeleteConfirmDialog({ target, onCancel, onConfirm }: { target: DeleteTarget; onCancel: () => void; onConfirm: () => void }) {
  const labelPreview = target.labels.slice(0, 3).join("、");
  const extraCount = target.labels.length - 3;
  const countLabel = target.label ?? (target.ids.length === 1 ? target.kind : `${target.ids.length} 条${target.kind}`);
  return (
    <div className="delete-confirm" role="dialog" aria-modal="true" aria-label={`删除${target.kind}确认`} onClick={onCancel}>
      <div onClick={(event) => event.stopPropagation()}>
        <span className="delete-confirm-eyebrow">删除{target.kind}</span>
        <h3>确认删除{countLabel}？</h3>
        <p>{target.description ?? "删除后将从当前活动的可下单或身份验证列表中移除，已有订单不会被删除，订单明细和金额保持不变。"}</p>
        <div className="delete-confirm-items">
          <b>{labelPreview || countLabel}{extraCount > 0 ? ` 等 ${extraCount} 条` : ""}</b>
          <small>{target.summary ?? `已选择 ${target.ids.length} 条`}</small>
        </div>
        <div className="delete-confirm-actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="delete-confirm-danger" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

export function ProductImageEditor({ materialName, images, onChange }: { materialName: string; images?: ProductImageAsset[]; imageStatus?: ProductImageStatus; onChange: (images: ProductImageAsset[] | undefined, status: ProductImageStatus) => void }) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const currentImages = images ?? [];
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError("");
    setUploading(true);
    try {
      const uploadedImages = await createManualProductImageAssets(files.slice(0, 1));
      const nextImages = uploadedImages.slice(0, 1);
      onChange(nextImages, "已匹配");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "图片上传失败，请重新选择。" );
    } finally {
      setUploading(false);
    }
  };
  const removeImage = (id: string) => {
    const nextImages = currentImages.filter((image) => image.id !== id);
    onChange(nextImages.length > 0 ? nextImages : undefined, productImageStatusForAssets(nextImages));
    setPreviewIndex((current) => current === null ? null : Math.min(current, Math.max(0, nextImages.length - 1)));
  };
  const confirmCandidate = (id: string) => {
    const selected = currentImages.find((image) => image.id === id);
    if (!selected) return;
    onChange([{ ...selected, matchStatus: "已匹配", relationStatus: "CONFIRMED" }], "已匹配");
    setPreviewIndex(null);
  };
  return (
    <div className="product-image-editor">
      {currentImages.length > 0 ? <div className="product-image-gallery">
        {currentImages.map((image, index) => { const pending = productImageRelationStatus(image) === "CANDIDATE"; return <div className={`product-image-tile ${!pending && index === 0 ? "primary" : ""} ${pending ? "pending" : ""}`} key={`${image.id}-${index}`}>
          <button type="button" className="product-image-tile-preview" disabled={uploading} onClick={() => setPreviewIndex(index)}>
            <img src={image.url} alt={`${materialName} ${index + 1}`} />
            <span>{pending ? "候选图片" : index === 0 ? "主图" : `第 ${index + 1} 张`}</span>
          </button>
          <div className="product-image-tile-actions">
            {pending && <button type="button" disabled={uploading} onClick={() => confirmCandidate(image.id)}>选择此图</button>}
            <button type="button" className="danger" disabled={uploading} onClick={() => removeImage(image.id)}>{pending ? "排除候选" : "删除"}</button>
          </div>
        </div>; })}
      </div> : <div className="product-image-editor-empty"><i>暂无图片</i><span>可以上传一张商品图片</span></div>}
      <div className="product-image-editor-actions">
        <label className="product-image-upload-button"><input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" disabled={uploading} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void handleFiles(files); }} />{uploading ? "读取中…" : currentImages.length > 0 ? "替换图片" : "上传图片"}</label>
      </div>
      <small className="product-image-editor-hint">{currentImages.length > 1 ? `待确认 ${currentImages.length} 张候选，请选择一张` : currentImages.length === 1 ? (productImageRelationStatus(currentImages[0]) === "CONFIRMED" ? "已匹配 1 张" : "待确认 1 张") : "未匹配"} · 每个商品只保留一张图片 · 不超过 10MB</small>
      {error && <small className="product-image-editor-error">{error}</small>}
      {previewIndex !== null && currentImages.length > 0 && <ProductImageViewer productName={materialName} images={currentImages} initialIndex={previewIndex} status={`${currentImages.length} 张`} onClose={() => setPreviewIndex(null)} />}
    </div>
  );
}

export function ProductImportTable({ rows, onEdit, onDelete, allowDelete = false, allowDeleteAll = false, readOnly = false }: { rows: ProductImportRow[]; onEdit: (row: ProductImportRow) => void; onDelete?: (ids: string[]) => void; allowDelete?: boolean; allowDeleteAll?: boolean; readOnly?: boolean }) {
  const [customerType, setCustomerType] = useState("全部");
  const [rebate, setRebate] = useState("全部");
  const [imageFilter, setImageFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [priceFilter, setPriceFilter] = useState("全部");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [imagePreview, setImagePreview] = useState<{ productName: string; images: ProductImageAsset[]; status: string } | null>(null);
  const heads = ["序号", "客户类型", "是否返利", "产品大类", "产品线", "物料代码", "物料名称", "产品说明", "商品图片", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "每吨箱数（箱/吨）", "是否礼盒", "分公司限制", "状态", "操作"];
  const filteredRows = useMemo(() => {
    const normalizedKeyword = normalizeSearchText(searchKeyword);
    const normalizedCodeKeyword = normalizeMaterialCode(searchKeyword);
    return rows.filter((row) => {
      const matchesImage = imageFilter === "全部"
        || (imageFilter === "已匹配" && row.imageStatus === "已匹配")
        || (imageFilter === "未匹配" && row.imageStatus === "未匹配")
        || (imageFilter === "待确认" && row.imageStatus === "待确认");
      const casePrice = Number(String(row.casePrice ?? "").replace(/[,，￥¥\s]/g, ""));
      const hasValidPrice = Number.isFinite(casePrice) && casePrice > 0;
      const matchesPrice = priceFilter === "全部"
        || (priceFilter === "价格有效" && hasValidPrice)
        || (priceFilter === "价格待完善" && !hasValidPrice);
      const matchesCustomerType = customerType === "全部"
        || (customerType === "未指定" ? row.customerType === "" : row.customerType === customerType);
      const matchesRebate = rebate === "全部"
        || (rebate === "未指定" ? row.rebate === "" : row.rebate === rebate);
      const matchesFilters = matchesCustomerType && matchesRebate
        && (statusFilter === "全部" || row.status === statusFilter) && matchesImage && matchesPrice;
      const matchesSearch = !normalizedKeyword
        || normalizeSearchText(row.materialName).includes(normalizedKeyword)
        || normalizeMaterialCode(row.materialCode).includes(normalizedCodeKeyword);
      return matchesFilters && matchesSearch;
    });
  }, [rows, customerType, rebate, imageFilter, statusFilter, priceFilter, searchKeyword]);
  const imageCounts = useMemo(() => ({
    matched: rows.filter((row) => row.imageStatus === "已匹配").length,
    unmatched: rows.filter((row) => row.imageStatus === "未匹配").length,
    pending: rows.filter((row) => row.imageStatus === "待确认").length,
  }), [rows]);
  const sortedRows = useMemo(() => [...filteredRows].sort(compareProductRows), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const filteredIds = useMemo(() => sortedRows.map((row) => row.id), [sortedRows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const openDelete = (ids: string[]) => {
    const targetRows = rows.filter((row) => ids.includes(row.id));
    setDeleteTarget({ ids, labels: targetRows.map((row) => row.materialName || row.materialCode), kind: "商品" });
  };
  const openClearAll = () => {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;
    setDeleteTarget({
      ids,
      labels: rows.map((row) => row.materialName || row.materialCode),
      kind: "商品",
      label: "全部当前商品",
      description: "将从当前有效商品列表移除全部商品；已有订单不会被删除，订单明细和金额保持不变。",
      summary: `当前共有 ${ids.length} 条商品`,
    });
  };
  const togglePageRows = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return [...next];
    });
  };
  const selectFilteredRows = () => {
    setSelectedIds((current) => [...new Set([...current, ...filteredIds])]);
  };
  const clearFilteredRows = () => {
    setSelectedIds((current) => current.filter((id) => !filteredIds.includes(id)));
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    onDelete?.(deleteTarget.ids);
    setSelectedIds((current) => current.filter((id) => !deleteTarget.ids.includes(id)));
    setDeleteTarget(null);
  };
  return (
    <>
      <div className="data-filters product-data-filters">
        <label><span>客户类型</span><select value={customerType} onChange={(e) => { setCustomerType(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>特渠</option><option>综合</option><option>未指定</option></select></label>
        <label><span>是否参与返利</span><select value={rebate} onChange={(e) => { setRebate(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>参与</option><option>不参与</option><option>未指定</option></select></label>
        <label><span>商品状态</span><select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>有效</option><option>待核对</option><option>待完善</option></select></label>
        <label><span>价格状态</span><select value={priceFilter} onChange={(e) => { setPriceFilter(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>价格有效</option><option>价格待完善</option></select></label>
        <label><span>商品图片</span><select value={imageFilter} onChange={(e) => { setImageFilter(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>已匹配</option><option>待确认</option><option>未匹配</option></select></label>
        <label className="data-filter-search"><span>搜索商品</span><input type="search" value={searchKeyword} onChange={(e) => { setSearchKeyword(e.target.value); setPage(1); setSelectedIds([]); }} placeholder="物料代码 / 物料名称" aria-label="搜索物料代码或物料名称" /></label>
        <small>已匹配 {imageCounts.matched} · 待确认 {imageCounts.pending} · 未匹配 {imageCounts.unmatched}<br />当前显示 {sortedRows.length} 条商品 · 第 {currentPage}/{totalPages} 页{readOnly ? "，活动已截止只读" : allowDelete ? "，可勾选删除" : "，可编辑"}</small>
      </div>
      {allowDelete && allowDeleteAll && rows.length > 0 && <div className="selection-toolbar selection-toolbar-all"><span>当前商品 <b>{rows.length}</b> 条</span><button type="button" className="selection-delete" onClick={openClearAll}>清空当前商品</button></div>}
      {allowDelete && selectedIds.length > 0 && <div className="selection-toolbar"><span>已选择 <b>{selectedIds.length}</b> 条商品{allFilteredSelected ? "（当前筛选结果）" : ""}</span><div>{!allFilteredSelected && filteredIds.length > pageIds.length && <button type="button" className="selection-select-all" onClick={selectFilteredRows}>选择全部 {filteredIds.length} 条</button>}{allFilteredSelected && <button type="button" className="selection-select-all" onClick={clearFilteredRows}>取消全选结果</button>}<button type="button" className="selection-clear" onClick={() => setSelectedIds([])}>取消选择</button><button type="button" className="selection-delete" onClick={() => openDelete(selectedIds)}>删除所选</button></div></div>}
      <div className="table-scroll">
        <div className={`data-table product-import-table ${allowDelete ? "with-selection" : ""}`}>
          <div className="table-row table-head">{allowDelete && <b className="select-cell"><input type="checkbox" aria-label="全选当前页商品" checked={allPageSelected} onChange={togglePageRows} /></b>}{heads.map((x) => <b key={x}>{x}</b>)}</div>
          {pageRows.map((row, index) => {
            const values = [pageStart + index + 1, row.customerType, row.rebate, row.category, row.line, row.materialCode, row.materialName, row.description, null, row.brand, row.variety, row.spec, row.casePack, row.unitPrice, row.casePrice, row.conversion, row.gift, row.branchScope || "全部分公司", row.status];
            const imageStatus = row.imageStatus ?? "未匹配";
            const imageLabel = imageStatus === "待确认"
              ? String(row.images?.length ?? 0)
              : imageStatus === "未匹配"
                ? imageStatus
                : row.images?.length ? `${row.images.length} 张` : "未匹配";
            return <div className={`table-row ${row.manuallyEdited ? "manually-edited-row" : ""}`} key={row.id}>{allowDelete && <span className="select-cell"><input type="checkbox" aria-label={`选择商品 ${row.materialName}`} checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></span>}{values.map((value, index) => index === 8 ? <button type="button" key={index} className={`product-image-cell product-image-button-cell ${imageStatus === "待确认" ? "pending" : row.images?.length ? "matched" : "unmatched"}`} disabled={!row.images?.length} aria-label={`查看${row.materialName}商品图片`} onClick={() => row.images?.length && setImagePreview({ productName: row.materialName, images: row.images, status: imageLabel })}>{row.images?.[0]?.url ? <img src={row.images[0].url} alt={row.materialName} /> : <i>—</i>}<small>{imageLabel}</small></button> : <span key={index} title={index === 7 ? String(value || "") : undefined} className={`${index === 7 ? "description-cell" : ""} ${index === 18 ? `status-cell ${row.status !== "有效" ? "pending" : ""}` : ""}`}>{value || "—"}</span>)}<span className="table-row-actions"><button type="button" disabled={readOnly} onClick={() => onEdit(row)}>编辑</button>{allowDelete && <button type="button" onClick={() => openDelete([row.id])}>删除</button>}{row.manuallyEdited && <small>已修正</small>}</span></div>;
          })}
          {sortedRows.length === 0 && <div className="table-empty">{searchKeyword.trim() ? "当前搜索和筛选条件下没有商品" : "当前筛选条件下没有商品"}</div>}
        </div>
      </div>
      <div className="table-pagination"><span>共 {sortedRows.length} 条</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select>条</label><button type="button" disabled={currentPage <= 1} onClick={() => setPage(1)}>首页</button><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><b>{currentPage} / {totalPages}</b><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>末页</button></div></div>
      {deleteTarget && <DeleteConfirmDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
      {imagePreview && <ProductImageViewer productName={imagePreview.productName} images={imagePreview.images} status={imagePreview.status} onClose={() => setImagePreview(null)} />}
    </>
  );
}

export function ProductImageUploadCard({ fileName, stats, assets, error, disabled = false, disabledMessage = "请先上传商品 Excel", onFile, onRemove }: { fileName: string; stats: ProductImageStats; assets: ProductImageAsset[]; error: string; disabled?: boolean; disabledMessage?: string; onFile: (file: File) => void | Promise<void>; onRemove: () => void }) {
  const ready = Boolean(fileName && !error);
  const reviewAssets = assets.filter((asset) => asset.matchStatus === "待确认" || asset.matchStatus === "未匹配");
  return (
    <article className={`file-upload-card image-upload-card ${ready ? "ready" : ""}`}>
      <div className="file-card-heading"><span>图</span><div><b>商品图片 ZIP</b><small>按商品物料名称匹配图片</small></div><em>{error ? "解析失败" : fileName ? "解析完成" : "待上传"}</em></div>
      {fileName ? <p title={fileName}>{fileName}</p> : <p>请选择：产品图片6月30日-OK(1).zip</p>}
      <div className="image-import-stats"><span>商品<b>{stats.totalProducts}</b></span><span>已匹配<b>{stats.matchedProducts}</b></span><span>待确认<b>{stats.pendingProducts}</b></span><span>未匹配<b>{stats.unmatchedProducts}</b></span></div>
      {reviewAssets.length > 0 && <div className="image-match-review"><b>需要处理的图片</b><div>{reviewAssets.map((asset) => <div className="image-match-review-row" key={asset.id}><img src={asset.url} alt="" /><span title={asset.fileName}>{asset.fileName}</span><em className={asset.matchStatus === "待确认" ? "pending" : "unmatched"}>{asset.matchStatus}</em></div>)}</div></div>}
      {error && <small className="image-upload-error">{error}</small>}
      <footer><small>{disabled ? disabledMessage : ready ? `已预览 ${assets.length} 张图片，确认替换后才会保存` : "支持 JPG、PNG、WEBP、GIF、BMP"}</small><div>{fileName && <button type="button" disabled={disabled} onClick={onRemove}>移除</button>}<label className={disabled ? "disabled" : ""}><input type="file" accept=".zip,application/zip" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.currentTarget.value = ""; }} />{fileName ? "替换 ZIP" : "选择 ZIP"}</label></div></footer>
    </article>
  );
}

export function CustomerWhitelistTable({ rows, onEdit, onDelete, allowDelete = false, allowDeleteAll = false, readOnly = false }: { rows: WhitelistRow[]; onEdit: (row: WhitelistRow) => void; onDelete?: (ids: string[]) => void; allowDelete?: boolean; allowDeleteAll?: boolean; readOnly?: boolean }) {
  const [customerType, setCustomerType] = useState("全部");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const heads = ["序号", "客户类型", "大区", "分公司名称", "经销商名称（简）", "经销商名称（全）", "经销商姓名", "经销商电话", "分公司确认人姓名", "分公司确认人电话", "状态", "操作"];
  const filteredRows = useMemo(() => {
    const normalizedKeyword = normalizeSearchText(searchKeyword);
    const phoneKeyword = normalizePhone(searchKeyword);
    return rows.filter((row) => {
      const matchesType = customerType === "全部"
        || (customerType === "不区分客户类型" && row.customerType === "")
        || row.customerType === customerType;
      const matchesStatus = statusFilter === "全部" || row.status === statusFilter;
      const matchesSearch = !normalizedKeyword
        || [row.dealerShort, row.dealerFull, row.dealerName].some((value) => normalizeSearchText(value).includes(normalizedKeyword))
        || (phoneKeyword.length > 0 && normalizePhone(row.dealerPhone).includes(phoneKeyword));
      return matchesType && matchesStatus && matchesSearch;
    });
  }, [rows, customerType, statusFilter, searchKeyword]);
  const sortedRows = useMemo(() => [...filteredRows].sort(compareWhitelistRows), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const filteredIds = useMemo(() => sortedRows.map((row) => row.id), [sortedRows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const openDelete = (ids: string[]) => {
    const targetRows = rows.filter((row) => ids.includes(row.id));
    setDeleteTarget({ ids, labels: targetRows.map((row) => row.dealerShort || row.dealerFull), kind: "白名单客户" });
  };
  const openClearAll = () => {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;
    setDeleteTarget({
      ids,
      labels: rows.map((row) => row.dealerShort || row.dealerFull),
      kind: "白名单客户",
      label: "全部当前白名单",
      description: "将从当前有效白名单中移除全部客户；已有订单不会被删除。",
      summary: `当前共有 ${ids.length} 名白名单客户`,
    });
  };
  const togglePageRows = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return [...next];
    });
  };
  const selectFilteredRows = () => {
    setSelectedIds((current) => [...new Set([...current, ...filteredIds])]);
  };
  const clearFilteredRows = () => {
    setSelectedIds((current) => current.filter((id) => !filteredIds.includes(id)));
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    onDelete?.(deleteTarget.ids);
    setSelectedIds((current) => current.filter((id) => !deleteTarget.ids.includes(id)));
    setDeleteTarget(null);
  };
  return (
    <>
      <div className="data-filters">
        <label><span>客户类型</span><select value={customerType} onChange={(e) => { setCustomerType(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>综合客户</option><option>特渠专业客户</option><option>不区分客户类型</option></select></label>
        <label><span>状态</span><select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>有效</option><option>待处理</option></select></label>
        <label className="data-filter-search"><span>搜索白名单</span><input type="search" value={searchKeyword} onChange={(e) => { setSearchKeyword(e.target.value); setPage(1); setSelectedIds([]); }} placeholder="经销商名称 / 姓名 / 电话" aria-label="搜索经销商名称、经销商姓名或电话" /></label>
        <small>当前显示 {sortedRows.length} 名客户 · 第 {currentPage}/{totalPages} 页{readOnly ? "，活动已截止只读" : allowDelete ? "，可勾选删除" : "，可编辑"}</small>
      </div>
      {allowDelete && allowDeleteAll && rows.length > 0 && <div className="selection-toolbar selection-toolbar-all"><span>当前白名单 <b>{rows.length}</b> 名</span><button type="button" className="selection-delete" onClick={openClearAll}>清空当前白名单</button></div>}
      {allowDelete && selectedIds.length > 0 && <div className="selection-toolbar"><span>已选择 <b>{selectedIds.length}</b> 名客户{allFilteredSelected ? "（当前筛选结果）" : ""}</span><div>{!allFilteredSelected && filteredIds.length > pageIds.length && <button type="button" className="selection-select-all" onClick={selectFilteredRows}>选择全部 {filteredIds.length} 名</button>}{allFilteredSelected && <button type="button" className="selection-select-all" onClick={clearFilteredRows}>取消全选结果</button>}<button type="button" className="selection-clear" onClick={() => setSelectedIds([])}>取消选择</button><button type="button" className="selection-delete" onClick={() => openDelete(selectedIds)}>删除所选</button></div></div>}
      <div className="table-scroll">
        <div className={`data-table whitelist-table ${allowDelete ? "with-selection" : ""}`}>
          <div className="table-row table-head">{allowDelete && <b className="select-cell"><input type="checkbox" aria-label="全选当前页白名单" checked={allPageSelected} onChange={togglePageRows} /></b>}{heads.map((x) => <b key={x}>{x}</b>)}</div>
          {pageRows.map((row, index) => {
            const values = [pageStart + index + 1, row.customerType || "不区分客户类型", row.region, row.branch, row.dealerShort, row.dealerFull, row.dealerName, row.dealerPhone, row.confirmerName, row.confirmerPhone, row.status];
            return <div className={`table-row ${row.manuallyEdited ? "manually-edited-row" : ""}`} key={row.id}>{allowDelete && <span className="select-cell"><input type="checkbox" aria-label={`选择白名单客户 ${row.dealerShort}`} checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></span>}{values.map((value, index) => <span key={index} className={index === 10 ? `status-cell ${row.status === "待处理" ? "pending" : ""}` : ""}>{value || "—"}</span>)}<span className="table-row-actions"><button type="button" disabled={readOnly} onClick={() => onEdit(row)}>编辑</button>{allowDelete && <button type="button" onClick={() => openDelete([row.id])}>删除</button>}{row.manuallyEdited && <small>已修正</small>}</span></div>;
          })}
          {sortedRows.length === 0 && <div className="table-empty">{searchKeyword.trim() ? "当前搜索和筛选条件下没有白名单客户" : "当前筛选条件下没有白名单客户"}</div>}
        </div>
      </div>
      <div className="table-pagination"><span>共 {sortedRows.length} 名</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select>名</label><button type="button" disabled={currentPage <= 1} onClick={() => setPage(1)}>首页</button><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><b>{currentPage} / {totalPages}</b><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>末页</button></div></div>
      {deleteTarget && <DeleteConfirmDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
    </>
  );
}

export function ProductFormDrawer({ rows, initialRow, activityStarted = false, onClose, onSave }: { rows: ProductImportRow[]; initialRow?: ProductImportRow; activityStarted?: boolean; onClose: () => void; onSave: (row: ProductImportRow, reason?: string) => Promise<boolean> }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<ProductImportRow>(() => initialRow ? { ...initialRow, priceTierMinQuantity: initialRow.priceTierMinQuantity ?? "", priceTierCasePrice: initialRow.priceTierCasePrice ?? "", priceTierPricingMode: initialRow.priceTierPricingMode ?? "WHOLE_ORDER" } : { id: createImportRowId("product"), sequence: 0, customerType: "", rebate: "", category: "", line: "", materialCode: "", materialName: "", description: "", brand: "", variety: "", spec: "", casePack: "", unitPrice: "", casePrice: "", priceTierMinQuantity: "", priceTierCasePrice: "", priceTierPricingMode: "WHOLE_ORDER", conversion: "", gift: "否", branchScope: "", status: "有效", source: "manual" });
  const [tierEnabled, setTierEnabled] = useState(() => Boolean(initialRow?.priceTierMinQuantity || initialRow?.priceTierCasePrice));
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (field: keyof ProductImportRow, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.filter((row) => row.customerType === form.customerType && row.rebate === form.rebate).map((row) => row.sequence)) + 1;
  const duplicateMaterialName = form.materialName.trim() !== "" && rows.some((row) => row.id !== form.id && productImportIdentityKey(row) === productImportIdentityKey(form));
  const conversionValue = Number(form.conversion);
  const conversionValid = form.conversion.trim() !== "" && Number.isFinite(conversionValue) && conversionValue > 0;
  const basePrice = Number(form.casePrice);
  const tierMinQuantity = Number(form.priceTierMinQuantity);
  const tierCasePrice = Number(form.priceTierCasePrice);
  const tierValid = !tierEnabled || (Number.isInteger(tierMinQuantity) && tierMinQuantity >= 2 && tierMinQuantity <= 999999
    && Number.isFinite(tierCasePrice) && tierCasePrice > 0 && tierCasePrice < basePrice);
  const canSave = form.materialName.trim() !== "" && form.casePrice.trim() !== "" && (conversionValid || form.status === "待完善") && tierValid && !duplicateMaterialName && (isEditing || !activityStarted || editReason.trim() !== "");
  return (
    <div className="order-drawer-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <aside className="order-drawer form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>活动商品</span><h2>{isEditing ? "编辑商品" : "手动添加商品"}</h2></div><button aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前商品" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>{form.customerType || "未指定客户类型"} · {form.rebate || "未指定返利"}</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>客户类型</span><select value={form.customerType} onChange={(e) => update("customerType", e.target.value)}><option value="">未指定</option><option>特渠</option><option>综合</option></select></label>
          <label><span>是否参与返利</span><select value={form.rebate} onChange={(e) => update("rebate", e.target.value)}><option value="">未指定</option><option>参与</option><option>不参与</option></select></label>
          <label><span>产品大类</span><input value={form.category} onChange={(e) => update("category", e.target.value)} placeholder="例如：特渠定制产品" /></label>
          <label><span>产品线</span><input value={form.line} onChange={(e) => update("line", e.target.value)} placeholder="例如：调味油" /></label>
          <label><span>物料代码</span><input value={form.materialCode} onChange={(e) => update("materialCode", e.target.value)} /><small>允许为空，不参与商品名称判重</small></label>
          <label className="wide-field"><span>物料名称 *</span><input value={form.materialName} onChange={(e) => update("materialName", e.target.value)} /></label>
          <label className="wide-field"><span>产品说明</span><textarea value={form.description ?? ""} onChange={(e) => update("description", e.target.value)} placeholder="填写后可在 H5 商品详情展示" rows={3} /></label>
          {duplicateMaterialName && <p className="field-error wide-field">同一客户类型、同一返利类型下商品名称已存在，请修改或删除重复行。</p>}
          <div className="product-form-image-field wide-field"><span>商品图片</span><ProductImageEditor materialName={form.materialName} images={form.images} imageStatus={form.imageStatus} onChange={(images, status) => setForm((current) => ({ ...current, images, imageStatus: status }))} /></div>
          <label><span>品牌</span><input value={form.brand} onChange={(e) => update("brand", e.target.value)} /></label>
          <label><span>品种</span><input value={form.variety} onChange={(e) => update("variety", e.target.value)} /></label>
          <label><span>规格</span><input value={form.spec} onChange={(e) => update("spec", e.target.value)} /></label>
          <label><span>箱规</span><input value={form.casePack} onChange={(e) => update("casePack", e.target.value)} /></label>
          <label><span>元/瓶</span><input inputMode="decimal" value={form.unitPrice} onChange={(e) => update("unitPrice", e.target.value)} /></label>
          <label><span>元/箱 *</span><input inputMode="decimal" value={form.casePrice} onChange={(e) => update("casePrice", e.target.value)} /></label>
          <label className="wide-field price-tier-toggle"><span>阶梯价格（选填）</span><span><input type="checkbox" checked={tierEnabled} onChange={(e) => { setTierEnabled(e.target.checked); if (!e.target.checked) setForm((current) => ({ ...current, priceTierMinQuantity: "", priceTierCasePrice: "", priceTierPricingMode: "WHOLE_ORDER" })); }} /> 设置阶梯优惠</span><small>可选择达到门槛后整批降价，或仅从门槛箱开始对超出部分降价</small></label>
          {tierEnabled && <><label><span>优惠起订箱数 *</span><input inputMode="numeric" type="number" min="2" max="999999" value={form.priceTierMinQuantity} onChange={(e) => update("priceTierMinQuantity", e.target.value)} placeholder="例如：1500" /><small className={!Number.isInteger(tierMinQuantity) || tierMinQuantity < 2 || tierMinQuantity > 999999 ? "field-error" : ""}>请输入 2～999999 的整数箱数</small></label><label><span>阶梯优惠箱价 *</span><input inputMode="decimal" value={form.priceTierCasePrice} onChange={(e) => update("priceTierCasePrice", e.target.value)} placeholder="例如：134" /><small className={!Number.isFinite(tierCasePrice) || tierCasePrice <= 0 || tierCasePrice >= basePrice ? "field-error" : ""}>必须大于 0 且低于基础箱价 {Number.isFinite(basePrice) ? basePrice : "—"} 元</small></label><label className="wide-field"><span>计价模式 *</span><select value={form.priceTierPricingMode} onChange={(e) => update("priceTierPricingMode", e.target.value)}><option value="WHOLE_ORDER">达量整批优惠（达到门槛后全部箱数按优惠价）</option><option value="INCREMENTAL">超出部分优惠（从门槛箱开始按优惠价）</option></select><small>{form.priceTierPricingMode === "INCREMENTAL" ? `例如满 ${form.priceTierMinQuantity || "1500"} 箱：前 ${Math.max(1, (tierMinQuantity || 1500) - 1)} 箱按基础价，第 ${form.priceTierMinQuantity || "1500"} 箱起按优惠价` : "达到门槛后，本商品本次订购的全部箱数按优惠价"}</small></label></>}
          <label><span>每吨箱数（箱/吨） *</span><input inputMode="decimal" value={form.conversion} onChange={(e) => update("conversion", e.target.value)} /><small className={!conversionValid && form.status !== "待完善" ? "field-error" : ""}>Excel 原列名：吨箱转换系数；统计时按订货箱数 ÷ 每吨箱数计算吨数</small></label>
          <label><span>是否礼盒</span><select value={form.gift} onChange={(e) => update("gift", e.target.value)}><option>否</option><option>是</option></select></label>
          <label><span>分公司限制</span><input value={form.branchScope} onChange={(e) => update("branchScope", e.target.value)} placeholder="留空表示全部分公司" /><small>多个分公司用顿号或逗号分隔</small></label>
          <label><span>数据状态</span><select value={form.status} onChange={(e) => update("status", e.target.value)}><option>有效</option><option>待完善</option></select></label>
        </div>
        {activityStarted && !isEditing && <label>新增商品原因<input value={editReason} onChange={e => setEditReason(e.target.value)} /></label>}
        <p className="drawer-form-note">带 * 的字段为必填项；{activityStarted ? "价格修改保存后，相关有效订单自动更新。" : "手动新增或修改仅对当前数据版本生效，重新导入 Excel 后以新文件为准。"}</p></div>
        <footer><button disabled={saving} onClick={onClose}>取消</button><button className="admin-primary" disabled={!canSave || saving} onClick={async () => {
          setSaving(true);
          const saved = await onSave({ ...form, sequence: nextSequence, manuallyEdited: true }, editReason.trim());
          setSaving(false);
          if (saved) onClose();
        }}>{saving ? "保存中…" : isEditing ? "保存修改" : "添加商品"}</button></footer>
      </aside>
    </div>
  );
}

export function WhitelistFormDrawer({ rows, initialRow, customerTypeMode = "TYPED", activityStarted = false, onClose, onSave }: { rows: WhitelistRow[]; initialRow?: WhitelistRow; customerTypeMode?: WhitelistCustomerTypeMode; activityStarted?: boolean; onClose: () => void; onSave: (row: WhitelistRow, reason?: string) => Promise<boolean> }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<WhitelistRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("whitelist"), sequence: 0, customerType: customerTypeMode === "UNSPECIFIED" ? "" : "综合客户", region: "", branch: "", dealerShort: "", dealerFull: "", dealerType: "", dealerName: "", dealerPhone: "", confirmerName: "", confirmerPhone: "", status: "有效", source: "manual" });
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const update = (field: keyof WhitelistRow, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.filter((row) => row.customerType === form.customerType).map((row) => row.sequence)) + 1;
  const phoneValid = (isEditing && form.dealerPhone.includes("*")) || whitelistPhoneIsValid(form.dealerPhone);
  const duplicateDealerName = normalizeWhitelistName(form.dealerFull) !== "" && rows.some((row) => row.id !== form.id && row.customerType === form.customerType && whitelistIdentityKey(row) === whitelistIdentityKey(form));
  const duplicateDealerPhone = whitelistPhoneIsValid(form.dealerPhone) && rows.some((row) => row.id !== form.id && row.customerType === form.customerType && normalizePhone(row.dealerPhone) === normalizePhone(form.dealerPhone));
  const canSave = (customerTypeMode === "UNSPECIFIED" ? form.customerType === "" : form.customerType !== "") && form.branch.trim() !== "" && form.dealerShort.trim() !== "" && form.dealerFull.trim() !== "" && phoneValid && !duplicateDealerName && !duplicateDealerPhone && (!activityStarted || editReason.trim() !== "");
  return (
    <div className="order-drawer-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <aside className="order-drawer form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>客户身份</span><h2>{isEditing ? "编辑白名单" : "手动添加白名单客户"}</h2></div><button aria-label="关闭" disabled={saving} onClick={onClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前客户" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>{form.customerType || "不区分客户类型"}分组</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>客户类型</span><select value={form.customerType} disabled={customerTypeMode === "UNSPECIFIED"} onChange={(e) => { const type = e.target.value as WhitelistRow["customerType"]; setForm((current) => ({ ...current, customerType: type })); }}>
            {customerTypeMode === "UNSPECIFIED" ? <option value="">不区分客户类型</option> : <><option>综合客户</option><option>特渠专业客户</option></>}
          </select></label>
          <label><span>大区（选填）</span><input value={form.region} onChange={(e) => update("region", e.target.value)} placeholder="可自行填写；不分大区请留空" /></label>
          <label><span>分公司名称 *</span><input value={form.branch} onChange={(e) => update("branch", e.target.value)} placeholder="例如：长沙分" /></label>
          <label><span>经销商名称（简）*</span><input value={form.dealerShort} onChange={(e) => update("dealerShort", e.target.value)} /><small>{form.dealerShort.length}/10 字</small></label>
          <label className="wide-field"><span>经销商名称（全）*</span><input value={form.dealerFull} onChange={(e) => update("dealerFull", e.target.value)} /><small className={duplicateDealerName ? "field-error" : ""}>{duplicateDealerName ? "同客户类型、同一分公司下已存在，请直接编辑原客户" : "客户身份匹配使用客户类型 + 名称全称 + 分公司；电话变化时会更新原客户"}</small></label>
          <label><span>经销商姓名</span><input value={form.dealerName} onChange={(e) => update("dealerName", e.target.value)} /></label>
          <label><span>经销商电话 *</span><input inputMode="tel" maxLength={11} value={form.dealerPhone} onChange={(e) => update("dealerPhone", e.target.value.replace(/\D/g, ""))} placeholder="11 位手机号" /><small className={duplicateDealerPhone || (form.dealerPhone !== "" && !phoneValid) ? "field-error" : ""}>{duplicateDealerPhone ? "同客户类型内手机号已存在；综合和特渠可以同号" : form.dealerPhone && !phoneValid ? "请输入正确的 11 位手机号" : "用于 H5 身份验证；请输入完整的 11 位手机号"}</small></label>
          <label><span>分公司确认人姓名</span><input value={form.confirmerName} onChange={(e) => update("confirmerName", e.target.value)} /></label>
          <label><span>分公司确认人电话</span><input inputMode="tel" maxLength={11} value={form.confirmerPhone} onChange={(e) => update("confirmerPhone", e.target.value.replace(/\D/g, ""))} /></label>
          {activityStarted && <label className="wide-field"><span>紧急修改原因 *</span><input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="请填写本次改单原因，保存后写入操作日志" /></label>}
        </div>
        <p className="drawer-form-note">{customerTypeMode === "UNSPECIFIED" ? "当前白名单不区分客户类型，H5 将直接验证手机号。" : "当前白名单按客户类型区分，综合客户进入 H5 后还需选择大区。"} {activityStarted ? "活动已开始，本次手动调整会记录操作日志。" : "手动新增或修改仅对当前数据版本生效，重新导入 Excel 后以新文件为准。"}</p></div>
        <footer><div className="drawer-save-error">{saveError && <small className="field-error">{saveError}</small>}</div><button disabled={saving} onClick={onClose}>取消</button><button className="admin-primary" disabled={!canSave || saving} onClick={async () => {
          setSaving(true); setSaveError("");
          try {
            const saved = await onSave({ ...form, sequence: nextSequence, status: "有效", source: isEditing ? form.source ?? "excel" : "manual", identityKey: whitelistIdentityKey(form), manuallyEdited: true }, editReason.trim());
            if (saved) onClose(); else setSaveError("保存失败，请根据页面提示检查后重试。");
          } catch { setSaveError("保存请求异常，请稍后重试。"); }
          finally { setSaving(false); }
        }}>{saving ? "保存中…" : isEditing ? "保存修改" : "添加客户"}</button></footer>
      </aside>
    </div>
  );
}

export function cloneAttendanceRows(rows: AttendanceRow[]) {
  return rows.map((row) => ({ ...row }));
}

export function mapAdminAttendanceRows(attendees: AdminAttendee[]): AttendanceRow[] {
  return attendees.map((attendee, index) => ({
    id: String(attendee.id), activityCustomerId: attendee.activityCustomerId ?? null, sequence: index + 1,
    dealerName: attendee.participantName || "", gender: attendee.gender || "", contactPhone: attendee.phone || attendee.phoneMasked || "",
    branch: attendee.branchName || "", dealerCompany: attendee.dealerName, participantType: attendee.participantType || "",
    customerType: attendee.participantType?.includes("特渠") ? "特渠专业客户" : attendee.participantType?.includes("综合") ? "综合客户" : "",
    matchStatus: attendee.matchStatus, matchMethod: attendee.matchMethod, matchReasonCode: attendee.matchReasonCode,
    matchedDealerName: attendee.matchedDealerName, lotteryEligible: attendee.lotteryEligible,
  }));
}

export function mergeAttendanceMatchPreview(rows: AttendanceRow[], preview: AttendanceMatchPreview) {
  const byStagingRow = new Map(preview.rows.map((row) => [row.stagingRowId, row]));
  return rows.map((row) => {
    const match = row.serverRowId ? byStagingRow.get(row.serverRowId) : undefined;
    return match ? { ...row, activityCustomerId: match.activityCustomerId ?? null, matchStatus: match.matchStatus,
      matchMethod: match.matchMethod, matchReasonCode: match.matchReasonCode,
      matchedDealerName: match.matchedDealerName, lotteryEligible: match.lotteryEligible } : row;
  });
}

const attendanceMatchLabels = { MATCHED: "已关联", PENDING_CONFIRMATION: "待确认", UNMATCHED: "未关联" } as const;
const attendanceMethodLabels = { PHONE: "手机号", FULL_NAME: "经销商全称", SHORT_NAME: "经销商简称", MANUAL: "人工确认" } as const;
const attendanceReasonLabels: Record<string, string> = {
  PHONE_NAME_CONFLICT: "历史手机号与名称冲突", FULL_SHORT_NAME_CONFLICT: "全称与简称冲突",
  MULTIPLE_CANDIDATES: "存在多个候选", CUSTOMER_TYPE_UNKNOWN: "客户类型无法识别",
  WHITELIST_NOT_PUBLISHED: "白名单未发布", NO_UNIQUE_MATCH: "没有唯一匹配结果", LEGACY_UNMATCHED: "历史记录未关联",
};

export function AttendanceFormDrawer({ rows, initialRow, onClose, onSave }: { rows: AttendanceRow[]; initialRow?: AttendanceRow; onClose: () => void; onSave: (row: AttendanceRow) => Promise<boolean> }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<AttendanceRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("attendance-manual"), sequence: 0, dealerName: "", gender: "", contactPhone: "", branch: "", dealerCompany: "", participantType: "", customerType: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.map((row) => row.sequence)) + 1;
  const update = (field: AttendanceFieldKey, value: string) => setForm((current) => ({ ...current, [field]: value, ...(field === "participantType" ? { customerType: attendanceCustomerType(value) } : {}) }));
  return (
    <div className="order-drawer-backdrop" onClick={() => { if (!saving) onClose(); }}>
      <aside className="order-drawer form-drawer attendance-form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>现场到场客户</span><h2>{isEditing ? "编辑到场客户" : "手动添加到场客户"}</h2></div><button type="button" aria-label="关闭" disabled={saving} onClick={onClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前记录" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>当前仅用于到场名单页面展示</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>分公司</span><input value={form.branch} onChange={(event) => update("branch", event.target.value)} placeholder="请输入分公司" /></label>
          <label><span>参会人姓名</span><input value={form.dealerName} onChange={(event) => update("dealerName", event.target.value)} placeholder="请输入参会人姓名" /></label>
          <label><span>性别</span><select value={form.gender} onChange={(event) => update("gender", event.target.value)}><option value="">请选择</option><option>男</option><option>女</option></select></label>
          <label><span>参会人电话</span><input inputMode="tel" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} placeholder="请输入参会人电话" /></label>
          <label className="wide-field"><span>经销商名称</span><input value={form.dealerCompany} onChange={(event) => update("dealerCompany", event.target.value)} placeholder="请输入经销商名称" /></label>
          <label className="wide-field"><span>参会人员类型</span><input value={form.participantType} onChange={(event) => update("participantType", event.target.value)} placeholder="例如：综合经销商 / 特渠专业经销商" /></label>
        </div><p className="drawer-form-note">抽奖大屏只显示经销商名称；客户类型由参会人员类型自动识别。</p></div>
        <footer><div className="drawer-save-error">{saveError && <small className="field-error">{saveError}</small>}</div><button type="button" disabled={saving} onClick={onClose}>取消</button><button type="button" className="admin-primary" disabled={saving} onClick={async () => {
          setSaving(true); setSaveError("");
          try {
            const saved = await onSave({ ...form, sequence: nextSequence, manuallyEdited: true });
            if (saved) onClose(); else setSaveError("保存失败，请根据页面提示检查后重试。");
          } catch { setSaveError("保存请求异常，请稍后重试。"); }
          finally { setSaving(false); }
        }}>{saving ? "保存中…" : isEditing ? "保存修改" : "保存到场客户"}</button></footer>
      </aside>
    </div>
  );
}

export function AttendanceTable({ rows, onEdit, onDelete, allowDelete = false, allowDeleteAll = false, readOnly = false, customerTypeMode = "TYPED" }: { rows: AttendanceRow[]; onEdit: (row: AttendanceRow) => void; onDelete?: (ids: string[]) => void; allowDelete?: boolean; allowDeleteAll?: boolean; readOnly?: boolean; customerTypeMode?: WhitelistCustomerTypeMode }) {
  const [customerType, setCustomerType] = useState("全部");
  const [branch, setBranch] = useState("全部");
  const [matchStatus, setMatchStatus] = useState("全部");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const branchOptions = useMemo(() => ["全部", ...Array.from(new Set(rows.map((row) => row.branch).filter(Boolean)))], [rows]);
  const customerTypeOptions = useMemo(() => customerTypeMode === "UNSPECIFIED" ? ["全部", "不区分客户类型"] : ["全部", ...Array.from(new Set(rows.map((row) => row.customerType).filter(Boolean)))], [rows, customerTypeMode]);
  const effectiveCustomerType = customerTypeMode === "UNSPECIFIED"
    ? customerType === "不区分客户类型" ? customerType : "全部"
    : customerType === "不区分客户类型" ? "全部" : customerType;
  const filteredRows = useMemo(() => {
    const keyword = normalizeSearchText(searchKeyword);
    return rows.filter((row) => {
      const values = [row.dealerName, row.gender, row.contactPhone, row.branch, row.dealerCompany, row.participantType, row.customerType];
      const matchesSearch = !keyword || values.some((value) => normalizeSearchText(value).includes(keyword));
      const matchesCustomerType = effectiveCustomerType === "全部" || (effectiveCustomerType === "不区分客户类型" ? row.customerType === "" : row.customerType === effectiveCustomerType);
      return matchesCustomerType && (branch === "全部" || row.branch === branch)
        && (matchStatus === "全部" || row.matchStatus === matchStatus) && matchesSearch;
    });
  }, [rows, effectiveCustomerType, branch, matchStatus, searchKeyword]);
  const sortedRows = useMemo(() => [...filteredRows].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id)), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const filteredIds = useMemo(() => sortedRows.map((row) => row.id), [sortedRows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const openDelete = (ids: string[]) => {
    const targetRows = rows.filter((row) => ids.includes(row.id));
    setDeleteTarget({
      ids,
      labels: targetRows.map((row) => row.dealerCompany || row.dealerName || row.contactPhone),
      kind: "现场到场客户",
      description: "删除后将从当前现场到场名单和抽奖候选池中移除，不会删除原 Excel 文件。",
    });
  };
  const openClearAll = () => {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;
    setDeleteTarget({
      ids,
      labels: rows.map((row) => row.dealerCompany || row.dealerName || row.contactPhone),
      kind: "现场到场客户",
      label: "全部当前到场名单",
      description: "将从当前现场到场名单和抽奖候选池中移除全部客户，不会删除原 Excel 文件。",
      summary: `当前共有 ${ids.length} 名到场客户`,
    });
  };
  const togglePageRows = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return [...next];
    });
  };
  const selectFilteredRows = () => {
    setSelectedIds((current) => [...new Set([...current, ...filteredIds])]);
  };
  const clearFilteredRows = () => {
    setSelectedIds((current) => current.filter((id) => !filteredIds.includes(id)));
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    onDelete?.(deleteTarget.ids);
    setSelectedIds((current) => current.filter((id) => !deleteTarget.ids.includes(id)));
    setDeleteTarget(null);
  };
  return (
    <>
      <div className="data-filters attendance-filters">
        <label><span>客户类型</span><select value={effectiveCustomerType} onChange={(event) => { setCustomerType(event.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option>{customerTypeOptions.filter((value) => value !== "全部").map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>分公司</span><select value={branch} onChange={(event) => { setBranch(event.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option>{branchOptions.filter((value) => value !== "全部").map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>关联状态</span><select value={matchStatus} onChange={(event) => { setMatchStatus(event.target.value); setPage(1); setSelectedIds([]); }}><option value="全部">全部</option><option value="MATCHED">已关联</option><option value="PENDING_CONFIRMATION">待确认</option><option value="UNMATCHED">未关联</option></select></label>
        <label className="data-filter-search"><span>搜索到场客户</span><input type="search" value={searchKeyword} onChange={(event) => { setSearchKeyword(event.target.value); setPage(1); setSelectedIds([]); }} placeholder="姓名 / 联系电话 / 经销商名称" aria-label="搜索现场到场客户" /></label>
        <small>当前显示 {sortedRows.length} 名 · 第 {currentPage}/{totalPages}{readOnly ? "，活动已截止只读" : allowDelete ? "，可勾选删除" : "，可编辑"}</small>
      </div>
      {allowDelete && allowDeleteAll && rows.length > 0 && <div className="selection-toolbar selection-toolbar-all"><span>当前到场名单 <b>{rows.length}</b> 名</span><button type="button" className="selection-delete" onClick={openClearAll}>清空当前名单</button></div>}
      {allowDelete && selectedIds.length > 0 && <div className="selection-toolbar"><span>已选择 <b>{selectedIds.length}</b> 名客户{allFilteredSelected ? "（当前筛选结果）" : ""}</span><div>{!allFilteredSelected && filteredIds.length > pageIds.length && <button type="button" className="selection-select-all" onClick={selectFilteredRows}>选择全部 {filteredIds.length} 名</button>}{allFilteredSelected && <button type="button" className="selection-select-all" onClick={clearFilteredRows}>取消全选结果</button>}<button type="button" className="selection-clear" onClick={() => setSelectedIds([])}>取消选择</button><button type="button" className="selection-delete" onClick={() => openDelete(selectedIds)}>删除所选</button></div></div>}
      <div className="table-scroll">
        <div className={`data-table attendance-table ${allowDelete ? "with-selection" : ""}`}>
          <div className="table-row table-head">{allowDelete && <b className="select-cell"><input type="checkbox" aria-label="全选当前页到场客户" checked={allPageSelected} onChange={togglePageRows} /></b>}<b>序号</b><b>分公司</b><b>参会人姓名</b><b>性别</b><b>参会人电话</b><b>参会人员类型</b><b>经销商名称</b><b>关联状态</b><b>操作</b></div>
          {pageRows.map((row, index) => <div className="table-row" key={row.id}>
            {allowDelete && <span className="select-cell"><input type="checkbox" aria-label={`选择到场客户 ${row.dealerCompany || row.dealerName || row.contactPhone}`} checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></span>}<span>{pageStart + index + 1}</span><span>{row.branch || "—"}</span><span>{row.dealerName || "—"}</span><span>{row.gender || "—"}</span><span>{row.contactPhone || "—"}</span><span>{row.participantType || "—"}</span><span>{row.dealerCompany || "—"}</span><span className={`attendance-match-status ${(row.matchStatus || "UNMATCHED").toLowerCase()}`}><b>{row.matchStatus ? attendanceMatchLabels[row.matchStatus] : "导入后重算"}</b><small>{row.matchMethod ? attendanceMethodLabels[row.matchMethod] : attendanceReasonLabels[row.matchReasonCode || ""] || "—"}</small></span><span className="table-row-actions"><button type="button" disabled={readOnly} onClick={() => onEdit(row)}>编辑</button>{allowDelete && <button type="button" onClick={() => openDelete([row.id])}>删除</button>}</span>
          </div>)}
          {sortedRows.length === 0 && <div className="table-empty">当前条件下没有到场客户</div>}
        </div>
      </div>
      <div className="table-pagination"><span>共 {sortedRows.length} 名</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select>名</label><button type="button" disabled={currentPage <= 1} onClick={() => setPage(1)}>首页</button><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><b>{currentPage} / {totalPages}</b><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>末页</button></div></div>
      {deleteTarget && <DeleteConfirmDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
    </>
  );
}

export function AttendancePage({ rows, fileName, warnings, sheetCounts, error, activityStarted, activityClosed, pendingImport, importAttemptName, blockingCount, previewLoading, publishing, onFile, onAdd, onEdit, onDelete, onConfirmImport, onCancelImport, customerTypeMode = "TYPED" }: { rows: AttendanceRow[]; fileName: string; warnings: string[]; sheetCounts: Array<{ name: string; count: number }>; error: string; activityStarted: boolean; activityClosed: boolean; pendingImport: AttendanceImportDraft | null; importAttemptName: string; blockingCount: number; previewLoading: boolean; publishing: boolean; onFile: (file: File) => void | Promise<void>; onAdd: () => void; onEdit: (row: AttendanceRow) => void; onDelete: (ids: string[]) => void; onConfirmImport: () => void; onCancelImport: () => void; customerTypeMode?: WhitelistCustomerTypeMode }) {
  const previewRows = pendingImport?.rows ?? rows;
  const displayWarnings = pendingImport?.warnings ?? warnings;
  const displaySheetCounts = pendingImport?.sheetCounts ?? sheetCounts;
  const displayFileName = pendingImport?.fileName || (error ? importAttemptName : fileName);
  const isPending = Boolean(pendingImport);
  const originalCount = pendingImport?.inputCount ?? previewRows.length;
  const removedCount = Math.max(0, originalCount - previewRows.length);
  const comprehensiveCount = previewRows.filter((row) => row.customerType.includes("综合")).length;
  const specialCount = previewRows.filter((row) => row.customerType.includes("特渠")).length;
  const blankTypeCount = previewRows.filter((row) => !row.customerType).length;
  const phoneCount = previewRows.filter((row) => row.contactPhone).length;
  const linkedCount = previewRows.filter((row) => row.matchStatus === "MATCHED" && row.lotteryEligible).length;
  const eligibleCustomerCount = new Set(previewRows.filter((row) => row.matchStatus === "MATCHED" && row.lotteryEligible)
    .map((row) => row.activityCustomerId).filter((id): id is number => id != null)).size;
  const pendingCount = previewRows.filter((row) => row.matchStatus === "PENDING_CONFIRMATION").length;
  const unmatchedCount = previewRows.filter((row) => row.matchStatus === "UNMATCHED").length;
  const unspecifiedCustomerType = customerTypeMode === "UNSPECIFIED";
  return (
    <div className="admin-panel attendance-panel">
      <div className="panel-title"><div><h2>现场到场客户</h2><p>按现场参会名单模板导入；抽奖选择现场到场客户时，现场大屏显示经销商名称。</p></div><div className="panel-actions"><button className="secondary-button" disabled={activityClosed} onClick={onAdd}>＋ 手动添加到场客户</button></div></div>
      <div className="import-rule-hint"><b>{isPending ? "待确认导入" : activityClosed ? "活动已截止" : activityStarted ? "现场名单维护中" : "导入规则"}</b><span>{isPending ? "Excel 已解析，下面显示的是待导入预览；确认后才会替换当前名单并更新抽奖候选池，可先编辑或删除异常记录。" : activityClosed ? "活动已截止，现场到场名单只读。" : activityStarted ? "订货进行中仍可维护现场到场名单，确认替换后会更新抽奖候选池。" : "现场到场名单独立于订货基础数据，可在活动开始前或进行中导入；确认后更新抽奖候选池。"}</span></div>
      <div className="attendance-upload-grid">
        <article className={`file-upload-card attendance-upload-card ${isPending ? "pending" : displayFileName && !error ? "ready" : ""}`}>
          <div className="file-card-heading"><span>XL</span><div><b>现场到场客户 Excel</b><small>选择文件后先预览，确认后替换当前名单</small></div><em>{isPending ? "待确认" : error ? "解析失败" : displayFileName ? "解析完成" : "待上传"}</em></div>
          <p title={displayFileName}>{displayFileName || "尚未选择真实 Excel 文件"}</p>
          <div className="sheet-counts">{displaySheetCounts.length > 0 ? displaySheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>) : <span>{isPending ? "待导入名单" : "当前名单"}<b>{previewRows.length}</b></span>}</div>
          {error && <div className="warning-box"><b>文件无法导入</b><span>{error}</span></div>}
                <footer><small>{isPending ? `Excel 原始 ${originalCount} 名 · 已移除 ${removedCount} 名 · 待发布 ${previewRows.length} 名` : activityClosed ? "活动已截止，名单只读" : error ? "文件解析失败，请修正后重试" : displayFileName ? `已读取 ${previewRows.length} 名客户` : "支持 .xlsx 文件"}</small><div>{isPending && <button type="button" disabled={publishing} onClick={onCancelImport}>取消导入</button>}{error && !isPending && <button type="button" onClick={onCancelImport}>清除错误</button>}<label className={`file-button ${activityClosed || publishing ? "disabled" : ""}`}><input type="file" accept=".xlsx" disabled={activityClosed || publishing} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void onFile(file); }} />{isPending || displayFileName ? "重新选择文件" : "选择 Excel"}</label></div></footer>
        </article>
        <div className="attendance-overview-card"><div><span>{isPending ? "待发布名单" : "当前名单"}</span><strong>{previewRows.length}<small> 名</small></strong><em>{isPending ? `原始 ${originalCount} · 移除 ${removedCount}` : "当前导入批次"}</em></div><div><span>已关联记录／资格客户</span><b>{linkedCount}／{eligibleCustomerCount}</b></div><div><span>待确认</span><b>{pendingCount}</b></div><div><span>未关联</span><b>{unmatchedCount}</b></div>{unspecifiedCustomerType ? <div><span>客户范围</span><b>全部客户</b></div> : <div><span>综合／特渠</span><b>{comprehensiveCount}／{specialCount}</b></div>}<div><span>已填写电话</span><b>{phoneCount}</b></div>{!unspecifiedCustomerType && <div><span>未填客户类型</span><b>{blankTypeCount}</b></div>}<p>{isPending ? "当前为发布前试算；按当前已发布白名单实时计算，正式发布时会再次校验白名单版本。" : "仅已关联当前有效白名单的到场记录具备现场抽奖资格。"}</p></div>
      </div>
      {displayWarnings.length > 0 && <div className="warning-box attendance-warning"><b>导入提示</b>{displayWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
      <div className="data-section-title"><div><b>{isPending ? "待导入到场客户预览" : "到场客户名单"}</b><span>{isPending ? `${pendingImport?.fileName} · 尚未确认` : fileName ? `${fileName} · 当前导入结果` : "尚未导入到场名单"}</span></div><span className={`attendance-not-linked ${isPending ? "pending" : ""}`}>{isPending ? `白名单实时试算 · 已关联 ${linkedCount}` : `已关联 ${linkedCount} / ${previewRows.length}`}</span></div>
      <AttendanceTable rows={previewRows} onEdit={onEdit} onDelete={onDelete} allowDelete={!activityClosed} allowDeleteAll={!activityClosed} readOnly={activityClosed} customerTypeMode={customerTypeMode} />
      {isPending && <div className="attendance-publish-panel">
        <div className="attendance-publish-summary"><b>发布摘要</b><span>待发布 <strong>{previewRows.length}</strong> 名</span><span>已关联 <strong>{linkedCount}</strong> 条</span><span>资格客户 <strong>{eligibleCustomerCount}</strong> 名</span><span>待确认 <strong>{pendingCount}</strong> 条</span><span>未关联 <strong>{unmatchedCount}</strong> 条</span></div>
        <p>{blockingCount > 0 ? `存在 ${blockingCount} 条 Excel 数据异常，必须先编辑或删除。` : "按客户类型和经销商名称关联当前白名单；现场手机号仅作联系信息。待确认和未关联记录可以发布，但不会进入抽奖候选池。"}</p>
        <button type="button" className="admin-primary wide" disabled={activityClosed || previewRows.length === 0 || blockingCount > 0 || previewLoading || publishing} onClick={onConfirmImport}>{publishing ? "正在发布…" : previewLoading ? "正在计算关联结果…" : blockingCount > 0 ? `请先处理 ${blockingCount} 条异常记录` : `确认替换当前到场名单 ${previewRows.length} 名`}</button>
      </div>}
    </div>
  );
}
