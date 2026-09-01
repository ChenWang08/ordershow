import { api } from "./client";
import type { Envelope } from "./types";

export async function adminLogin(username: string, password: string) {
  return (await api<Envelope<{ id: number; username: string; displayName: string; mustChangePassword: boolean; csrfToken: string }>>("/admin/auth/login", {
    method: "POST", body: JSON.stringify({ username, password }),
  })).data;
}

export async function adminMe() {
  return (await api<Envelope<{ id: number; username: string; displayName: string; mustChangePassword: boolean; csrfToken: string }>>("/admin/me")).data;
}

export async function changeAdminPassword(currentPassword: string, newPassword: string) {
  return api<Envelope<boolean>>("/admin/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }, "admin");
}

