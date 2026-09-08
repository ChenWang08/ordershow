"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, apiBase, getActiveActivityCode, loadDashboard, type DashboardData, type RuntimeActivity } from "../../api";
import { FestivalDecor } from "../shared/components/FestivalDecor";
import { isUnspecifiedCustomerTypeActivity } from "./dashboard-domain";

const branchPageSize = 30;
export function RankingBoard({ activity }: { activity: RuntimeActivity | null }) {
  const [channel, setChannel] = useState("ALL");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const historical = activity?.status === "FINISHED" || activity?.status === "ARCHIVED";
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
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [customerType, regionCode] = effectiveChannel.split(":");
      try {
        const data = await loadDashboard({ customerType, regionCode });
        if (active) { setDashboard(data); setError(""); }
      } catch (reason) { if (active) setError(reason instanceof ApiError ? reason.message : "看板数据加载失败"); }
    };
    void refresh();
    if (historical) return () => { active = false; };
    const timer = window.setInterval(refresh, 15000);
    const events = new EventSource(`${apiBase()}/screen/activities/${encodeURIComponent(getActiveActivityCode())}/events`);
    events.addEventListener("invalidate", () => void refresh());
    return () => { active = false; window.clearInterval(timer); events.close(); };
  }, [effectiveChannel, historical, unspecifiedCustomerType]);
  const ranking = dashboard?.companies ?? [];
  const branchRanking = dashboard?.branches ?? [];
  const chunkSize = Math.max(1, Math.ceil(ranking.length / 3));
  const isBranchOverflowing = branchRanking.length > branchPageSize;
  const selectedLabel = options.find((option) => option.value === effectiveChannel)?.label ?? "订货";
  const totalAmount = Number(dashboard?.totals.total_amount ?? 0);
  const totalTons = dashboard?.totals.total_tons;

  return (
    <section className="screen-board ranking-board">
      <FestivalDecor />
      <header className="screen-title">
        <div className="screen-metric"><span>订单金额</span><strong>{totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small>元</small></strong></div>
        <div className="ranking-heading">
          <h1>{selectedLabel}订货排行{historical && <small> · 历史回看</small>}</h1>
          <label>当前看板
            <select value={effectiveChannel} onChange={(e) => setChannel(e.target.value)}>
              {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>
        <div className="screen-metric"><span>累计订货</span><strong>{totalTons == null ? "待完善" : Number(totalTons).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}<small>{totalTons == null ? "" : "吨"}</small></strong></div>
      </header>
      {error && <div className="warning-box"><b>{historical ? "历史看板加载异常" : "实时数据连接异常"}</b><span>{error}</span></div>}
      <div className="ranking-layout">
        <div className="ranking-columns">
          {[0, chunkSize, chunkSize * 2].map((start) => (
            <div className="rank-column" key={start}>
              <h2>公司订单金额排行 {ranking.length ? start + 1 : 0}–{Math.min(start + chunkSize, ranking.length)}<small>单位：元</small></h2>
              {ranking.slice(start, start + chunkSize).map((item) => (
                <div className={`rank-row ${item.rank <= 3 ? "top-three" : ""}`} key={item.rank}>
                  <span className={item.rank <= 6 ? "crown" : ""}><i aria-hidden="true">{item.rank <= 6 ? "♛" : ""}</i> {item.rank}</span>
                  <b>{item.name}</b>
                  <strong>{Number(item.amount).toLocaleString()}元</strong>
                </div>
              ))}
              {ranking.length === 0 && start === 0 && <div className="order-empty-row">暂无有效订单</div>}
            </div>
          ))}
        </div>
        <aside className={`branch-rank${isBranchOverflowing ? " branch-rank-scrollable" : ""}`}>
          <h2>分公司订货榜</h2>
          {branchRanking.map((branch, index) => (
            <div className={index < 5 ? "branch-top-five" : ""} key={branch.name}><span className={index < 5 ? "crown" : ""}><i aria-hidden="true">{index < 5 ? "♛" : ""}</i> {index + 1}</span><b>{branch.name || "未分公司"}</b><strong>{Number(branch.amount).toLocaleString()}元</strong></div>
          ))}
          {branchRanking.length === 0 && <div className="order-empty-row">暂无分公司数据</div>}
        </aside>
      </div>
    </section>
  );
}
