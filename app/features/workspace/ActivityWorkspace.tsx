"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useActivityRuntime } from "./useActivityRuntime";
import { useImportWorkspaceState } from "./useImportWorkspaceState";
import type { RuntimeActivity } from "../../api";

const ActivityContext = createContext<ReturnType<typeof useActivityRuntime> | null>(null);
const ImportContext = createContext<ReturnType<typeof useImportWorkspaceState> | null>(null);

export function ActivityWorkspaceProvider({ children, adminActivity }: { children: ReactNode; adminActivity?: RuntimeActivity }) {
  const activity = useActivityRuntime(adminActivity);
  const imports = useImportWorkspaceState();
  return <ActivityContext.Provider value={activity}><ImportContext.Provider value={imports}>{children}</ImportContext.Provider></ActivityContext.Provider>;
}

export function useActivityWorkspace() {
  const value = useContext(ActivityContext);
  if (!value) throw new Error("Activity workspace is not mounted");
  return value;
}

export function useImportWorkspace() {
  const value = useContext(ImportContext);
  if (!value) throw new Error("Import workspace is not mounted");
  return value;
}
