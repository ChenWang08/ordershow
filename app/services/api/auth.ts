import { api } from "./client";
import type { Envelope } from "./types";

export type AdminIdentity = {
  id: number; username: string; displayName: string; roleCode: "SUPER_ADMIN" | "DEPARTMENT_ADMIN";
  departmentId?: number | null; departmentName?: string | null; mustChangePassword: boolean; csrfToken: string;
};

export async function adminLogin(username: string, password: string) {
  return (await api<Envelope<AdminIdentity>>("/admin/auth/login", {
    method: "POST", body: JSON.stringify({ username, password }),
  })).data;
}

export async function adminMe() {
  return (await api<Envelope<AdminIdentity>>("/admin/me")).data;
}

export async function adminLogout() {
  return (await api<Envelope<boolean>>("/admin/auth/logout", { method: "POST" }, "admin")).data;
}

export async function changeAdminPassword(currentPassword: string, newPassword: string) {
  return api<Envelope<boolean>>("/admin/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }, "admin");
}
