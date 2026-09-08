"use client";

import { useMemo, useState } from "react";
import { type AttendanceRow, type DeleteTarget, type WhitelistCustomerTypeMode } from "../../../domain/import-domain";
import { normalizeSearchText } from "../../shared/utils";
import { DeleteConfirmDialog } from "../shared/DeleteConfirmDialog";
import { attendanceMatchLabels, attendanceMethodLabels, attendanceReasonLabels } from "./attendance-labels";

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
