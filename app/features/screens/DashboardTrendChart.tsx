"use client";

import { useEffect, useRef, useState } from "react";
import type { DashboardReport } from "../../api";
import { dashboardSmoothPath, dashboardTrendTimestamp } from "./dashboard-domain";

export function DashboardTrendChart({ trend, activityTimeZone }: { trend: DashboardReport["trend"]; activityTimeZone: string }) {
  const [selectedTrendBucket, setSelectedTrendBucket] = useState<string | null>(null);
  const trendScrollRef = useRef<HTMLDivElement>(null);
  const trendDragRef = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const trendMax = Math.max(...trend.map((item) => Number(item.amount)), 1);
  const trendChartWidth = Math.max(720, Math.max(trend.length - 1, 1) * 62 + 72);
  const trendPoints = trend.map((item, index) => ({ x: 36 + index * 62, y: 112 - Number(item.amount) / trendMax * 92 }));
  const trendLinePath = dashboardSmoothPath(trendPoints);
  const trendAreaPath = trendPoints.length ? `${trendLinePath} L ${trendPoints[trendPoints.length - 1].x} 112 L ${trendPoints[0].x} 112 Z` : "";
  const selectedTrendIndex = selectedTrendBucket == null ? -1 : trend.findIndex((item) => item.bucket === selectedTrendBucket);
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
  return (
      <article className="order-dashboard-panel"><h2><i className="purple" />下单时间趋势（按小时）<small className="order-trend-hint">按住图表左右拖动 · {trend.length} 个小时 · {trend.filter((item) => Number(item.amount) === 0).length} 个零值</small></h2><div className="order-trend"><div className="order-trend-y-axis">{[1, .75, .5, .25, 0].map((ratio) => <span key={ratio}>{(trendMax * ratio / 10000).toFixed(0)}万</span>)}</div><div ref={trendScrollRef} className="order-trend-scroll" onPointerDown={beginTrendDrag} onPointerMove={moveTrendDrag} onPointerUp={endTrendDrag} onPointerCancel={endTrendDrag} onPointerLeave={(event) => { if (trendDragRef.current.active) endTrendDrag(event); }}><div className="order-trend-canvas" style={{ width: trendChartWidth }}><svg width={trendChartWidth} height="132" viewBox={`0 0 ${trendChartWidth} 132`} role="img" aria-label="下单时间趋势"><defs><linearGradient id="orderTrendArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#33bf7b" stopOpacity=".24"/><stop offset="100%" stopColor="#33bf7b" stopOpacity=".03"/></linearGradient></defs>{trendAreaPath && <path className="order-trend-area" d={trendAreaPath}/>}<path className="order-trend-line" d={trendLinePath}/></svg>{trendPoints.map((point, index) => <button type="button" className={`order-trend-point${selectedTrendIndex === index ? " active" : ""}`} key={`${point.x}-${index}`} style={{ left: point.x, top: point.y }} aria-label={`查看 ${formatTrendTime(trend[index].bucket)} 的下单数据`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedTrendBucket(trend[index].bucket); }} />)}{selectedTrendIndex >= 0 && <div className="order-trend-detail" style={{ left: Math.min(Math.max(trendPoints[selectedTrendIndex].x, 92), trendChartWidth - 92), top: trendPoints[selectedTrendIndex].y < 62 ? trendPoints[selectedTrendIndex].y + 13 : trendPoints[selectedTrendIndex].y - 58 }}><button type="button" aria-label="关闭时间点详情" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setSelectedTrendBucket(null); }}>×</button><b>{formatTrendTime(trend[selectedTrendIndex].bucket)}</b><span>订单金额 <strong>{Number(trend[selectedTrendIndex].amount).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元</strong></span><span>订单笔数 <strong>{trend[selectedTrendIndex].orders} 笔</strong></span></div>}<div className="order-trend-x-axis">{trend.map((item, index) => <span key={item.bucket} style={{ left: 36 + index * 62 }}>{formatTrendTime(item.bucket, true).replaceAll("/", "-")}</span>)}</div></div></div></div></article>
  );
}
