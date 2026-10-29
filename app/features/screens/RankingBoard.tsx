"use client";

import { useMemo, useState } from "react";
import { loadDashboard, type RankingMetric, type RuntimeActivity } from "../../api";
import { FestivalDecor } from "../shared/components/FestivalDecor";
import { isUnspecifiedCustomerTypeActivity } from "./dashboard-domain";
import { useManualScreenData } from "./useManualScreenData";
import { ScreenRefreshControls } from "./ScreenRefreshControls";

const branchPageSize = 30;
type RankingSelection = { channel: string; metric: RankingMetric };
const initialSelection: RankingSelection = { channel: "ALL", metric: "AMOUNT" };

function readRanking(selection: RankingSelection, signal: AbortSignal) {
  const [customerType, regionCode] = selection.channel.split(":");
  return loadDashboard({ customerType, regionCode, metric: selection.metric }, signal);
}

export function RankingBoard({ activity }: { activity: RuntimeActivity | null }) {
  const [channel, setChannel] = useState("ALL");
  const [metric, setMetric] = useState<RankingMetric>("AMOUNT");
  const { data: dashboard, parameters, error, refreshing, refreshedAt, refresh } = useManualScreenData(
    activity?.id ?? null, readRanking, initialSelection, "排行数据加载失败",
  );
  const appliedSelection = parameters ?? initialSelection;
  const status = dashboard?.status ?? activity?.status;
  const historical = status === "FINISHED" || status === "ARCHIVED";
  const unspecifiedCustomerType = isUnspecifiedCustomerTypeActivity(activity);
  const options = useMemo(() => [
    { value: "ALL", label: "全部客户" },
    ...(unspecifiedCustomerType ? [] : [
      { value: "SPECIAL", label: "特渠专业客户" },
      ...(activity?.regions?.length
        ? activity.regions.map((region) => ({ value: `GENERAL:${region.code}`, label: `综合${region.name}` }))
        : [{ value: "GENERAL", label: "综合客户" }]),
    ]),
  ], [activity, unspecifiedCustomerType]);
  const effectiveChannel = options.some((option) => option.value === channel) ? channel : options[0]?.value ?? "ALL";
  const pendingSelection = effectiveChannel !== appliedSelection.channel || metric !== appliedSelection.metric;
  const ranking = dashboard?.companies ?? [];
  const branchRanking = dashboard?.branches ?? [];
  const chunkSize = Math.max(1, Math.ceil(ranking.length / 3));
  const columnStarts = [0, chunkSize, chunkSize * 2].filter(start => start === 0 || start < ranking.length);
  const isBranchOverflowing = branchRanking.length > branchPageSize;
  const selectedLabel = options.find((option) => option.value === appliedSelection.channel)?.label ?? "订货";
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
        <div className="screen-metric"><span>订单金额</span><strong>{totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small>元</small></strong></div>
        <div className="ranking-heading">
          <h1>{selectedLabel}{rankingTitle}{historical && <small> · 历史回看</small>}</h1>
          <div className="ranking-metric-switch" role="tablist" aria-label="排行口径">
            <button type="button" role="tab" aria-selected={metric === "AMOUNT"} className={metric === "AMOUNT" ? "active" : ""} disabled={refreshing} onClick={() => setMetric("AMOUNT")}>金额排行</button>
            <button type="button" role="tab" aria-selected={metric === "TONS"} className={metric === "TONS" ? "active" : ""} disabled={refreshing} onClick={() => setMetric("TONS")}>吨数排行</button>
          </div>
          <label>当前看板
            <select value={effectiveChannel} disabled={refreshing} onChange={(e) => setChannel(e.target.value)}>
              {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <ScreenRefreshControls refreshing={refreshing} refreshedAt={refreshedAt} historical={historical} disabled={!activity} onRefresh={() => void refresh({ channel: effectiveChannel, metric })} />
          {pendingSelection && <p className="screen-filter-pending" role="status">筛选待应用，点击手动刷新更新排行</p>}
        </div>
        <div className="screen-metric"><span>累计订货</span><strong>{Number(totalTons ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}<small>吨</small></strong></div>
      </header>
      {error && <div className="warning-box" role="alert"><b>排行刷新失败</b><span>{error}。{dashboard ? "当前显示上次成功加载的数据，请点击手动刷新重试。" : "请点击手动刷新重试。"}</span></div>}
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
              {ranking.length === 0 && start === 0 && <div className="order-empty-row">{tonnageRanking ? "暂无可计算吨数" : "暂无有效订单"}</div>}
            </div>
          ))}
        </div>
        <aside className={`branch-rank${isBranchOverflowing ? " branch-rank-scrollable" : ""}`}>
          <h2>分公司{tonnageRanking ? "吨数榜" : "订货榜"}</h2>
          {branchRanking.map((branch, index) => (
            <div className={index < 5 ? "branch-top-five" : ""} key={branch.name}><span className={index < 5 ? "crown" : ""}><i aria-hidden="true">{index < 5 ? "♛" : ""}</i> {index + 1}</span><b>{branch.name || "未分公司"}</b><strong>{rankingValue(branch)}</strong></div>
          ))}
          {branchRanking.length === 0 && <div className="order-empty-row">{tonnageRanking ? "暂无可计算吨数" : "暂无分公司数据"}</div>}
        </aside>
      </div>
    </section>
  );
}
