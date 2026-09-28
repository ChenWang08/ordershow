import { api } from "./client";
import { activeActivityPath } from "./context";
import type { DashboardData, DashboardReport, Envelope, RankingMetric } from "./types";

export async function loadAdminDashboard(activityId: number, filters: { customerType?: string; metric?: RankingMetric } = {}) {
  const query = new URLSearchParams();
  if (filters.customerType) query.set("customerType", filters.customerType);
  if (filters.metric) query.set("metric", filters.metric);
  return (await api<Envelope<DashboardData>>(`/admin/activities/${activityId}/ranking?${query}`)).data;
}

export async function loadDashboard(filters: { customerType?: string; regionCode?: string; metric?: RankingMetric } = {}) {
  const query = new URLSearchParams();
  if (filters.customerType) query.set("customerType", filters.customerType);
  if (filters.regionCode) query.set("regionCode", filters.regionCode);
  if (filters.metric) query.set("metric", filters.metric);
  return (await api<Envelope<DashboardData>>(`/screen/activities/${activeActivityPath()}/ranking?${query.toString()}`)).data;
}
export async function loadOrderDashboard() { return (await api<Envelope<DashboardReport>>(`/screen/activities/${activeActivityPath()}/dashboard`)).data; }
export async function loadDashboardReport(reportCode: string) { return (await api<Envelope<DashboardReport>>(`/screen/activities/${activeActivityPath()}/reports/${encodeURIComponent(reportCode)}`)).data; }
