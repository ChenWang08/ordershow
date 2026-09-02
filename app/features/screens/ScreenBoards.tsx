"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiBase, getActiveActivityCode, loadDashboard, loadDashboardReport, loadOrderDashboard, type DashboardData, type DashboardReport, type RuntimeActivity } from "../../api";
import { FestivalDecor } from "../shared/components/FestivalDecor";

const branchPageSize = 30;
const reports = [
  "特渠专业客户 TOP5",
  "综合客户 TOP5",
  "总战绩",
  "特渠专业客户金额、综合客户金额及合计",
  "综合客户各片区金额及合计",
  "礼盒：特渠专业客户金额、综合客户金额及合计",
  "综合客户各产品线金额及合计",
  "特渠专业客户与综合客户各产品线金额及合计",
  "综合客户区域金额与产品线金额同屏展示",
];

export function RankingBoard({ activity }: { activity: RuntimeActivity | null }) {
  const [channel, setChannel] = useState("SPECIAL");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const historical = activity?.status === "FINISHED" || activity?.status === "ARCHIVED";
  const options = useMemo(() => [
    { value: "SPECIAL", label: "特渠专业客户" },
    ...(activity?.regions?.length
      ? activity.regions.map((region) => ({ value: `GENERAL:${region.code}`, label: `综合${region.name}` }))
      : [{ value: "GENERAL", label: "综合客户" }]),
  ], [activity]);
  const effectiveChannel = options.some((option) => option.value === channel) ? channel : options[0]?.value ?? "SPECIAL";
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
  }, [effectiveChannel, historical]);
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

function dashboardCompactAmount(value: number) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

type DashboardBarRow = { name: string; amount: number; note?: string; color?: string };

const dashboardChartPalette = [
  "#f3c900", "#a85d16", "#ed7d22", "#25ad77", "#e74c3c", "#8e55b2", "#3395ca", "#e59b18", "#d94f87", "#5968d8",
  "#14a6a6", "#70ad24", "#d66b52", "#6e4bb5", "#1688b8", "#c18a12", "#bf3f63", "#3c9b68", "#7b6b3a", "#446fca",
];
const dashboardRegionPalette = ["#f3a211", "#ed5046", "#3495ca", "#8e55b2", "#24b89b", "#a85d16"];

