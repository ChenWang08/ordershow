import { api } from "./client";
import { activeActivityPath } from "./context";
import type { DashboardData, DashboardReport, Envelope, RankingMetric } from "./types";

export async function loadAdminDashboard(activityId: number, filters: { customerType?: string; metric?: RankingMetric } = {}) {
  const query = new URLSearchParams();
  if (filters.customerType) query.set("customerType", filters.customerType);
  if (filters.metric) query.set("metric", filters.metric);
  return (await api<Envelope<DashboardData>>(`/admin/activities/${activityId}/ranking?${query}`)).data;
}

export async function loadDashboard(filters: { customerType?: string; regionCode?: string; metric?: RankingMetric } = {}, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (filters.customerType) query.set("customerType", filters.customerType);
  if (filters.regionCode) query.set("regionCode", filters.regionCode);
  if (filters.metric) query.set("metric", filters.metric);
  return (await api<Envelope<DashboardData>>(`/screen/activities/${activeActivityPath()}/ranking?${query.toString()}`, { signal })).data;
}
export async function loadOrderDashboard(signal?: AbortSignal) { return (await api<Envelope<DashboardReport>>(`/screen/activities/${activeActivityPath()}/dashboard`, { signal })).data; }
export async function loadDashboardReport(reportCode: string, signal?: AbortSignal) { return (await api<Envelope<DashboardReport>>(`/screen/activities/${activeActivityPath()}/reports/${encodeURIComponent(reportCode)}`, { signal })).data; }
