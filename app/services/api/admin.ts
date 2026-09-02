import { api } from "./client";
import type { Envelope } from "./types";

export type AdminDepartment = {
  id: number; code: string; name: string; status: "ACTIVE" | "DISABLED";
  accountId?: number | null; accountUsername?: string | null; accountDisplayName?: string | null;
  accountStatus?: "ACTIVE" | "DISABLED" | null; lastLoginAt?: string | null; activityCount: number;
};

export type AdminUser = {
  id: number; username: string; displayName: string; roleCode: "SUPER_ADMIN" | "DEPARTMENT_ADMIN";
  departmentId?: number | null; departmentName?: string | null; status: "ACTIVE" | "DISABLED";
  mustChangePassword: boolean; lastLoginAt?: string | null; lockVersion: number;
};

export async function loadAdminDepartments() {
  return (await api<Envelope<AdminDepartment[]>>("/admin/departments")).data;
}

export async function createAdminDepartment(name: string) {
  return (await api<Envelope<AdminDepartment>>("/admin/departments", {
    method: "POST", body: JSON.stringify({ name }),
  }, "admin")).data;
}

export async function updateAdminDepartment(id: number, changes: { name?: string; status?: "ACTIVE" | "DISABLED" }) {
  return (await api<Envelope<AdminDepartment>>(`/admin/departments/${id}`, {
    method: "PATCH", body: JSON.stringify(changes),
  }, "admin")).data;
}

export async function loadAdminUsers() {
  return (await api<Envelope<AdminUser[]>>("/admin/users")).data;
}

export async function createDepartmentUser(input: { username: string; displayName: string; initialPassword: string; departmentId: number }) {
  return (await api<Envelope<AdminUser>>("/admin/users", {
    method: "POST", body: JSON.stringify(input),
  }, "admin")).data;
}

export async function updateAdminUser(id: number, changes: { displayName?: string; status?: "ACTIVE" | "DISABLED"; initialPassword?: string }) {
  return (await api<Envelope<AdminUser>>(`/admin/users/${id}`, {
    method: "PATCH", body: JSON.stringify(changes),
  }, "admin")).data;
}
