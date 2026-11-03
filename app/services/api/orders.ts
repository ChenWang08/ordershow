import { createIdempotencyKey } from "./idempotency-key";
import { api } from "./client";
import type { AdminOrderPreview, AdminOrderSummary, Envelope, OrderChangeRequest, PageEnvelope, RuntimeOrder } from "./types";

export async function loadAdminOrders(activityId: number, filters: { status?: string; customerType?: string; keyword?: string; page?: number; size?: number } = {}, signal?: AbortSignal) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== "") query.set(key, String(value)); });
  return api<PageEnvelope<AdminOrderSummary>>(`/admin/activities/${activityId}/orders?${query.toString()}`, { signal });
}

export async function loadAdminOrder(activityId: number, orderId: number, signal?: AbortSignal) {
  return (await api<Envelope<RuntimeOrder>>(`/admin/activities/${activityId}/orders/${orderId}`, { signal })).data;
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
export async function loadOrderChangeDetail(activityId: number, id: number, signal?: AbortSignal) {
  return (await api<Envelope<OrderChangeRequest>>(`/admin/activities/${activityId}/order-change-requests/${id}`, { signal })).data;
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
