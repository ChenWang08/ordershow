"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiBase, getActiveActivityCode, loadOrderDashboard, type DashboardReport, type RuntimeActivity } from "../../api";
import { createRefreshQueue } from "./refresh-queue";

export function useOrderDashboard(activity: RuntimeActivity | null) {
  const [data, setData] = useState<DashboardReport | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const activityReady = activity !== null;
  const historical = activity?.status === "FINISHED" || activity?.status === "ARCHIVED";
  const queueRef = useRef<ReturnType<typeof createRefreshQueue> | null>(null);
  const refresh = useCallback(() => queueRef.current?.refresh() ?? Promise.resolve(), []);
  useEffect(() => {
    if (!activityReady) return;
    let active = true;
    const controller = new AbortController();
    const queue = createRefreshQueue(async () => {
      if (!active) return;
      setRefreshing(true);
      try { const next = await loadOrderDashboard(controller.signal); if (active) { setData(next); setError(""); } }
      catch (reason) { if (active) setError(reason instanceof ApiError ? reason.message : "订单看板数据加载失败"); }
      finally { if (active) setRefreshing(false); }
    });
    queueRef.current = queue;
    void queue.refresh();
    const timer = historical ? null : window.setInterval(queue.periodic, 15000);
    const events = historical ? null : new EventSource(`${apiBase()}/screen/activities/${encodeURIComponent(getActiveActivityCode())}/events`);
    events?.addEventListener("invalidate", (event) => void queue.invalidate((event as MessageEvent | undefined)?.data));
    events?.addEventListener("open", () => void queue.refresh());
    return () => {
      active = false; queue.dispose(); controller.abort();
      if (queueRef.current === queue) queueRef.current = null;
      if (timer !== null) window.clearInterval(timer);
      events?.close();
    };
  }, [activity?.id, activityReady, historical]);

  return { data, error, refreshing, historical, refresh };
}
