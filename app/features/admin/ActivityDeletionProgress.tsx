"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAdminIdentity } from "../../admin-context";
import { ActivityDeletionTasks } from "./ActivityDeletionTasks";

const DeletionProgressContext = createContext<(() => void) | null>(null);

// One owner survives activity loading and module changes inside the authenticated workspace.
export function ActivityDeletionProgressProvider({ children }: { children: ReactNode }) {
  const identity = useAdminIdentity();
  if (identity?.roleCode !== "SUPER_ADMIN") return children;
  return <SuperAdminDeletionProgress key={identity.id}>{children}</SuperAdminDeletionProgress>;
}

function SuperAdminDeletionProgress({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active && sessionStorage.getItem("activity-deletion-progress") === "open") {
        sessionStorage.removeItem("activity-deletion-progress");
        setOpen(true);
      }
    });
    return () => { active = false; };
  }, []);
  return <DeletionProgressContext.Provider value={() => setOpen(true)}>
    {children}
    {open && <ActivityDeletionTasks onClose={() => setOpen(false)} />}
  </DeletionProgressContext.Provider>;
}

export function ActivityDeletionProgressButton() {
  const open = useContext(DeletionProgressContext);
  return open ? <button type="button" onClick={open}>删除进度</button> : null;
}
