"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiBase, getActiveActivityCode, loadOrderDashboard, type DashboardReport, type RuntimeActivity } from "../../api";

export function useOrderDashboard(activity: RuntimeActivity | null) {
  const [data, setData] = useState<DashboardReport | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const historical = activity?.status === "FINISHED" || activity?.status === "ARCHIVED";
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { setData(await loadOrderDashboard()); setError(""); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : "订单看板数据加载失败"); }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial remote dashboard load
    void refresh();
    if (historical) return;
    const timer = window.setInterval(refresh, 15000);
    const events = new EventSource(`${apiBase()}/screen/activities/${encodeURIComponent(getActiveActivityCode())}/events`);
    events.addEventListener("invalidate", () => void refresh());
    return () => { window.clearInterval(timer); events.close(); };
  }, [historical, refresh]);

  return { data, error, refreshing, historical, refresh };
}
