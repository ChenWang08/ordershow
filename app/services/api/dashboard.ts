import { api } from "./client";
import { activeActivityPath } from "./context";
import type { DashboardData, DashboardReport, Envelope } from "./types";

export async function loadDashboard(filters: { customerType?: string; regionCode?: string } = {}) {
  const query = new URLSearchParams();
  if (filters.customerType) query.set("customerType", filters.customerType);
  if (filters.regionCode) query.set("regionCode", filters.regionCode);
  return (await api<Envelope<DashboardData>>(`/screen/activities/${activeActivityPath()}/ranking?${query.toString()}`)).data;
}
export async function loadOrderDashboard() { return (await api<Envelope<DashboardReport>>(`/screen/activities/${activeActivityPath()}/dashboard`)).data; }
export async function loadDashboardReport(reportCode: string) { return (await api<Envelope<DashboardReport>>(`/screen/activities/${activeActivityPath()}/reports/${encodeURIComponent(reportCode)}`)).data; }

