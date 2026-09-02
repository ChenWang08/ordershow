"use client";

import { createContext, useContext } from "react";
import type { AdminIdentity } from "./services/api/auth";

export const AdminIdentityContext = createContext<AdminIdentity | null>(null);

export type AdminSessionActions = {
  logout: () => Promise<void>;
  busy: boolean;
  error: string;
};

export const AdminSessionContext = createContext<AdminSessionActions | null>(null);

export function useAdminIdentity() {
  return useContext(AdminIdentityContext);
}

export function useAdminSession() {
  return useContext(AdminSessionContext);
}
