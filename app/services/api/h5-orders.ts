import { api, ApiError } from "./client";
import { activeActivityPath } from "./context";
import type { Envelope, RuntimeIdentity, RuntimeOrder, RuntimeOrderDraft, RuntimeProduct } from "./types";

export async function verifyPhone(customerType: "GENERAL" | "SPECIAL" | "ALL" | "", regionCode: string, phone: string) {
  return (await api<Envelope<{ customer: RuntimeIdentity; csrfToken: string }>>(`/public/activities/${activeActivityPath()}/verify-phone`, {
    method: "POST", body: JSON.stringify({ customerType: customerType || null, regionCode: regionCode || null, phone }),
  })).data.customer;
}

export async function loadH5Products() {
  return (await api<Envelope<RuntimeProduct[]>>(`/h5/activities/${activeActivityPath()}/products`)).data;
}

export async function loadH5Order() {
  try { return (await api<Envelope<RuntimeOrder>>(`/h5/activities/${activeActivityPath()}/order?includeHistory=false`)).data; }
  catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
}

export async function loadH5OrderDraft() {
  return (await api<Envelope<RuntimeOrderDraft | null>>(`/h5/activities/${activeActivityPath()}/order-draft`)).data;
}

export async function saveH5OrderDraft(customerId: number, baseOrderVersion: number,
    items: Array<{ productId: number; quantity: number }>, keepalive = false) {
  return (await api<Envelope<RuntimeOrderDraft>>(`/h5/activities/${activeActivityPath()}/order-draft`, {
    method: "PUT", body: JSON.stringify({ customerId, baseOrderVersion, items }), keepalive,
  }, "h5")).data;
}

export async function deleteH5OrderDraft(customerId: number, keepalive = false) {
  return (await api<Envelope<boolean>>(`/h5/activities/${activeActivityPath()}/order-draft?customerId=${encodeURIComponent(customerId)}`, {
    method: "DELETE", keepalive,
  }, "h5")).data;
}

export async function saveH5Order(expectedVersion: number, items: Array<{ productId: number; quantity: number }>,
    idempotencyKey: string, activityCode: string, customerId: number, signal?: AbortSignal) {
  return (await api<Envelope<RuntimeOrder>>(`/h5/activities/${encodeURIComponent(activityCode)}/order?includeHistory=false`, {
    method: "PUT", headers: { "Idempotency-Key": idempotencyKey, "X-H5-Customer-Id": String(customerId) }, body: JSON.stringify({ expectedVersion, items }), signal,
  }, "h5")).data;
}

export async function withdrawH5Order(expectedVersion: number) {
  return (await api<Envelope<RuntimeOrder>>(`/h5/activities/${activeActivityPath()}/order/withdraw?includeHistory=false`, {
    method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ expectedVersion }),
  }, "h5")).data;
}
