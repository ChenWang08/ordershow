"use client";

import type { RuntimeActivity } from "../../api";
import { useOrderDashboard } from "./useOrderDashboard";
import { dashboardCompactAmount, dashboardMetrics } from "./dashboard-domain";
import { DashboardBars, DashboardTopRanking } from "./DashboardCharts";
import { DashboardTrendChart } from "./DashboardTrendChart";
import { ScreenRefreshControls } from "./ScreenRefreshControls";

export function OrderDashboard({ activity }: { activity: RuntimeActivity | null }) {
  const { data, error, refreshing, refreshedAt, historical, refresh } = useOrderDashboard(activity);
  const { amount, generalAmount, specialAmount, generalShare, generalRegions, regions, trend, productLineRows, specialChannelProductRows, generalChannelProductRows, regionProductCards, regionProductMax, branchRankingRows, dealerRankingRows, activityTimeZone, cards, unspecifiedCustomerType, hasGeneralCustomerType, hasSpecialCustomerType, showChannelComparison } = dashboardMetrics(data, activity);
  const showGeneralRegions = hasGeneralCustomerType && generalRegions.length > 0;
  const singleChannel = !showChannelComparison;
  const singleTypeLabel = unspecifiedCustomerType ? "全部客户" : hasGeneralCustomerType ? "综合客户" : "特渠专业客户";
  return <section className="order-dashboard">
    <header className="order-dashboard-header"><div><h1><span>▦</span> 订货会订单数据可视化看板</h1><p>{activity?.name ?? "订货会"} · 点击刷新更新有效订单统计，撤回订单不计入</p></div><div className="order-dashboard-live"><ScreenRefreshControls refreshing={refreshing} refreshedAt={refreshedAt} historical={historical} disabled={!activity} onRefresh={() => void refresh()} /></div></header>
    {error && <div className="order-dashboard-error" role="alert">{error}。{data ? "当前显示上次成功加载的数据，请点击手动刷新重试。" : "请点击手动刷新重试。"}</div>}
    <div className="order-dashboard-kpis">{cards.map((card) => <article className={card.tone} key={card.label}><span>{card.icon}</span><div><small>{card.label}</small><strong>{card.value}<i>{card.unit}</i></strong></div></article>)}</div>
    <div className="order-dashboard-grid order-dashboard-rankings">
      <article className="order-dashboard-panel"><h2><i className="red" />分公司订单额排名 TOP 15</h2><DashboardTopRanking rows={branchRankingRows} type="branch" /></article>
      <article className="order-dashboard-panel"><h2><i className="orange" />经销商订单额排名 TOP 15</h2><DashboardTopRanking rows={dealerRankingRows} type="dealer" /></article>
    </div>
    <div className={`order-dashboard-grid order-dashboard-grid-top${singleChannel ? " single-channel" : ""}${showGeneralRegions ? " has-general-regions" : ""}`}>
      <article className={`order-dashboard-panel order-dashboard-channel-summary${singleChannel ? " single-channel-summary" : ""}`}><h2><i className="mint" />{showChannelComparison ? "渠道订单额占比" : "订单额占比"}</h2><div className="channel-donut-wrap"><div className="channel-donut" style={{ background: showChannelComparison ? `conic-gradient(#1fbaa1 0 ${generalShare}%, #ed8618 ${generalShare}% 100%)` : amount > 0 ? hasGeneralCustomerType ? "#1fbaa1" : hasSpecialCustomerType ? "#ed8618" : "#1fbaa1" : "#e8edf0" }}><b>{dashboardCompactAmount(amount)}<small>订单总额</small></b></div>{showChannelComparison ? <div className="channel-legend"><span><i className="general" />综合客户 <b>{dashboardCompactAmount(generalAmount)}</b></span><span><i className="special" />特渠专业客户 <b>{dashboardCompactAmount(specialAmount)}</b></span></div> : <div className="channel-legend"><span><i className={hasSpecialCustomerType && !hasGeneralCustomerType ? "special" : "general"} />{singleTypeLabel} <b>{dashboardCompactAmount(amount)} · {amount > 0 ? "100%" : "0%"}</b></span></div>}</div></article>
      {showGeneralRegions && <article className={`order-dashboard-panel order-dashboard-region-summary${singleChannel ? " single-channel-summary" : ""}`}><h2><i className="orange" />综合客户 · 大区订单额分布</h2><DashboardBars rows={regions} /></article>}
      <article className="order-dashboard-panel order-dashboard-product-line"><h2><i className="brown" />项目组订单额排名（{showChannelComparison ? "全渠道" : singleTypeLabel}）</h2><DashboardBars rows={productLineRows} /></article>
      <DashboardTrendChart trend={trend} activityTimeZone={activityTimeZone} fullWidth={singleChannel} />
    </div>
    {showChannelComparison && <article className="order-dashboard-panel order-dashboard-products"><h2><i className="purple" />各渠道项目组订单额对比</h2><div><section><h3 className="special">特渠专业客户</h3><DashboardBars rows={specialChannelProductRows} /></section><section><h3 className="general">综合客户</h3><DashboardBars rows={generalChannelProductRows} /></section></div></article>}
    {showGeneralRegions && regionProductCards.length > 0 && <article className="order-dashboard-panel order-dashboard-region-products"><h2><i className="blue" />综合渠道 · 各大区项目组订单额明细</h2><div className="order-dashboard-region-grid">{regionProductCards.map((region) => <section key={region.code}><h3 style={{ background: region.color }}>{region.name}<small>{dashboardCompactAmount(region.rows.reduce((sum, row) => sum + row.amount, 0))}</small></h3><DashboardBars rows={region.rows} maxAmount={regionProductMax} /></section>)}</div></article>}
  </section>;
}
