import { api, apiBase, ApiError } from "./client";
import type { AdminOrderPreview, AdminOrderSummary, Envelope, PageEnvelope, RuntimeOrder } from "./types";

export async function loadAdminOrders(activityId: number, filters: { status?: string; customerType?: string; keyword?: string; page?: number; size?: number } = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== "") query.set(key, String(value)); });
  return api<PageEnvelope<AdminOrderSummary>>(`/admin/activities/${activityId}/orders?${query.toString()}`);
}

export async function loadAdminOrder(activityId: number, orderId: number) {
  return (await api<Envelope<RuntimeOrder>>(`/admin/activities/${activityId}/orders/${orderId}`)).data;
}

export async function previewAdminOrder(activityId: number, activityCustomerId: number,
    items: Array<{ productId: number; quantity: number }>) {
  return (await api<Envelope<AdminOrderPreview>>(`/admin/activities/${activityId}/orders/preview`, {
    method: "POST", body: JSON.stringify({ activityCustomerId, items }),
  }, "admin")).data;
}

export async function createAdminOrder(activityId: number, activityCustomerId: number,
    items: Array<{ productId: number; quantity: number }>, reason: string) {
  return (await api<Envelope<RuntimeOrder>>(`/admin/activities/${activityId}/orders`, {
    method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ activityCustomerId, items, reason }),
  }, "admin")).data;
}

export async function adjustAdminOrder(activityId: number, orderId: number, expectedVersion: number,
    expectedLockVersion: number, items: Array<{ productId: number; quantity: number }>, reason: string) {
  return (await api<Envelope<RuntimeOrder>>(`/admin/activities/${activityId}/orders/${orderId}`, {
    method: "PUT", headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion, expectedLockVersion, items, reason }),
  }, "admin")).data;
}

export async function voidAdminOrder(activityId: number, orderId: number, expectedVersion: number,
    expectedLockVersion: number, reason: string) {
  return (await api<Envelope<RuntimeOrder>>(`/admin/activities/${activityId}/orders/${orderId}/void`, {
    method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ expectedVersion, expectedLockVersion, reason }),
  }, "admin")).data;
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
