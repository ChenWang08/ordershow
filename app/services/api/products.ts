import { api } from "./client";
import type { Envelope, ProductImageReview, RuntimeProduct, DealerCandidate, DealerScopeSummary } from "./types";

export async function loadDealerCandidates(activityId: number) {
  return (await api<Envelope<DealerCandidate[]>>(`/admin/activities/${activityId}/product-dealer-candidates`)).data;
}
export async function loadScopeHistory(activityId: number, productId: number) {
  return (await api<Envelope<Array<{ before_json: string; after_json: string; reason: string; created_at: string; display_name: string }>>>(`/admin/activities/${activityId}/products/${productId}/scope-history`)).data;
}

export async function loadAdminProducts(activityId: number, filters: {
  activityCustomerId?: number;
  customerType?: string;
  status?: string;
  keyword?: string;
} = {}, signal?: AbortSignal) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const [products, scopes] = await Promise.all([
    api<Envelope<RuntimeProduct[]>>(`/admin/activities/${activityId}/products${suffix}`, { signal }),
    api<Envelope<Record<string, DealerScopeSummary>>>(`/admin/activities/${activityId}/product-dealer-scopes`, { signal }),
  ]);
  return products.data.map(p => {
    const scope=scopes.data[String(p.id)];
    return { ...p, dealerScope: scope?.scopes ?? [], effectiveDealerCount: scope?.effectiveCount, dealerScopeRestricted: scope?.restricted };
  });
}
export async function loadProductImageReviews(activityId: number, signal?: AbortSignal) {
  return (await api<Envelope<ProductImageReview[]>>(`/admin/activities/${activityId}/product-image-reviews`, { signal })).data;
}
export async function selectProductImageReview(activityId: number, candidateId: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/product-image-reviews/${candidateId}/select`, { method: "POST" }, "admin")).data;
}
export async function excludeProductImageReview(activityId: number, candidateId: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/product-image-reviews/${candidateId}`, { method: "DELETE" }, "admin")).data;
}
export async function createAdminProduct(activityId: number, body: Record<string, unknown>) {
  return (await api<Envelope<RuntimeProduct>>(`/admin/activities/${activityId}/products`, { method: "POST", body: JSON.stringify(body) }, "admin")).data;
}
export async function updateAdminProduct(activityId: number, productId: number, version: number, body: Record<string, unknown>) {
  return (await api<Envelope<RuntimeProduct>>(`/admin/activities/${activityId}/products/${productId}`, {
    method: "PATCH", headers: { "If-Match": String(version) }, body: JSON.stringify(body),
  }, "admin")).data;
}
export async function addAdminProductImage(activityId: number, productId: number, file: File, primary = false) {
  const body = new FormData();
  body.append("file", file);
  body.append("primary", String(primary));
  return (await api<Envelope<RuntimeProduct["images"][number]>>(`/admin/activities/${activityId}/products/${productId}/images`, {
    method: "POST", body,
  }, "admin")).data;
}
export async function updateAdminProductImage(activityId: number, productId: number, imageId: number, primary: boolean, sortNo: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/products/${productId}/images/${imageId}`, {
    method: "PATCH", body: JSON.stringify({ primary, sortNo }),
  }, "admin")).data;
}
export async function deleteAdminProductImage(activityId: number, productId: number, imageId: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/products/${productId}/images/${imageId}`, {
    method: "DELETE",
  }, "admin")).data;
}
export async function deleteAdminProduct(activityId: number, productId: number, version: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/products/${productId}`, {
    method: "DELETE", headers: { "If-Match": String(version) },
  }, "admin")).data;
}

export async function loadOrderProducts(activityId: number, filters: { activityCustomerId?: number } = {}) {
  const query = filters.activityCustomerId ? '?activityCustomerId=' + filters.activityCustomerId : '';
  return (await api<Envelope<RuntimeProduct[]>>('/admin/activities/' + activityId + '/orders/product-options' + query)).data;
}
