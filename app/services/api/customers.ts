import { api } from "./client";
import type { AdminAttendee, AdminCustomer, Envelope, PageEnvelope } from "./types";

// Legacy import readbacks are bounded as well; published lists use loadRosterPage with full metadata.
export async function loadAdminCustomers(activityId: number, signal?: AbortSignal) {
  return (await api<PageEnvelope<AdminCustomer>>(`/admin/activities/${activityId}/customers?page=1&size=50`, { signal })).data;
}
export async function searchAdminCustomers(activityId: number, keyword: string) {
  const query = new URLSearchParams({ keyword, page: "1", size: "50" });
  return (await api<PageEnvelope<AdminCustomer>>(`/admin/activities/${activityId}/orders/customer-options?${query.toString()}`)).data;
}
export async function loadAdminAttendees(activityId: number, signal?: AbortSignal) {
  return (await api<PageEnvelope<AdminAttendee>>(`/admin/activities/${activityId}/attendees?page=1&size=50`, { signal })).data;
}

export type RosterKind = "customers" | "attendees";
export type RosterFilters = { customerType: string; branch: string; status: string; matchStatus: string; keyword: string };
export type RosterQuery = RosterFilters & { page: number; size: number };
export type RosterPage<T> = PageEnvelope<T> & {
  summary: Record<string, number>; branches: string[]; customerTypes: string[]; revisions: Record<string, string>;
};
export type RosterSelection = { filters: RosterFilters; rows: Array<{ id: number; revision: string }> | null; snapshot?: string; excludedIds?: number[] };
export async function loadRosterPage<T>(activityId: number, kind: RosterKind, filters: RosterQuery, signal?: AbortSignal) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== "").map(([key, value]) => [key, String(value)]));
  return api<RosterPage<T>>(`/admin/activities/${activityId}/${kind}/page?${query}`, { signal });
}
export async function previewRosterDeletion(activityId: number, kind: RosterKind, selection: RosterSelection) {
  return (await api<Envelope<{ count: number; snapshot: string }>>(`/admin/activities/${activityId}/${kind}/deletion-preview`, {
    method: "POST", body: JSON.stringify(selection),
  }, "admin")).data;
}
export async function deleteRosterSelection(activityId: number, kind: RosterKind, selection: RosterSelection) {
  return (await api<Envelope<number>>(`/admin/activities/${activityId}/${kind}/batch-delete`, {
    method: "POST", body: JSON.stringify(selection),
  }, "admin")).data;
}
export async function createAdminCustomer(activityId: number, body: Record<string, unknown>) {
  return (await api<Envelope<AdminCustomer>>(`/admin/activities/${activityId}/customers`, { method: "POST", body: JSON.stringify(body) }, "admin")).data;
}
export async function updateAdminCustomer(activityId: number, customerId: number, body: Record<string, unknown>) {
  return (await api<Envelope<AdminCustomer>>(`/admin/activities/${activityId}/customers/${customerId}`, { method: "PUT", body: JSON.stringify(body) }, "admin")).data;
}
export async function deleteAdminCustomer(activityId: number, customerId: number, expectedVersion: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/customers/${customerId}`, {
    method: "DELETE", headers: { "If-Match": String(expectedVersion) },
  }, "admin")).data;
}
export async function createAdminAttendee(activityId: number, body: Record<string, unknown>) {
  return (await api<Envelope<AdminAttendee>>(`/admin/activities/${activityId}/attendees`, { method: "POST", body: JSON.stringify(body) }, "admin")).data;
}
export async function updateAdminAttendee(activityId: number, attendeeId: number, body: Record<string, unknown>) {
  return (await api<Envelope<AdminAttendee>>(`/admin/activities/${activityId}/attendees/${attendeeId}`, { method: "PUT", body: JSON.stringify(body) }, "admin")).data;
}
export async function deleteAdminAttendee(activityId: number, attendeeId: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/attendees/${attendeeId}`, { method: "DELETE" }, "admin")).data;
}