function dashboardColorFor(label: string, palette = dashboardChartPalette) {
  let hash = 0;
  for (const character of label) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function DashboardBars({ rows, color = "#2f96cc", maxAmount }: { rows: DashboardBarRow[]; color?: string; maxAmount?: number }) {
  const max = Math.max(maxAmount ?? 0, ...rows.map((row) => row.amount), 1);
  return <div className="order-dashboard-bars">{rows.map((row, index) => <div className="order-dashboard-bar" key={`${row.name}-${index}`}>
    <span>{row.name}</span><div><i style={{ width: row.amount <= 0 ? "0%" : `${Math.max(2, row.amount / max * 100)}%`, background: row.color ?? color }} /></div><b>{dashboardCompactAmount(row.amount)}</b>{row.note && <small>{row.note}</small>}
  </div>)}</div>;
}

function dashboardTrendTimestamp(bucket: string) {
  const normalized = bucket.includes("T") ? bucket : bucket.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`).getTime();
}

function dashboardHourlyTrend(rows: DashboardReport["trend"], activity: RuntimeActivity | null, generatedAt?: string) {
  if (!activity) return [];
  const hour = 60 * 60 * 1000;
  const values = new Map(rows.map((row) => [Math.floor(dashboardTrendTimestamp(row.bucket) / hour) * hour, row]));
  const activityStart = new Date(activity.actualStartedAt ?? activity.startsAt).getTime();
  const liveEnd = generatedAt ? new Date(generatedAt).getTime() : Date.now();
  const activityEnd = new Date(activity.closedAt ?? activity.endsAt).getTime();
  const start = Math.floor(activityStart / hour) * hour;
  const end = Math.floor(Math.min(liveEnd, activityEnd) / hour) * hour;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const result: DashboardReport["trend"] = [];
  for (let time = start; time <= end; time += hour) {
    const existing = values.get(time);
    result.push(existing ?? { bucket: new Date(time).toISOString(), amount: 0, orders: 0 });
  }
  return result;
}

function dashboardSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "M 36 112 L 98 112";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const slopes = points.slice(0, -1).map((point, index) => (points[index + 1].y - point.y) / (points[index + 1].x - point.x));
  const tangents = points.map((_, index) => index === 0 ? slopes[0] : index === points.length - 1 ? slopes[slopes.length - 1] : (slopes[index - 1] + slopes[index]) / 2);
  slopes.forEach((slope, index) => {
    if (slope === 0) { tangents[index] = 0; tangents[index + 1] = 0; return; }
    const firstRatio = tangents[index] / slope;
    const secondRatio = tangents[index + 1] / slope;
    if (firstRatio < 0 || secondRatio < 0) { tangents[index] = 0; tangents[index + 1] = 0; return; }
    const magnitude = firstRatio * firstRatio + secondRatio * secondRatio;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * firstRatio * slope;
      tangents[index + 1] = scale * secondRatio * slope;
    }
  });
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const distance = next.x - current.x;
    path += ` C ${current.x + distance / 3} ${current.y + tangents[index] * distance / 3}, ${next.x - distance / 3} ${next.y - tangents[index + 1] * distance / 3}, ${next.x} ${next.y}`;
  }
  return path;
}

type DashboardRankingRow = { rank: number; name: string; branch?: string; amount: number; quantity: number };

function DashboardTopRanking({ rows, type }: { rows: DashboardRankingRow[]; type: "branch" | "dealer" }) {
  const max = Math.max(...rows.map((row) => Number(row.amount)), 1);
  return <div className="order-dashboard-top-ranking">{rows.map((row, index) => {
    const accent = dashboardChartPalette[index % dashboardChartPalette.length];
    return <div className="order-dashboard-ranking-row" key={`${row.rank}-${row.name}`}>
      <span>{row.rank}</span><p><b>{row.name}</b>{type === "dealer" && <small>{row.branch || "未分公司"}</small>}</p><strong>{(Number(row.amount) / 10000).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}万</strong><i><em style={{ width: `${Number(row.amount) / max * 100}%`, background: accent }} /></i>
    </div>;
  })}</div>;
}

export function OrderDashboard({ activity }: { activity: RuntimeActivity | null }) {
  const [data, setData] = useState<DashboardReport | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTrendBucket, setSelectedTrendBucket] = useState<string | null>(null);
  const trendScrollRef = useRef<HTMLDivElement>(null);
  const trendDragRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const historical = activity?.status === "FINISHED" || activity?.status === "ARCHIVED";
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { setData(await loadOrderDashboard()); setError(""); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : "订单看板数据加载失败"); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial remote dashboard load
    void refresh();
    if (historical) return;
    const timer = window.setInterval(refresh, 15000);
    const events = new EventSource(`${apiBase()}/screen/activities/${encodeURIComponent(getActiveActivityCode())}/events`);
    events.addEventListener("invalidate", () => void refresh());
    return () => { window.clearInterval(timer); events.close(); };
  }, [historical, refresh]);

  const dashboard = data?.dashboard;
  const totals = dashboard?.totals ?? {};
  const amount = Number(totals.total_amount ?? 0);
  const types = data?.customerTypes ?? [];
  const generalAmount = Number(types.find((item) => item.customerType === "GENERAL")?.amount ?? 0);
  const specialAmount = Number(types.find((item) => item.customerType === "SPECIAL")?.amount ?? 0);
  const generalShare = amount ? generalAmount / amount * 100 : 0;
  const legacyGeneralRegions = (activity?.regions ?? []).map((region) => ({
    regionCode: region.code, regionName: region.name, sortNo: region.sortNo,
    amount: Number(data?.regions.find((item) => item.regionCode === region.code)?.amount ?? 0),
    orderCount: Number(data?.regions.find((item) => item.regionCode === region.code)?.orderCount ?? 0),
    productLines: (data?.generalProductLines ?? []).map((line) => {
      const value = data?.regionProductLines?.find((item) => item.regionCode === region.code && item.productLine === line.productLine);
      return { productLine: line.productLine, amount: Number(value?.amount ?? 0), quantity: Number(value?.quantity ?? 0) };
    }),
  }));
  const generalRegions = data?.generalRegions ?? legacyGeneralRegions;
  const regions = generalRegions.map((region, index) => ({
    name: region.regionName, amount: Number(region.amount), note: `${region.orderCount}单`,
    color: dashboardRegionPalette[index % dashboardRegionPalette.length],
  }));
  const trend = dashboardHourlyTrend(data?.trend ?? [], activity, dashboard?.generatedAt);
  const trendMax = Math.max(...trend.map((item) => Number(item.amount)), 1);
  const trendChartWidth = Math.max(720, Math.max(trend.length - 1, 1) * 62 + 72);
  const trendPoints = trend.map((item, index) => ({ x: 36 + index * 62, y: 112 - Number(item.amount) / trendMax * 92 }));
  const trendLinePath = dashboardSmoothPath(trendPoints);
  const trendAreaPath = trendPoints.length ? `${trendLinePath} L ${trendPoints[trendPoints.length - 1].x} 112 L ${trendPoints[0].x} 112 Z` : "";
  const selectedTrendIndex = selectedTrendBucket == null ? -1 : trend.findIndex((item) => item.bucket === selectedTrendBucket);
  const productLineColorMap = new Map((dashboard?.productLines ?? []).map((item, index) => [item.productLine || "其他", dashboardChartPalette[index % dashboardChartPalette.length]]));
  const productLineColor = (name: string) => productLineColorMap.get(name) ?? dashboardColorFor(name);
  const productLineRows = (dashboard?.productLines ?? []).slice(0, 6).map((item) => ({ name: item.productLine || "其他", amount: Number(item.amount), color: productLineColor(item.productLine || "其他") }));
  const specialChannelProductRows = (data?.specialProductLines ?? []).map((item) => ({ name: item.productLine || "其他", amount: Number(item.amount), color: productLineColor(item.productLine || "其他") }));
  const generalChannelProductRows = (data?.generalProductLines ?? []).map((item) => ({ name: item.productLine || "其他", amount: Number(item.amount), color: productLineColor(item.productLine || "其他") }));
  const regionProductCards = generalRegions.map((region, regionIndex) => ({
    code: region.regionCode,
    name: region.regionName,
    color: dashboardRegionPalette[regionIndex % dashboardRegionPalette.length],
    rows: region.productLines.map((row) => ({ name: row.productLine || "其他", amount: Number(row.amount), color: productLineColor(row.productLine || "其他") })),
  }));
  const regionProductMax = Math.max(1, ...regionProductCards.flatMap((region) => region.rows.map((row) => row.amount)));
  const branchRankingRows = (dashboard?.branches ?? []).slice(0, 15);
  const dealerRankingRows = (dashboard?.companies ?? []).slice(0, 15);
  const generatedAt = dashboard?.generatedAt ? new Date(dashboard.generatedAt).toLocaleString("zh-CN", { hour12: false }) : "--";
  const activityTimeZone = activity?.timezone || "Asia/Shanghai";
  const formatTrendTime = (bucket: string, compact = false) => new Date(dashboardTrendTimestamp(bucket)).toLocaleString("zh-CN", compact
    ? { timeZone: activityTimeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
    : { timeZone: activityTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  useEffect(() => {
    const scroller = trendScrollRef.current;
    if (scroller && trend.length) scroller.scrollLeft = scroller.scrollWidth;
  }, [trend.length]);
  const beginTrendDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const scroller = trendScrollRef.current;
    if (!scroller) return;
    trendDragRef.current = { active: true, startX: event.clientX, scrollLeft: scroller.scrollLeft };
    scroller.classList.add("dragging");
    scroller.setPointerCapture(event.pointerId);
  };
  const moveTrendDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const scroller = trendScrollRef.current;
    if (!scroller || !trendDragRef.current.active) return;
    scroller.scrollLeft = trendDragRef.current.scrollLeft - (event.clientX - trendDragRef.current.startX);
  };
  const endTrendDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const scroller = trendScrollRef.current;
    trendDragRef.current.active = false;
    scroller?.classList.remove("dragging");
    if (scroller?.hasPointerCapture(event.pointerId)) scroller.releasePointerCapture(event.pointerId);
  };
  const cards = [
    { icon: "¥", label: "订单总额", value: dashboardCompactAmount(amount), unit: "元", tone: "mint" },
    { icon: "△", label: "订单总吨数", value: totals.total_tons == null ? "待完善" : Number(totals.total_tons).toLocaleString("zh-CN", { maximumFractionDigits: 3 }), unit: totals.total_tons == null ? "" : "吨", tone: "blue" },
    { icon: "单", label: "订单总笔数", value: Number(totals.order_count ?? 0).toLocaleString(), unit: "笔", tone: "orange" },
    { icon: "商", label: "参与经销商", value: Number(totals.dealer_count ?? totals.order_count ?? 0).toLocaleString(), unit: "家", tone: "purple" },
    { icon: "司", label: "参与分公司", value: Number(totals.branch_count ?? 0).toLocaleString(), unit: "家", tone: "red" },
    { icon: "品", label: "成交 SKU", value: Number(totals.sku_count ?? 0).toLocaleString(), unit: "种", tone: "yellow" },
  ];
  return <section className="order-dashboard">
    <header className="order-dashboard-header"><div><h1><span>▦</span> 订货会订单数据可视化看板</h1><p>{activity?.name ?? "订货会"} · 实时汇总有效订单，撤回订单不计入</p></div><div className="order-dashboard-live"><em><i />{historical ? "历史回看" : "LIVE"}</em><button type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "刷新中…" : "↻ 手动刷新"}</button><small>更新于 {generatedAt}</small></div></header>
    {error && <div className="order-dashboard-error">{error}</div>}
    <div className="order-dashboard-kpis">{cards.map((card) => <article className={card.tone} key={card.label}><span>{card.icon}</span><div><small>{card.label}</small><strong>{card.value}<i>{card.unit}</i></strong></div></article>)}</div>
    <div className="order-dashboard-grid order-dashboard-grid-top">
      <article className="order-dashboard-panel"><h2><i className="mint" />渠道订单额占比</h2><div className="channel-donut-wrap"><div className="channel-donut" style={{ background: `conic-gradient(#1fbaa1 0 ${generalShare}%, #ed8618 ${generalShare}% 100%)` }}><b>{dashboardCompactAmount(amount)}<small>订单总额</small></b></div><div className="channel-legend"><span><i className="general" />综合客户 <b>{dashboardCompactAmount(generalAmount)}</b></span><span><i className="special" />特渠专业客户 <b>{dashboardCompactAmount(specialAmount)}</b></span></div></div></article>
      {generalRegions.length > 0 && <article className="order-dashboard-panel"><h2><i className="orange" />综合客户 · 片区订单额分布</h2><DashboardBars rows={regions} /></article>}
      <article className="order-dashboard-panel"><h2><i className="brown" />产线订单额排名（全渠道）</h2><DashboardBars rows={productLineRows} /></article>
      <article className="order-dashboard-panel"><h2><i className="purple" />下单时间趋势（按小时）<small className="order-trend-hint">按住图表左右拖动 · {trend.length} 个小时 · {trend.filter((item) => Number(item.amount) === 0).length} 个零值</small></h2><div className="order-trend"><div className="order-trend-y-axis">{[1, .75, .5, .25, 0].map((ratio) => <span key={ratio}>{(trendMax * ratio / 10000).toFixed(0)}万</span>)}</div><div ref={trendScrollRef} className="order-trend-scroll" onPointerDown={beginTrendDrag} onPointerMove={moveTrendDrag} onPointerUp={endTrendDrag} onPointerCancel={endTrendDrag} onPointerLeave={(event) => { if (trendDragRef.current.active) endTrendDrag(event); }}><div className="order-trend-canvas" style={{ width: trendChartWidth }}><svg width={trendChartWidth} height="132" viewBox={`0 0 ${trendChartWidth} 132`} role="img" aria-label="下单时间趋势"><defs><linearGradient id="orderTrendArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#33bf7b" stopOpacity=".24"/><stop offset="100%" stopColor="#33bf7b" stopOpacity=".03"/></linearGradient></defs>{trendAreaPath && <path className="order-trend-area" d={trendAreaPath}/>}<path className="order-trend-line" d={trendLinePath}/></svg>{trendPoints.map((point, index) => <button type="button" className={`order-trend-point${selectedTrendIndex === index ? " active" : ""}`} key={`${point.x}-${index}`} style={{ left: point.x, top: point.y }} aria-label={`查看 ${formatTrendTime(trend[index].bucket)} 的下单数据`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedTrendBucket(trend[index].bucket); }} />)}{selectedTrendIndex >= 0 && <div className="order-trend-detail" style={{ left: Math.min(Math.max(trendPoints[selectedTrendIndex].x, 92), trendChartWidth - 92), top: trendPoints[selectedTrendIndex].y < 62 ? trendPoints[selectedTrendIndex].y + 13 : trendPoints[selectedTrendIndex].y - 58 }}><button type="button" aria-label="关闭时间点详情" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedTrendBucket(null); }}>×</button><b>{formatTrendTime(trend[selectedTrendIndex].bucket)}</b><span>订单金额 <strong>{Number(trend[selectedTrendIndex].amount).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元</strong></span><span>订单笔数 <strong>{trend[selectedTrendIndex].orders} 笔</strong></span></div>}<div className="order-trend-x-axis">{trend.map((item, index) => <span key={item.bucket} style={{ left: 36 + index * 62 }}>{formatTrendTime(item.bucket, true).replaceAll("/", "-")}</span>)}</div></div></div></div></article>
    </div>
    <article className="order-dashboard-panel order-dashboard-products"><h2><i className="purple" />各渠道产线订单额对比</h2><div><section><h3 className="special">特渠专业客户</h3><DashboardBars rows={specialChannelProductRows} /></section><section><h3 className="general">综合客户</h3><DashboardBars rows={generalChannelProductRows} /></section></div></article>
    {regionProductCards.length > 0 && <article className="order-dashboard-panel order-dashboard-region-products"><h2><i className="blue" />综合渠道 · 各片区产线订单额明细</h2><div className="order-dashboard-region-grid">{regionProductCards.map((region) => <section key={region.code}><h3 style={{ background: region.color }}>{region.name}<small>{dashboardCompactAmount(region.rows.reduce((sum, row) => sum + row.amount, 0))}</small></h3><DashboardBars rows={region.rows} maxAmount={regionProductMax} /></section>)}</div></article>}
    <div className="order-dashboard-grid order-dashboard-rankings">
      <article className="order-dashboard-panel"><h2><i className="red" />分公司订单额排名 TOP 15</h2><DashboardTopRanking rows={branchRankingRows} type="branch" /></article>
      <article className="order-dashboard-panel"><h2><i className="orange" />经销商订单额排名 TOP 15</h2><DashboardTopRanking rows={dealerRankingRows} type="dealer" /></article>
    </div>
  </section>;
}

