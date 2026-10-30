import { beijingDateStamp } from "../../features/shared/time";
import { createIdempotencyKey } from "./idempotency-key";
import { api, apiBase, ApiError, notifyAdminAccessFailure } from "./client";
import type { AdminOrderPreview, AdminOrderSummary, Envelope, OrderChangeRequest, PageEnvelope, RuntimeOrder } from "./types";

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
    method: "POST", headers: { "Idempotency-Key": createIdempotencyKey() },
    body: JSON.stringify({ activityCustomerId, items, reason }),
  }, "admin")).data;
}

export async function adjustAdminOrder(activityId: number, orderId: number, expectedVersion: number,
    expectedLockVersion: number, items: Array<{ productId: number; quantity: number }>, reason: string) {
  return (await api<Envelope<RuntimeOrder>>(`/admin/activities/${activityId}/orders/${orderId}`, {
    method: "PUT", headers: { "Idempotency-Key": createIdempotencyKey() },
    body: JSON.stringify({ expectedVersion, expectedLockVersion, items, reason }),
  }, "admin")).data;
}

export async function voidAdminOrder(activityId: number, orderId: number, expectedVersion: number,
    expectedLockVersion: number, reason: string) {
  return (await api<Envelope<RuntimeOrder>>(`/admin/activities/${activityId}/orders/${orderId}/void`, {
    method: "POST", headers: { "Idempotency-Key": createIdempotencyKey() },
    body: JSON.stringify({ expectedVersion, expectedLockVersion, reason }),
  }, "admin")).data;
}

export async function loadAdminOrderChangeRequests(activityId: number, status = "PENDING") {
  return (await api<Envelope<OrderChangeRequest[]>>(`/admin/activities/${activityId}/order-change-requests?status=${encodeURIComponent(status)}`)).data;
}

export function loadOrderChangePage(activityId: number, filters: { status: string; type: string; keyword: string; page: number; size: number; newest: boolean }, signal?: AbortSignal) {
  const query = new URLSearchParams(Object.entries(filters).map(([key,value]) => [key,String(value)]));
  return api<PageEnvelope<OrderChangeRequest>>(`/admin/activities/${activityId}/order-change-requests/page?${query}`, { signal });
}
export async function loadPendingOrderChanges(activityId: number, signal?: AbortSignal) {
  return (await api<Envelope<Array<{id:number;orderId:number}>>>(`/admin/activities/${activityId}/order-change-requests/pending`, { signal })).data;
}
export async function loadOrderChangeDetail(activityId: number, id: number) {
  return (await api<Envelope<OrderChangeRequest>>(`/admin/activities/${activityId}/order-change-requests/${id}`)).data;
}

export async function approveAdminOrderChangeRequest(activityId: number, requestId: number, reason = "") {
  return (await api<Envelope<OrderChangeRequest>>(`/admin/activities/${activityId}/order-change-requests/${requestId}/approve`, {
    method: "POST", headers: { "Idempotency-Key": createIdempotencyKey() }, body: JSON.stringify({ reason }),
  }, "admin")).data;
}

export async function rejectAdminOrderChangeRequest(activityId: number, requestId: number, reason: string) {
  return (await api<Envelope<OrderChangeRequest>>(`/admin/activities/${activityId}/order-change-requests/${requestId}/reject`, {
    method: "POST", headers: { "Idempotency-Key": createIdempotencyKey() }, body: JSON.stringify({ reason }),
  }, "admin")).data;
}

export async function exportAdminOrders(activityId: number, filters: { status?: string; customerType?: string; keyword?: string } = {}, activityName = "活动") {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  const response = await fetch(`${apiBase()}/admin/activities/${activityId}/orders/export?${query.toString()}`, { credentials: "include" });
  if (!response.ok) {
    const path = `/admin/activities/${activityId}/orders/export`;
    if (response.status === 401) notifyAdminAccessFailure(path, response.status);
    const error = await response.json().catch(() => null) as { code?: string; detail?: string } | null;
    if (response.status !== 401) notifyAdminAccessFailure(path, response.status, error?.code);
    throw new ApiError(response.status, error?.code || "EXPORT_FAILED", error?.detail || "订单导出失败");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  const safeName = activityName.replace(/[\\/:*?"<>|]/g, "-");
  link.href = url; link.download = `${safeName}_订单数据_${beijingDateStamp()}.xlsx`; link.click(); URL.revokeObjectURL(url);
}
