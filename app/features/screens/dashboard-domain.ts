import { BEIJING_TIME_ZONE, formatBeijingTime } from "../shared/time";
import type { RuntimeActivity, DashboardReport } from "../../api";

export function isUnspecifiedCustomerTypeActivity(activity: RuntimeActivity | null) {
  return activity?.whitelistCustomerTypeMode === "UNSPECIFIED";
}

function dashboardCustomerTypes(data: DashboardReport | null, activity: RuntimeActivity | null) {
  if (isUnspecifiedCustomerTypeActivity(activity)) return [] as Array<"GENERAL" | "SPECIAL">;
  const configured = activity?.availableCustomerTypes?.filter((type): type is "GENERAL" | "SPECIAL" => type === "GENERAL" || type === "SPECIAL") ?? [];
  if (configured.length > 0) return [...new Set(configured)];
  return [...new Set((data?.customerTypes ?? []).map(item => item.customerType).filter((type): type is "GENERAL" | "SPECIAL" => type === "GENERAL" || type === "SPECIAL"))];
}

export function dashboardCompactAmount(value: number) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

export type DashboardBarRow = { name: string; amount: number; note?: string; color?: string };

export const dashboardChartPalette = [
  "#f3c900", "#a85d16", "#ed7d22", "#25ad77", "#e74c3c", "#8e55b2", "#3395ca", "#e59b18", "#d94f87", "#5968d8",
  "#14a6a6", "#70ad24", "#d66b52", "#6e4bb5", "#1688b8", "#c18a12", "#bf3f63", "#3c9b68", "#7b6b3a", "#446fca",
];
export const dashboardRegionPalette = ["#f3a211", "#ed5046", "#3495ca", "#8e55b2", "#24b89b", "#a85d16"];

export function dashboardColorFor(label: string, palette = dashboardChartPalette) {
  let hash = 0;
  for (const character of label) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export function dashboardTrendTimestamp(bucket: string) {
  const normalized = bucket.includes("T") ? bucket : bucket.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`).getTime();
}

export function dashboardHourlyTrend(rows: DashboardReport["trend"], activity: RuntimeActivity | null, generatedAt?: string) {
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

export function dashboardSmoothPath(points: Array<{ x: number; y: number }>) {
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

export type DashboardRankingRow = { rank: number; name: string; branch?: string; amount: number; quantity: number };

export function dashboardMetrics(data: DashboardReport | null, activity: RuntimeActivity | null) {
  const dashboard = data?.dashboard;
  const unspecifiedCustomerType = isUnspecifiedCustomerTypeActivity(activity);
  const customerTypes = dashboardCustomerTypes(data, activity);
  const hasGeneralCustomerType = customerTypes.includes("GENERAL");
  const hasSpecialCustomerType = customerTypes.includes("SPECIAL");
  const showChannelComparison = hasGeneralCustomerType && hasSpecialCustomerType;
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
  const generatedAt = dashboard?.generatedAt ? formatBeijingTime(dashboard.generatedAt) : "--";
  const activityTimeZone = BEIJING_TIME_ZONE;
  const cards = [
    { icon: "¥", label: "订单总额", value: dashboardCompactAmount(amount), unit: "元", tone: "mint" },
    { icon: "△", label: "订单总吨数", value: Number(totals.total_tons ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 3 }), unit: "吨", tone: "blue" },
    { icon: "单", label: "订单总笔数", value: Number(totals.order_count ?? 0).toLocaleString(), unit: "笔", tone: "orange" },
    { icon: "商", label: "参与经销商", value: Number(totals.dealer_count ?? totals.order_count ?? 0).toLocaleString(), unit: "家", tone: "purple" },
    { icon: "司", label: "参与分公司", value: Number(totals.branch_count ?? 0).toLocaleString(), unit: "家", tone: "red" },
    { icon: "品", label: "成交 SKU", value: Number(totals.sku_count ?? 0).toLocaleString(), unit: "种", tone: "yellow" },
  ];
  return { amount, generalAmount, specialAmount, generalShare, generalRegions, regions, trend, productLineRows, specialChannelProductRows, generalChannelProductRows, regionProductCards, regionProductMax, branchRankingRows, dealerRankingRows, generatedAt, activityTimeZone, cards,
    unspecifiedCustomerType, hasGeneralCustomerType, hasSpecialCustomerType, showChannelComparison };
}
