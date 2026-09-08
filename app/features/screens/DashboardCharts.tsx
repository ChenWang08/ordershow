"use client";

import { dashboardCompactAmount, dashboardChartPalette, type DashboardBarRow, type DashboardRankingRow } from "./dashboard-domain";

export function DashboardBars({ rows, color = "#2f96cc", maxAmount }: { rows: DashboardBarRow[]; color?: string; maxAmount?: number }) {
  const max = Math.max(maxAmount ?? 0, ...rows.map((row) => row.amount), 1);
  return <div className="order-dashboard-bars">{rows.map((row, index) => <div className="order-dashboard-bar" key={`${row.name}-${index}`}>
    <span>{row.name}</span><div><i style={{ width: row.amount <= 0 ? "0%" : `${Math.max(2, row.amount / max * 100)}%`, background: row.color ?? color }} /></div><b>{dashboardCompactAmount(row.amount)}</b>{row.note && <small>{row.note}</small>}
  </div>)}</div>;
}

export function DashboardTopRanking({ rows, type }: { rows: DashboardRankingRow[]; type: "branch" | "dealer" }) {
  const max = Math.max(...rows.map((row) => Number(row.amount)), 1);
  return <div className="order-dashboard-top-ranking">{rows.map((row, index) => {
    const accent = dashboardChartPalette[index % dashboardChartPalette.length];
    return <div className="order-dashboard-ranking-row" key={`${row.rank}-${row.name}`}>
      <span>{row.rank}</span><p><b>{row.name}</b>{type === "dealer" && <small>{row.branch || "未分公司"}</small>}</p><strong>{(Number(row.amount) / 10000).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}万</strong><i><em style={{ width: `${Number(row.amount) / max * 100}%`, background: accent }} /></i>
    </div>;
  })}</div>;
}
