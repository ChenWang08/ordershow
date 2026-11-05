import { api, apiBase } from "./client";
import type { Envelope } from "./types";

export type OrderExportFilters = { status?: string | null; customerType?: string | null; keyword?: string | null };
export type OrderExportTask = {
  id: number; activityId: number; status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "EXPIRED";
  stage: string; filters: OrderExportFilters; orderCount: number; detailCount: number; sheetCounts: number[];
  snapshotAt?: string; createdAt: string; completedAt?: string; expiresAt?: string;
  failureCode?: string; failureMessage?: string; cancelRequested: boolean;
};
const path = (activityId: number) => `/admin/activities/${activityId}/exports`;
export async function createOrderExport(activityId: number, filters: OrderExportFilters, key: string, signal?: AbortSignal) {
  return (await api<Envelope<OrderExportTask>>(path(activityId), {
    method: "POST", signal, headers: { "Idempotency-Key": key }, body: JSON.stringify({ exportType: "ORDER_PACKAGE", filters }),
  }, "admin")).data;
}
export async function loadOrderExports(activityId: number, signal?: AbortSignal) {
  return (await api<Envelope<OrderExportTask[]>>(path(activityId), { signal })).data;
}
export async function cancelOrderExport(activityId: number, taskId: number, signal?: AbortSignal) {
  return (await api<Envelope<OrderExportTask>>(`${path(activityId)}/${taskId}/cancel`, { method: "POST", signal }, "admin")).data;
}
// Native downloads stream to disk; no fetch().blob() holding the package in browser memory.
export function orderExportDownloadUrl(activityId: number, taskId: number) {
  return `${apiBase()}${path(activityId)}/${taskId}/download`;
}
