"use client";
import { useEffect, useState } from "react";
import { loadModuleContext, type ModuleContext } from "../../api";

export function useModuleContext(activityId: string, enabled: boolean) {
  const [context, setContext] = useState<ModuleContext | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const refresh = () => { void loadModuleContext(Number(activityId)).then(value => { if (active) setContext(value); }).catch(() => undefined); };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activityId, enabled]);
  return context;
}
