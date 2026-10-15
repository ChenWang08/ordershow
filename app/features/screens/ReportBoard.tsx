"use client";

import { useEffect, useState } from "react";
import { ApiError, apiBase, getActiveActivityCode, loadDashboardReport, type DashboardReport, type RuntimeActivity } from "../../api";
import { FestivalDecor } from "../shared/components/FestivalDecor";
import { isUnspecifiedCustomerTypeActivity } from "./dashboard-domain";
import { MetricTable } from "./ReportMetricTable";
import { createRefreshQueue } from "./refresh-queue";

const reports = [
  "特渠专业客户 TOP5",
  "综合客户 TOP5",
  "总战绩",
  "特渠专业客户金额、综合客户金额及合计",
  "综合客户各大区金额及合计",
  "礼盒：特渠专业客户金额、综合客户金额及合计",
  "综合客户各项目组金额及合计",
  "特渠专业客户与综合客户各项目组金额及合计",
  "综合客户大区金额与项目组金额同屏展示",
];

export function ReportBoard({ activity }: { activity: RuntimeActivity | null }) {
  const [report, setReport] = useState(reports[2]);
  const [data, setData] = useState<DashboardReport | null>(null);
  const [error, setError] = useState("");
  const historical = activity?.status === "FINISHED" || activity?.status === "ARCHIVED";
  const unspecifiedCustomerType = isUnspecifiedCustomerTypeActivity(activity);
  useEffect(() => {
    let active = true;
    if (unspecifiedCustomerType) {
      return () => { active = false; };
    }
    const queue = createRefreshQueue(async () => {
      try { const next = await loadDashboardReport(report); if (active) { setData(next); setError(""); } }
      catch (reason) { if (active) setError(reason instanceof ApiError ? reason.message : "战报数据加载失败"); }
    });
    const refresh = queue.refresh;
    void refresh();
    if (historical) return () => { active = false; queue.dispose(); };
    const timer = window.setInterval(refresh, 15000);
    const events = new EventSource(`${apiBase()}/screen/activities/${encodeURIComponent(getActiveActivityCode())}/events`);
    events.addEventListener("invalidate", () => void refresh());
    events.addEventListener("open", () => void refresh());
    return () => { active = false; queue.dispose(); window.clearInterval(timer); events.close(); };
  }, [activity?.id, report, historical, unspecifiedCustomerType]);
  const isTop = report.includes("TOP5");
  const isTotal = report === "总战绩";
  const isDual = report === reports[8];
  const displayTitles: Record<string, string> = {
    "特渠专业客户金额、综合客户金额及合计": "特渠专业客户+综合客户",
    "礼盒：特渠专业客户金额、综合客户金额及合计": "礼盒",
    "综合客户各项目组金额及合计": "综合客户",
    "特渠专业客户与综合客户各项目组金额及合计": "特渠专业客户+综合客户",
  };
  const displayTitle = displayTitles[report] ?? report;
  const typeValues = (report.includes("礼盒") ? data?.giftCustomerTypes : data?.customerTypes) ?? [];
  const typeAmount = (type: string) => Number(typeValues.find((item) => item.customerType === type)?.amount ?? 0);
  const reportRegions = data?.generalRegions ?? (activity?.regions ?? []).map((region) => ({ regionCode: region.code, regionName: region.name, sortNo: region.sortNo,
    orderCount: Number(data?.regions.find((item) => item.regionCode === region.code)?.orderCount ?? 0),
    amount: Number(data?.regions.find((item) => item.regionCode === region.code)?.amount ?? 0), productLines: [] }));
  const regionLabels = reportRegions.map((region) => region.regionName);
  const regionValues = reportRegions.map((region) => Number(region.amount));
  const productLineRows = report === "综合客户各项目组金额及合计"
    ? data?.generalProductLines ?? []
    : data?.dashboard.productLines ?? [];
  const topRows = report.startsWith("特渠") ? data?.topSpecial ?? [] : data?.topGeneral ?? [];
  const totalAmount = Number(data?.dashboard.totals.total_amount ?? 0);
  return (
    <section className="screen-board report-board">
      <FestivalDecor />
      <header className="report-header">
        <span className="report-heading-placeholder" aria-hidden="true">调味品事业部新品发布及旺季动员会</span>
        <h1><span className="report-heading-placeholder" aria-hidden="true">月满家圆 · 味启新程</span>{historical && <small> · 历史回看</small>}</h1>
        <label>当前看板：
          <select value={report} disabled={unspecifiedCustomerType} onChange={(e) => setReport(e.target.value)}>
            {reports.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </header>
      {error && !unspecifiedCustomerType && <div className="warning-box"><b>{historical ? "历史战报加载异常" : "实时数据连接异常"}</b><span>{error}</span></div>}
      {unspecifiedCustomerType ? <div className="screen-data-unavailable" role="status"><strong>当前活动未区分客户类型</strong><span>白名单客户类型全部为空，暂不展示专题战报数据。</span></div> : <div className={`report-content ${isDual ? "dual" : ""}`}>
        {isTotal ? (
          <div className="total-performance"><span>总战绩</span><strong>{totalAmount >= 100000000 ? (totalAmount / 100000000).toFixed(2) : totalAmount.toLocaleString()}<small>{totalAmount >= 100000000 ? "亿" : "元"}</small></strong></div>
        ) : isTop ? (
          <div className="top-five">
            <i className="metric-frame-corner corner-tl" aria-hidden="true" /><i className="metric-frame-corner corner-tr" aria-hidden="true" /><i className="metric-frame-corner corner-bl" aria-hidden="true" /><i className="metric-frame-corner corner-br" aria-hidden="true" />
            <h2>{report}</h2>
            {topRows.map((item) => <div key={item.name}><span>{item.rank}</span><b>{item.name}<small> · {Number(item.amount).toLocaleString()} 元</small></b></div>)}
            {topRows.length === 0 && <div className="order-empty-row">暂无有效订单</div>}
          </div>
        ) : isDual ? (
          <>
            <MetricTable kind="area" title="综合客户 · 大区" labels={regionLabels} values={regionValues} />
            <MetricTable kind="product" title="综合客户 · 项目组" labels={(data?.generalProductLines ?? []).map((item) => item.productLine)} values={(data?.generalProductLines ?? []).map((item) => Number(item.amount))} />
          </>
        ) : report.includes("项目组") ? (
          <MetricTable kind="product" title={displayTitle} labels={productLineRows.map((item) => item.productLine)} values={productLineRows.map((item) => Number(item.amount))} />
        ) : report.includes("各大区") ? (
          <MetricTable kind="area" title="综合客户" labels={regionLabels} values={regionValues} />
        ) : (
          <MetricTable title={displayTitle} labels={["特渠专业客户", "综合客户"]} values={[typeAmount("SPECIAL"), typeAmount("GENERAL")]} />
        )}
      </div>}
    </section>
  );
}
