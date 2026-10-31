"use client";

import { useMemo, useState } from "react";
import { loadDashboard, loadRankingOptions, type RuntimeActivity } from "../../api";
import { FestivalDecor } from "../shared/components/FestivalDecor";
import { useManualScreenData } from "./useManualScreenData";
import { ScreenRefreshControls } from "./ScreenRefreshControls";
import { initialRankingSelection, rankingChoices, rankingFilters, rankingOptionText, rankingSelectionKey, type RankingSelection } from "./ranking-filters";

const branchPageSize = 30;
function readRanking(selection: RankingSelection, signal: AbortSignal) {
  return loadDashboard(rankingFilters(selection), signal);
}
function readOptions(_parameters: null, signal: AbortSignal) { return loadRankingOptions(signal); }

export function RankingBoard({ activity }: { activity: RuntimeActivity | null }) {
  const [draft, setDraft] = useState<{ activityId: number | null; selection: RankingSelection }>({ activityId: activity?.id ?? null, selection: initialRankingSelection });
  if (draft.activityId !== (activity?.id ?? null)) setDraft({ activityId: activity?.id ?? null, selection: initialRankingSelection });
  const selection = draft.activityId === (activity?.id ?? null) ? draft.selection : initialRankingSelection;
  const updateSelection = (patch: Partial<RankingSelection>) => setDraft({ activityId: activity?.id ?? null, selection: { ...selection, ...patch } });
  const { data: options, error: optionsError, refreshing: optionsLoading, refresh: refreshOptions } = useManualScreenData(
    activity?.id ?? null, readOptions, null, "筛选选项加载失败",
  );
  const { data: dashboard, parameters, error, refreshing, refreshedAt, refresh } = useManualScreenData(
    activity?.id ?? null, readRanking, initialRankingSelection, "排行数据加载失败", true, false,
  );
  const appliedSelection = parameters ?? initialRankingSelection;
  const status = dashboard?.status ?? activity?.status;
  const historical = status === "FINISHED" || status === "ARCHIVED";
  const choices = useMemo(() => rankingChoices(options), [options]);
  const pendingSelection = parameters !== null && rankingSelectionKey(selection) !== rankingSelectionKey(appliedSelection);
  const metric = selection.metric;
  const validSelection = selection.varieties === null || selection.varieties.length > 0;
  const labels: Record<string, string> = { ALL: "全部客户", GENERAL: "综合客户", SPECIAL: "特渠专业客户" };
  const regionLabel = choices.regions.find(([value]) => value === appliedSelection.region)?.[1] ?? rankingOptionText(appliedSelection.region);
  const appliedSummary = `${labels[appliedSelection.customerType]} · 大区：${regionLabel} · 项目组：${rankingOptionText(appliedSelection.productLine)} · 品种：${appliedSelection.varieties === null ? "全部" : appliedSelection.varieties.map(rankingOptionText).join("、")}`;
  const confirm = () => { if (validSelection) { void refresh(selection); void refreshOptions(); } };
  const ranking = dashboard?.companies ?? [];
  const branchRanking = dashboard?.branches ?? [];
  const chunkSize = Math.max(1, Math.ceil(ranking.length / 3));
  const columnStarts = [0, chunkSize, chunkSize * 2].filter(start => start === 0 || start < ranking.length);
  const isBranchOverflowing = branchRanking.length > branchPageSize;
  const totalAmount = Number(dashboard?.totals.total_amount ?? 0);
  const totalTons = dashboard?.totals.total_tons;
  const tonnageRanking = appliedSelection.metric === "TONS";
  const rankingTitle = tonnageRanking ? "订货吨数排行" : "订货排行";
  const rankingValue = (row: { amount: number; tons?: number | null }) => {
    if (tonnageRanking) return `${Number(row.tons ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}吨`;
    return `${Number(row.amount).toLocaleString()}元`;
  };

  return (
    <section className="screen-board ranking-board">
      <FestivalDecor />
      <header className="screen-title">
        <div className="screen-metric"><span>订单金额</span><strong>{dashboard ? totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}<small>元</small></strong></div>
        <div className="ranking-heading">
          <h1>客户{rankingTitle}{historical && <small> · 历史回看</small>}</h1>
          <div className="ranking-metric-switch" role="tablist" aria-label="排行口径">
            <button type="button" role="tab" aria-selected={metric === "AMOUNT"} className={metric === "AMOUNT" ? "active" : ""} disabled={refreshing} onClick={() => updateSelection({ metric: "AMOUNT" })}>金额排行</button>
            <button type="button" role="tab" aria-selected={metric === "TONS"} className={metric === "TONS" ? "active" : ""} disabled={refreshing} onClick={() => updateSelection({ metric: "TONS" })}>吨数排行</button>
          </div>
          <div className="ranking-filters" aria-label="排行筛选">
            <label>客户类型<select aria-label="客户类型" value={selection.customerType} disabled={refreshing || !options} onChange={e => updateSelection({ customerType: e.target.value })}>
              <option value="ALL">全部客户</option>{choices.customerTypes.map(type => <option key={type} value={type}>{labels[type]}</option>)}
            </select></label>
            <label>大区<select aria-label="大区" value={selection.region} disabled={refreshing || !options} onChange={e => updateSelection({ region: e.target.value })}>
              <option value="all">全部</option>{choices.regions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>项目组<select aria-label="项目组" value={selection.productLine} disabled={refreshing || !options} onChange={e => updateSelection({ productLine: e.target.value })}>
              <option value="all">全部</option>{choices.lines.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <details className="ranking-varieties"><summary aria-label="品种多选" aria-disabled={refreshing || !options}>品种：{selection.varieties === null ? "全部" : `已选 ${selection.varieties.length} 项`}</summary>
              <fieldset disabled={refreshing || !options}><legend>选择品种</legend>
                <label><input type="checkbox" checked={selection.varieties === null} onChange={e => updateSelection({ varieties: e.target.checked ? null : [] })} />全部品种</label>
                {choices.varieties.map(([value, label]) => <label key={value}><input type="checkbox" checked={selection.varieties?.includes(value) ?? false} onChange={e => updateSelection({ varieties: e.target.checked ? [...(selection.varieties ?? []), value] : (selection.varieties ?? []).filter(v => v !== value) })} />{label}</label>)}
              </fieldset>
            </details>
            <button type="button" className="ranking-confirm" disabled={!activity || !options || refreshing || !validSelection} onClick={confirm}>{refreshing ? "查询中…" : "确认查询"}</button>
            <button type="button" disabled={refreshing} onClick={() => updateSelection(initialRankingSelection)}>重置</button>
          </div>
          {optionsLoading && !options && <p className="screen-filter-pending">正在加载筛选选项…</p>}
          {optionsError && <p role="alert" className="screen-filter-pending">{optionsError}<button type="button" onClick={() => void refreshOptions()}>重试选项</button></p>}
          {!validSelection && <p role="status" className="screen-filter-pending">请至少选择一个品种，或选择全部品种</p>}
          <p className="ranking-applied" aria-live="polite">{dashboard ? `当前结果：${appliedSummary} · ${tonnageRanking ? "吨数排行" : "金额排行"}` : "设置筛选条件后，点击确认查询"}</p>
          <ScreenRefreshControls refreshing={refreshing} refreshedAt={refreshedAt} historical={historical} disabled={!activity || !dashboard} onRefresh={() => { if (parameters) { void refresh(parameters); void refreshOptions(); } }} />
          {pendingSelection && <p className="screen-filter-pending" role="status">条件待确认；点击确认查询应用新条件，手动刷新仍使用当前结果条件</p>}
        </div>
        <div className="screen-metric"><span>累计订货</span><strong>{dashboard ? Number(totalTons ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 }) : "—"}<small>吨</small></strong></div>
      </header>
      {error && <div className="warning-box" role="alert"><b>排行刷新失败</b><span>{error}。{dashboard ? "当前显示上次成功加载的数据，请点击确认查询或手动刷新重试。" : "请点击确认查询重试。"}</span></div>}
      <div className="ranking-layout">
        <div className="ranking-columns">
          {columnStarts.map((start) => (
            <div className="rank-column" key={start}>
              <h2>公司{tonnageRanking ? "订货吨数" : "订单金额"}排行 {ranking.length ? start + 1 : 0}–{Math.min(start + chunkSize, ranking.length)}<small>单位：{tonnageRanking ? "吨" : "元"}</small></h2>
              {ranking.slice(start, start + chunkSize).map((item) => (
                <div className={`rank-row ${item.rank <= 3 ? "top-three" : ""}`} key={item.rank}>
                  <span className={item.rank <= 6 ? "crown" : ""}><i aria-hidden="true">{item.rank <= 6 ? "♛" : ""}</i> {item.rank}</span>
                  <b>{item.name}</b>
                  <strong>{rankingValue(item)}</strong>
                </div>
              ))}
              {ranking.length === 0 && start === 0 && <div className="order-empty-row">{!dashboard ? "尚未查询" : tonnageRanking ? "当前条件下暂无可计算吨数" : "当前条件下暂无有效订单"}</div>}
            </div>
          ))}
        </div>
        <aside className={`branch-rank${isBranchOverflowing ? " branch-rank-scrollable" : ""}`}>
          <h2>分公司{tonnageRanking ? "吨数榜" : "订货榜"}</h2>
          {branchRanking.map((branch, index) => (
            <div className={index < 5 ? "branch-top-five" : ""} key={branch.name}><span className={index < 5 ? "crown" : ""}><i aria-hidden="true">{index < 5 ? "♛" : ""}</i> {index + 1}</span><b>{branch.name || "未分公司"}</b><strong>{rankingValue(branch)}</strong></div>
          ))}
          {branchRanking.length === 0 && <div className="order-empty-row">{!dashboard ? "尚未查询" : tonnageRanking ? "当前条件下暂无可计算吨数" : "当前条件下暂无分公司数据"}</div>}
        </aside>
      </div>
    </section>
  );
}