function MetricTable({ title, labels, values, kind = "category" }: { title: string; labels: string[]; values: number[]; kind?: "area" | "product" | "category" }) {
  return (
    <div className={`metric-table metric-table-${kind}`}>
      <i className="metric-frame-corner corner-tl" aria-hidden="true" /><i className="metric-frame-corner corner-tr" aria-hidden="true" /><i className="metric-frame-corner corner-bl" aria-hidden="true" /><i className="metric-frame-corner corner-br" aria-hidden="true" />
      <h2><span className="metric-table-title">{title}</span></h2>
      <div className="metric-head"><span><i className="metric-column-icon" aria-hidden="true" />分类</span><span><i className="metric-amount-icon" aria-hidden="true" />金额（元）</span></div>
      {labels.map((label, index) => <div key={label}><span>{label}</span><b>{values[index].toLocaleString()}</b></div>)}
      <div className="metric-total"><span>合计</span><b>{values.reduce((a, b) => a + b, 0).toLocaleString()}</b></div>
    </div>
  );
}

export function ReportBoard({ activity }: { activity: RuntimeActivity | null }) {
  const [report, setReport] = useState(reports[2]);
  const [data, setData] = useState<DashboardReport | null>(null);
  const [error, setError] = useState("");
  const historical = activity?.status === "FINISHED" || activity?.status === "ARCHIVED";
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const next = await loadDashboardReport(report); if (active) { setData(next); setError(""); } }
      catch (reason) { if (active) setError(reason instanceof ApiError ? reason.message : "战报数据加载失败"); }
    };
    void refresh();
    if (historical) return () => { active = false; };
    const timer = window.setInterval(refresh, 15000);
    const events = new EventSource(`${apiBase()}/screen/activities/${encodeURIComponent(getActiveActivityCode())}/events`);
    events.addEventListener("invalidate", () => void refresh());
    return () => { active = false; window.clearInterval(timer); events.close(); };
  }, [report, historical]);
  const isTop = report.includes("TOP5");
  const isTotal = report === "总战绩";
  const isDual = report === reports[8];
  const displayTitles: Record<string, string> = {
    "特渠专业客户金额、综合客户金额及合计": "特渠专业客户+综合客户",
    "礼盒：特渠专业客户金额、综合客户金额及合计": "礼盒",
    "综合客户各产品线金额及合计": "综合客户",
    "特渠专业客户与综合客户各产品线金额及合计": "特渠专业客户+综合客户",
  };
  const displayTitle = displayTitles[report] ?? report;
  const typeValues = (report.includes("礼盒") ? data?.giftCustomerTypes : data?.customerTypes) ?? [];
  const typeAmount = (type: string) => Number(typeValues.find((item) => item.customerType === type)?.amount ?? 0);
  const reportRegions = data?.generalRegions ?? (activity?.regions ?? []).map((region) => ({ regionCode: region.code, regionName: region.name, sortNo: region.sortNo,
    orderCount: Number(data?.regions.find((item) => item.regionCode === region.code)?.orderCount ?? 0),
    amount: Number(data?.regions.find((item) => item.regionCode === region.code)?.amount ?? 0), productLines: [] }));
  const regionLabels = reportRegions.map((region) => region.regionName);
  const regionValues = reportRegions.map((region) => Number(region.amount));
  const productLineRows = report === "综合客户各产品线金额及合计"
    ? data?.generalProductLines ?? []
    : data?.dashboard.productLines ?? [];
  const topRows = report.startsWith("特渠") ? data?.topSpecial ?? [] : data?.topGeneral ?? [];
  const totalAmount = Number(data?.dashboard.totals.total_amount ?? 0);
  return (
    <section className="screen-board report-board">
      <FestivalDecor />
      <header className="report-header">
        <span>调味品事业部新品发布及旺季动员会</span>
        <h1>月满家圆 · 味启新程{historical && <small> · 历史回看</small>}</h1>
        <label>当前看板：
          <select value={report} onChange={(e) => setReport(e.target.value)}>
            {reports.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </header>
      {error && <div className="warning-box"><b>{historical ? "历史战报加载异常" : "实时数据连接异常"}</b><span>{error}</span></div>}
      <div className={`report-content ${isDual ? "dual" : ""}`}>
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
            <MetricTable kind="area" title="综合客户 · 区域" labels={regionLabels} values={regionValues} />
            <MetricTable kind="product" title="综合客户 · 产品线" labels={(data?.generalProductLines ?? []).map((item) => item.productLine)} values={(data?.generalProductLines ?? []).map((item) => Number(item.amount))} />
          </>
        ) : report.includes("产品线") ? (
          <MetricTable kind="product" title={displayTitle} labels={productLineRows.map((item) => item.productLine)} values={productLineRows.map((item) => Number(item.amount))} />
        ) : report.includes("各片区") ? (
          <MetricTable kind="area" title="综合客户" labels={regionLabels} values={regionValues} />
        ) : (
          <MetricTable title={displayTitle} labels={["特渠专业客户", "综合客户"]} values={[typeAmount("SPECIAL"), typeAmount("GENERAL")]} />
        )}
      </div>
    </section>
  );
}
