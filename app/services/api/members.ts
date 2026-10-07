import { api } from "./client";
import type { Envelope } from "./types";
import type { MemberPermission } from "../../features/admin/permissions";

export type DepartmentMember = {
  id: number; username: string; displayName: string; departmentId: number; departmentName: string;
  status: "ACTIVE" | "DISABLED"; lockVersion: number; lastLoginAt?: string | null; permissions: MemberPermission[];
};
export async function loadMembers(departmentId?: number) {
  return (await api<Envelope<DepartmentMember[]>>("/admin/members" + (departmentId ? `?departmentId=${departmentId}` : ""))).data;
}
export async function createMember(input: { username: string; displayName: string; departmentId?: number; password: string; permissions: MemberPermission[] }) {
  return (await api<Envelope<DepartmentMember>>("/admin/members", { method: "POST", body: JSON.stringify(input) }, "admin")).data;
}
export async function updateMember(id: number, input: { lockVersion: number; displayName?: string; status?: "ACTIVE" | "DISABLED"; password?: string; permissions?: MemberPermission[] }) {
  return (await api<Envelope<DepartmentMember>>(`/admin/members/${id}`, { method: "PATCH", body: JSON.stringify(input) }, "admin")).data;
}
export type ModuleContext = {
  customerCount: number; customersByType: Record<string, number>; customerTypeMode: "TYPED" | "UNSPECIFIED";
  attendeeCount: number; whitelistPublished: boolean;
};
export async function loadModuleContext(activityId: number) {
  return (await api<Envelope<ModuleContext>>(`/admin/activities/${activityId}/module-context`)).data;
}
