import { api } from "./client";
import type { Envelope } from "./types";

export type AdminDepartment = {
  id: number; code: string; name: string; status: "ACTIVE" | "DISABLED";
  accountId?: number | null; accountUsername?: string | null; accountDisplayName?: string | null;
  accountStatus?: "ACTIVE" | "DISABLED" | null; lastLoginAt?: string | null; activityCount: number;
};

export type AdminUser = {
  id: number; username: string; displayName: string; roleCode: "SUPER_ADMIN" | "DEPARTMENT_ADMIN" | "DEPARTMENT_MEMBER";
  permissions?: import("../../features/admin/permissions").MemberPermission[];
  departmentId?: number | null; departmentName?: string | null; status: "ACTIVE" | "DISABLED";
  mustChangePassword: boolean; lastLoginAt?: string | null; lockVersion: number;
};

export async function loadAdminDepartments(signal?: AbortSignal) {
  return (await api<Envelope<AdminDepartment[]>>("/admin/departments", { signal })).data;
}

export async function createAdminDepartment(input: { name: string; username: string; password: string }) {
  return (await api<Envelope<AdminDepartment>>("/admin/departments", {
    method: "POST", body: JSON.stringify(input),
  }, "admin")).data;
}

export async function updateAdminDepartment(id: number, changes: { name?: string; status?: "ACTIVE" | "DISABLED" }) {
  return (await api<Envelope<AdminDepartment>>(`/admin/departments/${id}`, {
    method: "PATCH", body: JSON.stringify(changes),
  }, "admin")).data;
}

export async function loadAdminUsers(signal?: AbortSignal) {
  return (await api<Envelope<AdminUser[]>>("/admin/users", { signal })).data;
}

export async function createDepartmentUser(departmentId: number, input: { username: string; password: string }) {
  return (await api<Envelope<AdminUser>>(`/admin/departments/${departmentId}/account`, {
    method: "POST", body: JSON.stringify(input),
  }, "admin")).data;
}

export async function updateAdminUser(id: number, changes: { status?: "ACTIVE" | "DISABLED"; password?: string }) {
  return (await api<Envelope<AdminUser>>(`/admin/users/${id}`, {
    method: "PATCH", body: JSON.stringify(changes),
  }, "admin")).data;
}
