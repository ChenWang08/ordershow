import { api } from "./client";
import type { AdminAttendee, AdminCustomer, Envelope, PageEnvelope } from "./types";

async function loadAllPages<T>(path: string) {
  const rows: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await api<PageEnvelope<T>>(`${path}${separator}page=${page}&size=200`);
    rows.push(...response.data);
    if (page >= response.page.totalPages) break;
  }
  return rows;
}
export async function loadAdminCustomers(activityId: number) { return loadAllPages<AdminCustomer>(`/admin/activities/${activityId}/customers`); }
export async function loadAdminAttendees(activityId: number) { return loadAllPages<AdminAttendee>(`/admin/activities/${activityId}/attendees`); }
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
