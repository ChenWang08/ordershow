import { api, apiBase, ApiError } from "./client";
import type { AdminOrderSummary, Envelope, PageEnvelope, RuntimeOrder } from "./types";

export async function loadAdminOrders(activityId: number, filters: { status?: string; customerType?: string; keyword?: string; page?: number; size?: number } = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== "") query.set(key, String(value)); });
  return api<PageEnvelope<AdminOrderSummary>>(`/admin/activities/${activityId}/orders?${query.toString()}`);
}

export async function loadAdminOrder(activityId: number, orderId: number) {
  return (await api<Envelope<RuntimeOrder>>(`/admin/activities/${activityId}/orders/${orderId}`)).data;
}

export async function exportAdminOrders(activityId: number, filters: { status?: string; customerType?: string; keyword?: string } = {}, activityName = "活动") {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  const response = await fetch(`${apiBase()}/admin/activities/${activityId}/orders/export?${query.toString()}`, { credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, "EXPORT_FAILED", "订单导出失败");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  const safeName = activityName.replace(/[\\/:*?"<>|]/g, "-");
  link.href = url; link.download = `${safeName}_订单数据_${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); URL.revokeObjectURL(url);
}

