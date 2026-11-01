"use client";
import { positiveProductNumber } from "../../../domain/product-completeness";

import { useMemo, useState } from "react";
import { compareProductRows, type DeleteTarget, type ProductImageAsset, type ProductImportRow } from "../../../domain/import-domain";
import { ProductImageViewer } from "../../shared/components/ProductImageViewer";
import { Thumbnail } from "../../shared/components/Thumbnail";
import { normalizeSearchText } from "../../shared/utils";
import { normalizeMaterialCode } from "../admin-utils";
import { DeleteConfirmDialog } from "../shared/DeleteConfirmDialog";

export function ProductImportTable({ rows, onEdit, onDelete, allowDelete = false, allowDeleteAll = false, readOnly = false }: { rows: ProductImportRow[]; onEdit: (row: ProductImportRow) => void; onDelete?: (ids: string[]) => void; allowDelete?: boolean; allowDeleteAll?: boolean; readOnly?: boolean }) {
  const [customerType, setCustomerType] = useState("全部");
  const [rebate, setRebate] = useState("全部");
  const [projectGroup, setProjectGroup] = useState("");
  const [imageFilter, setImageFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [priceFilter, setPriceFilter] = useState("全部");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [imagePreview, setImagePreview] = useState<{ productName: string; images: ProductImageAsset[]; status: string } | null>(null);
  const projectGroupOptions = useMemo(() => [...new Set(rows.map((row) => row.line.trim()))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map((name) => ({ value: `group:${name}`, label: name === "全部" || name === "未填写项目组" ? `${name}（项目组名称）` : name || "未填写项目组" })), [rows]);
  // A removed group resets the filter and selection before rendering the replacement data.
  if (projectGroup && !projectGroupOptions.some((option) => option.value === projectGroup)) {
    setProjectGroup("");
    setPage(1);
    setSelectedIds([]);
  }
  const heads = ["序号", "客户类型", "是否返利", "产品大类", "项目组", "物料代码", "物料名称", "产品说明", "商品图片", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "每吨箱数（箱/吨）", "是否礼盒", "分公司限制", "经销商限制", "状态", "操作"];
  const filteredRows = useMemo(() => {
    const normalizedKeyword = normalizeSearchText(searchKeyword);
    const normalizedCodeKeyword = normalizeMaterialCode(searchKeyword);
    return rows.filter((row) => {
      const matchesImage = imageFilter === "全部"
        || (imageFilter === "已匹配" && row.imageStatus === "已匹配")
        || (imageFilter === "未匹配" && row.imageStatus === "未匹配")
        || (imageFilter === "待确认" && row.imageStatus === "待确认");
      const hasValidPrice = positiveProductNumber(row.casePrice) !== null;
      const matchesPrice = priceFilter === "全部"
        || (priceFilter === "价格有效" && hasValidPrice)
        || (priceFilter === "价格待完善" && !hasValidPrice);
      const matchesCustomerType = customerType === "全部"
        || (customerType === "未指定" ? row.customerType === "" : row.customerType === customerType);
      const matchesRebate = rebate === "全部"
        || (rebate === "未指定" ? row.rebate === "" : row.rebate === rebate);
      const matchesProjectGroup = !projectGroup || `group:${row.line.trim()}` === projectGroup;
      const matchesFilters = matchesCustomerType && matchesRebate && matchesProjectGroup
        && (statusFilter === "全部" || row.status === statusFilter) && matchesImage && matchesPrice;
      const matchesSearch = !normalizedKeyword
        || normalizeSearchText(row.materialName).includes(normalizedKeyword)
        || normalizeMaterialCode(row.materialCode).includes(normalizedCodeKeyword);
      return matchesFilters && matchesSearch;
    });
  }, [rows, customerType, rebate, projectGroup, imageFilter, statusFilter, priceFilter, searchKeyword]);
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
        <label><span>项目组</span><select aria-label="项目组" value={projectGroup} onChange={(e) => { setProjectGroup(e.target.value); setPage(1); setSelectedIds([]); }}><option value="">全部</option>{projectGroupOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
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
            const scope = row.dealerScope ?? [];
            const count = row.effectiveDealerCount ?? scope.reduce((n,s) => n+s.members.length,0);
            const invalid = scope.some(s => s.members.length === 0 || s.members.some(m => !m.active));
            const values = [pageStart + index + 1, row.customerType, row.rebate, row.category, row.line, row.materialCode, row.materialName, row.description, null, row.brand, row.variety, row.spec, row.casePack, row.unitPrice, row.casePrice, row.conversion, row.gift, row.branchScope || "全部分公司", row.dealerScopeRestricted ? `${count} 家${invalid ? "（待处理）" : ""}` : "不限制", row.status];
            const imageStatus = row.imageStatus ?? "未匹配";
            const imageLabel = imageStatus === "待确认"
              ? String(row.images?.length ?? 0)
              : imageStatus === "未匹配"
                ? imageStatus
                : row.images?.length ? `${row.images.length} 张` : "未匹配";
            return <div className={`table-row ${row.manuallyEdited ? "manually-edited-row" : ""}`} key={row.id}>{allowDelete && <span className="select-cell"><input type="checkbox" aria-label={`选择商品 ${row.materialName}`} checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></span>}{values.map((value, index) => index === 8 ? <button type="button" key={index} className={`product-image-cell product-image-button-cell ${imageStatus === "待确认" ? "pending" : row.images?.length ? "matched" : "unmatched"}`} disabled={!row.images?.length} aria-label={`查看${row.materialName}商品图片`} onClick={() => row.images?.length && setImagePreview({ productName: row.materialName, images: row.images, status: imageLabel })}>{row.images?.[0]?.url ? <Thumbnail src={row.images[0].url} alt={row.materialName} /> : <i>—</i>}<small>{imageLabel}</small></button> : <span key={index} title={index === 7 ? String(value || "") : undefined} className={`${index === 7 ? "description-cell" : ""} ${index === 19 ? `status-cell ${row.status !== "有效" ? "pending" : ""}` : ""}`}>{value || "—"}</span>)}<span className="table-row-actions"><button type="button" disabled={readOnly} onClick={() => onEdit(row)}>编辑</button>{allowDelete && <button type="button" onClick={() => openDelete([row.id])}>删除</button>}{row.manuallyEdited && <small>已修正</small>}</span></div>;
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
