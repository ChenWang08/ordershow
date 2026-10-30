"use client";
import { useCallback, useEffect } from "react";
import { loadModuleContext } from "../../api";
import { useAdminQuery } from "./useAdminQuery";

export function useModuleContext(activityId: string, scope: string | null, revision: number) {
  // Invalidate an in-flight read after a relevant successful mutation, not on every render.
  const loader = useCallback((_key: string, signal: AbortSignal) => {
    void revision;
    return loadModuleContext(Number(activityId), signal);
  }, [activityId, revision]);
  const query = useAdminQuery(scope === null ? null : activityId, loader);
  const { refresh } = query;
  useEffect(() => {
    if (scope !== null) void refresh();
  }, [scope, refresh]);
  return query;
}
