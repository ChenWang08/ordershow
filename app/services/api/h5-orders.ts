import { createIdempotencyKey } from "./idempotency-key";
import { api, ApiError } from "./client";
import { activeActivityPath } from "./context";
import type { Envelope, OrderChangeRequest, RuntimeIdentity, RuntimeOrder, RuntimeOrderDraft, H5Product } from "./types";

export type H5CustomerType = "GENERAL" | "SPECIAL" | "ALL";
export type H5VerificationResult =
  | { selectionRequired: true; customerTypes: Array<"GENERAL" | "SPECIAL"> }
  | { selectionRequired: false; customer: RuntimeIdentity; csrfToken: string };

export async function verifyPhone(phone: string, customerType?: H5CustomerType): Promise<H5VerificationResult> {
  return (await api<Envelope<H5VerificationResult>>(`/public/activities/${activeActivityPath()}/verify-phone`, {
    method: "POST", body: JSON.stringify({ phone, ...(customerType ? { customerType } : {}) }),
  })).data;
}

export async function loadH5Products() {
  return (await api<Envelope<H5Product[]>>(`/h5/activities/${activeActivityPath()}/products`)).data;
}

type H5ReadOptions = { activityCode?: string; signal?: AbortSignal };

export async function loadH5Order(options: H5ReadOptions = {}) {
  const path = options.activityCode ? encodeURIComponent(options.activityCode) : activeActivityPath();
  try { return (await api<Envelope<RuntimeOrder>>(`/h5/activities/${path}/order?includeHistory=false`, { signal: options.signal })).data; }
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
    idempotencyKey: string, activityCode: string, customerId: number, signal?: AbortSignal, expectedLockVersion?: number) {
  return (await api<Envelope<RuntimeOrder>>(`/h5/activities/${encodeURIComponent(activityCode)}/order?includeHistory=false`, {
    method: "PUT", headers: { "Idempotency-Key": idempotencyKey, "X-H5-Customer-Id": String(customerId) }, body: JSON.stringify({ expectedVersion, items, expectedLockVersion }), signal,
  }, "h5")).data;
}

export async function withdrawH5Order(expectedVersion: number) {
  return (await api<Envelope<RuntimeOrder>>(`/h5/activities/${activeActivityPath()}/order/withdraw?includeHistory=false`, {
    method: "POST", headers: { "Idempotency-Key": createIdempotencyKey() }, body: JSON.stringify({ expectedVersion }),
  }, "h5")).data;
}

export async function loadH5OrderChangeRequest(options: H5ReadOptions = {}) {
  const path = options.activityCode ? encodeURIComponent(options.activityCode) : activeActivityPath();
  return (await api<Envelope<OrderChangeRequest | null>>(`/h5/activities/${path}/order-change-requests/current`, { signal: options.signal })).data;
}

export async function createH5OrderChangeRequest(activityCode: string, customerId: number, expectedVersion: number,
    requestType: "MODIFY" | "WITHDRAW", items: Array<{ productId: number; quantity: number }>, customerNote = "", idempotencyKey = createIdempotencyKey(), expectedLockVersion?: number) {
  return (await api<Envelope<OrderChangeRequest>>(`/h5/activities/${encodeURIComponent(activityCode)}/order-change-requests`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey, "X-H5-Customer-Id": String(customerId) },
    body: JSON.stringify({ expectedVersion, requestType, items, customerNote, expectedLockVersion }),
  }, "h5")).data;
}
