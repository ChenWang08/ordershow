import { api } from "./client";
import { activeActivityPath } from "./context";
import type { ActivityOverviewData, DashboardData, DashboardReport, Envelope, RankingMetric } from "./types";

export type RankingFilters = {
  customerType?: string; regionCode?: string; regionUnassigned?: boolean;
  productLine?: string; productLineUnassigned?: boolean;
  varieties?: string[]; includeUnspecifiedVariety?: boolean; metric?: RankingMetric;
};
export type RankingOptions = {
  customers: Array<{ customerType: string; regionCode?: string | null; regionName: string }>;
  products: Array<{ productLine?: string | null; varietyName?: string | null }>;
};

export async function loadRankingOptions(signal?: AbortSignal, filters: Pick<RankingFilters, "customerType" | "regionCode" | "regionUnassigned"> = {}) {
  const query = new URLSearchParams();
  if (filters.customerType && filters.customerType !== "ALL") query.set("customerType", filters.customerType);
  if (filters.regionCode) query.set("regionCode", filters.regionCode);
  if (filters.regionUnassigned) query.set("regionUnassigned", "true");
  const search = query.toString();
  return (await api<Envelope<RankingOptions>>(`/screen/activities/${activeActivityPath()}/ranking/options${search ? `?${search}` : ""}`, { signal })).data;
}

export async function loadActivityOverview(activityId: number, signal?: AbortSignal) {
  return (await api<Envelope<ActivityOverviewData>>(`/admin/activities/${activityId}/overview`, { signal })).data;
}

export async function loadAdminDashboard(activityId: number, filters: { customerType?: string; metric?: RankingMetric } = {}, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (filters.customerType) query.set("customerType", filters.customerType);
  if (filters.metric) query.set("metric", filters.metric);
  return (await api<Envelope<DashboardData>>(`/admin/activities/${activityId}/ranking?${query}`, { signal })).data;
}

export async function loadDashboard(filters: RankingFilters = {}, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (filters.customerType) query.set("customerType", filters.customerType);
  if (filters.regionCode) query.set("regionCode", filters.regionCode);
  if (filters.metric) query.set("metric", filters.metric);
  if (filters.regionUnassigned) query.set("regionUnassigned", "true");
  if (filters.productLine !== undefined) query.set("productLine", filters.productLine);
  if (filters.productLineUnassigned) query.set("productLineUnassigned", "true");
  for (const variety of filters.varieties ?? []) query.append("varieties", variety);
  if (filters.includeUnspecifiedVariety) query.set("includeUnspecifiedVariety", "true");
  const path = `/screen/activities/${activeActivityPath()}/ranking`;
  // A large multi-select can exceed proxy/server URL limits after Chinese names are encoded.
  const search = query.toString();
  return (await api<Envelope<DashboardData>>(search.length > 6000 ? path : `${path}?${search}`,
    search.length > 6000 ? { method: "POST", body: JSON.stringify(filters), signal } : { signal })).data;
}
export async function loadOrderDashboard(signal?: AbortSignal) { return (await api<Envelope<DashboardReport>>(`/screen/activities/${activeActivityPath()}/dashboard`, { signal })).data; }
export async function loadDashboardReport(reportCode: string, signal?: AbortSignal) { return (await api<Envelope<DashboardReport>>(`/screen/activities/${activeActivityPath()}/reports/${encodeURIComponent(reportCode)}`, { signal })).data; }
