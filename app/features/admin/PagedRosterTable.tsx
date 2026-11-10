"use client";
import { useEffect, useRef, useState } from "react";
import { deleteRosterSelection, previewRosterDeletion, type AdminAttendee, type AdminCustomer, type RosterFilters, type RosterKind, type RosterSelection } from "../../api";
import type { AttendanceRow, WhitelistRow } from "../../domain/import-domain";
import { mapAdminWhitelistRows } from "./whitelist-utils";
import { mapAdminAttendanceRows } from "./attendance-utils";
import { attendanceMatchLabels, attendanceMethodLabels, attendanceReasonLabels } from "./attendance/attendance-labels";
import type { RosterState } from "./useRosterState";

type Row = WhitelistRow | AttendanceRow;
const typeLabels: Record<string, string> = { GENERAL: "综合客户", SPECIAL: "特渠专业客户", ALL: "不区分客户类型" };
export function PagedRosterTable({ activityId, kind, roster, regions, loading, readOnly, allowDelete, onEdit, onDeleted, customerTypeMode = "TYPED" }: {
  activityId: number; kind: RosterKind; roster: RosterState<AdminCustomer> | RosterState<AdminAttendee>;
  regions?: ReadonlyMap<string, string>; loading: boolean; readOnly: boolean; allowDelete: boolean;
  onEdit: (row: Row) => void; onDeleted: (count: number) => void;
  customerTypeMode?: "TYPED" | "UNSPECIFIED";
}) {
  const whitelist = kind === "customers", query = roster.query, response = roster.response;
  const [keyword, setKeyword] = useState(query.keyword);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [allFiltered, setAllFiltered] = useState(false);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{ selection: RosterSelection; count: number } | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const filterKey = JSON.stringify([query.customerType, query.branch, query.status, query.matchStatus, query.keyword]);
  const filterScope = `${activityId}:${kind}:${filterKey}`;
  const [selectionScope, setSelectionScope] = useState(filterScope);
  if (selectionScope !== filterScope) { setSelectionScope(filterScope); setSelected({}); setAllFiltered(false); setExcluded({}); setConfirmation(null); }
  useEffect(() => {
    if (keyword === query.keyword) return;
    const timer = setTimeout(() => roster.change({ keyword, page: 1 }), 300);
    return () => clearTimeout(timer);
  }, [keyword, query.keyword, roster.change]);
  const rows: Row[] = !roster.page ? [] : whitelist
    ? mapAdminWhitelistRows(roster.page.data as AdminCustomer[], regions)
    : mapAdminAttendanceRows(roster.page.data as AdminAttendee[], (query.page - 1) * query.size);
  const total = response?.page.totalElements ?? 0, pages = Math.max(1, response?.page.totalPages ?? 1);
  const pending = loading || !roster.page || keyword !== query.keyword;
  const ids = rows.map(row => row.id), pageSelected = ids.length > 0 && ids.every(id => allFiltered ? !excluded[id] : selected[id]);
  const selectedCount = allFiltered ? Math.max(0, total - Object.keys(excluded).length) : Object.keys(selected).length;
  const filters: RosterFilters = { customerType: query.customerType, branch: query.branch, status: query.status, matchStatus: query.matchStatus, keyword: query.keyword };
  const change = (patch: Partial<typeof query>) => { setError(""); roster.change({ ...patch, page: 1 }); };
  const prepare = async (only?: string[], clearAll = false) => {
    setBusy(true); setError("");
    try {
      const selection: RosterSelection = {
        filters: clearAll ? { customerType: "", branch: "", status: "", matchStatus: "", keyword: "" } : filters,
        rows: clearAll || allFiltered && !only ? null : (only ?? Object.keys(selected)).map(id => ({ id: Number(id), revision: (only ? roster.page?.revisions[id] : selected[id]) ?? "" })),
        excludedIds: allFiltered && !only && !clearAll ? Object.keys(excluded).map(Number) : undefined,
      };
      const preview = await previewRosterDeletion(activityId, kind, selection);
      if (!active.current) return;
      if (!preview.count) { setError("当前没有可删除的记录，请刷新列表核对。"); return; }
      setConfirmation({ count: preview.count, selection: { ...selection, snapshot: preview.snapshot } });
    } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : "删除范围读取失败"); }
    finally { if (active.current) setBusy(false); }
  };
  const confirm = async () => {
    if (!confirmation || busy) return;
    setBusy(true); setError("");
    try {
      const count = await deleteRosterSelection(activityId, kind, confirmation.selection);
      if (!active.current) return;
      setConfirmation(null); setSelected({}); setAllFiltered(false); setExcluded({}); onDeleted(count);
    } catch (reason) {
      if (!active.current) return;
      setConfirmation(null); setError(reason instanceof Error ? reason.message : "删除失败，请刷新后核对。");
      roster.reload();
    } finally { if (active.current) setBusy(false); }
  };
  const toggle = (id: string) => {
    if (allFiltered) setExcluded(current => { const next = { ...current }; if (next[id]) delete next[id]; else next[id] = true; return next; });
    else setSelected(current => {
      const next = { ...current }; if (next[id]) delete next[id]; else next[id] = roster.page?.revisions[id] ?? ""; return next;
    });
  };
  const heads = whitelist ? ["序号", "客户类型", "大区", "分公司名称", "经销商名称（简）", "经销商名称（全）", "经销商姓名", "经销商电话", "分公司确认人姓名", "分公司确认人电话", "状态", "操作"]
    : ["序号", "分公司", "参会人姓名", "性别", "联系电话", "参会人员类型", "经销商名称", "白名单关联", "操作"];
  return <>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className={`data-filters ${whitelist ? "" : "attendance-filters"}`}>
        <label><span>客户类型</span><select value={query.customerType} onChange={e => change({ customerType: e.target.value })}><option value="">全部</option>{(whitelist ? ["GENERAL", "SPECIAL", "ALL"] : customerTypeMode === "UNSPECIFIED" ? ["ALL"] : response?.customerTypes ?? []).map(type => <option key={type} value={type}>{typeLabels[type] || type}</option>)}</select></label>
        {!whitelist && <label><span>分公司</span><select value={query.branch} onChange={e => change({ branch: e.target.value })}><option value="">全部</option>{response?.branches.map(branch => <option key={branch}>{branch}</option>)}</select></label>}
        {whitelist ? <label><span>状态</span><select value={query.status} onChange={e => change({ status: e.target.value })}><option value="">全部</option><option>有效</option><option>待处理</option></select></label>
          : <label><span>关联状态</span><select value={query.matchStatus} onChange={e => change({ matchStatus: e.target.value })}><option value="">全部</option>{Object.entries(attendanceMatchLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>}
        <label className="data-filter-search"><span>{whitelist ? "搜索白名单" : "搜索到场客户"}</span><input type="search" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder={whitelist ? "经销商名称 / 姓名 / 电话" : "姓名 / 联系电话 / 经销商名称"} /></label>
        <small>{pending ? "正在加载…" : `符合条件 ${total} 名 · 第 ${query.page}/${pages} 页`}</small>
      </div>
      {error && <p className="warning-box" role="alert">{error}</p>}
      {allowDelete && (response?.summary.total ?? 0) > 0 && <div className="selection-toolbar selection-toolbar-all"><span>当前名单 <b>{response?.summary.total}</b> 名</span><button className="selection-delete" disabled={pending} onClick={() => void prepare(undefined, true)}>清空当前{whitelist ? "白名单" : "名单"}</button></div>}
      {allowDelete && (selectedCount > 0 || allFiltered) && <div className="selection-toolbar"><span>已选择 <b>{selectedCount}</b> 名{allFiltered ? Object.keys(excluded).length ? `（筛选结果，已排除 ${Object.keys(excluded).length} 名）` : "（全部筛选结果）" : ""}</span><div>{!allFiltered && total > ids.length && <button disabled={pending} onClick={() => { setSelected({}); setExcluded({}); setAllFiltered(true); }}>选择全部 {total} 名</button>}<button onClick={() => { setSelected({}); setAllFiltered(false); setExcluded({}); }}>取消选择</button><button className="selection-delete" disabled={pending || selectedCount === 0} onClick={() => void prepare()}>删除所选</button></div></div>}
      <div className="table-scroll" aria-busy={pending}><div className={`data-table ${whitelist ? "whitelist-table" : "attendance-table"} ${allowDelete ? "with-selection" : ""}`}>
        <div className="table-row table-head">{allowDelete && <b className="select-cell"><input type="checkbox" aria-label="全选当前页" disabled={pending} checked={pageSelected} onChange={() => allFiltered ? setExcluded(current => {
          const next = { ...current }; ids.forEach(id => { if (pageSelected) next[id] = true; else delete next[id]; }); return next;
        }) : setSelected(current => {
          const next = { ...current }; ids.forEach(id => { if (pageSelected) delete next[id]; else next[id] = roster.page?.revisions[id] ?? ""; }); return next;
        })} /></b>}{heads.map(head => <b key={head}>{head}</b>)}</div>
        {rows.map((row, index) => {
          const number = (query.page - 1) * query.size + index + 1;
          const values = "dealerFull" in row ? [number, row.customerType || "不区分客户类型", row.region, row.branch, row.dealerShort, row.dealerFull, row.dealerName, row.dealerPhone, row.confirmerName, row.confirmerPhone, row.status]
            : [number, row.branch, row.dealerName, row.gender, row.contactPhone, row.participantType, row.dealerCompany, attendanceMatchLabels[row.matchStatus ?? "UNMATCHED"]];
          return <div className={`table-row ${row.manuallyEdited ? "manually-edited-row" : ""}`} key={row.id}>{allowDelete && <span className="select-cell"><input type="checkbox" aria-label={`选择记录 ${row.id}`} checked={allFiltered ? !excluded[row.id] : Boolean(selected[row.id])} onChange={() => toggle(row.id)} /></span>}{values.map((value, i) => "matchStatus" in row && i === 7
            ? <span key={i} className={`attendance-match-status ${(row.matchStatus || "UNMATCHED").toLowerCase()}`}><b>{value}</b><small>{row.matchMethod ? attendanceMethodLabels[row.matchMethod] : attendanceReasonLabels[row.matchReasonCode || ""] || "—"}</small></span>
            : <span key={i} className={whitelist && i === 10 ? "status-cell" : undefined}>{value || "—"}</span>)}<span className="table-row-actions"><button disabled={readOnly || pending} onClick={() => onEdit(row)}>编辑</button>{allowDelete && <button disabled={pending} onClick={() => void prepare([row.id])}>删除</button>}</span></div>;
        })}
        {rows.length === 0 && <div className="table-empty">{pending ? "正在加载名单…" : "当前搜索和筛选条件下没有记录"}</div>}
      </div></div>
      <div className="table-pagination"><span>共 {total} 名</span><div><label>每页<select value={query.size} onChange={e => change({ size: Number(e.target.value) })}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select>名</label><button disabled={pending || query.page <= 1} onClick={() => roster.change({ page: 1 })}>首页</button><button disabled={pending || query.page <= 1} onClick={() => roster.change({ page: query.page - 1 })}>上一页</button><b>{query.page} / {pages}</b><button disabled={pending || query.page >= pages} onClick={() => roster.change({ page: query.page + 1 })}>下一页</button><button disabled={pending || query.page >= pages} onClick={() => roster.change({ page: pages })}>末页</button></div></div>
    </fieldset>
    {confirmation && <div className="delete-confirm" role="dialog" aria-modal="true" aria-label="删除名单确认"><div><h3>确认删除 {confirmation.count} 名{whitelist ? "白名单客户" : "到场客户"}？</h3><p>{whitelist ? "将从当前有效白名单中移除，已有订单不会被删除。" : "将移除所选到场记录，并更新现场抽奖资格。"}确认后如名单发生变化，本次操作会取消。</p><div className="delete-confirm-actions"><button disabled={busy} onClick={() => setConfirmation(null)}>取消</button><button className="delete-confirm-danger" disabled={busy} onClick={() => void confirm()}>{busy ? "正在删除…" : "确认删除"}</button></div></div></div>}
  </>;
}
