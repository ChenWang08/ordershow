"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiBase, getActiveActivityCode, loadOrderDashboard, type DashboardReport, type RuntimeActivity } from "../../api";
import { createRefreshQueue } from "./refresh-queue";

export function useOrderDashboard(activity: RuntimeActivity | null) {
  const [data, setData] = useState<DashboardReport | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const historical = activity?.status === "FINISHED" || activity?.status === "ARCHIVED";
  const queueRef = useRef<ReturnType<typeof createRefreshQueue> | null>(null);
  const refresh = useCallback(() => queueRef.current?.refresh() ?? Promise.resolve(), []);
  useEffect(() => {
    let active = true;
    const queue = createRefreshQueue(async () => {
      if (!active) return;
      setRefreshing(true);
      try { const next = await loadOrderDashboard(); if (active) { setData(next); setError(""); } }
      catch (reason) { if (active) setError(reason instanceof ApiError ? reason.message : "订单看板数据加载失败"); }
      finally { if (active) setRefreshing(false); }
    });
    queueRef.current = queue;
    void queue.refresh();
    const timer = historical ? null : window.setInterval(queue.refresh, 15000);
    const events = historical ? null : new EventSource(`${apiBase()}/screen/activities/${encodeURIComponent(getActiveActivityCode())}/events`);
    events?.addEventListener("invalidate", () => void queue.refresh());
    events?.addEventListener("open", () => void queue.refresh());
    return () => {
      active = false; queue.dispose();
      if (queueRef.current === queue) queueRef.current = null;
      if (timer !== null) window.clearInterval(timer);
      events?.close();
    };
  }, [activity?.id, historical]);

  return { data, error, refreshing, historical, refresh };
}
