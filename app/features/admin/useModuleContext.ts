"use client";
import { useEffect, useRef } from "react";
import { loadModuleContext } from "../../api";
import { useLazyAdminQuery } from "./useLazyAdminQuery";

export function useModuleContext(activityId: string, scope: string | null, revision: number) {
  const query = useLazyAdminQuery(activityId, scope !== null, signal => loadModuleContext(Number(activityId), signal), undefined, false, scope ?? "");
  const previous = useRef(revision);
  const { invalidate, refresh } = query;
  useEffect(() => {
    if (previous.current === revision) return;
    previous.current = revision;
    invalidate();
    if (scope !== null) void refresh();
  }, [revision, scope, invalidate, refresh]);
  return query;
}
