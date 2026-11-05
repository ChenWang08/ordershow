"use client";

import { loadOrderDashboard, type RuntimeActivity } from "../../api";
import { useManualScreenData } from "./useManualScreenData";
import { useManualRefresh } from "../shared/useManualRefresh";

function readDashboard(_parameters: null, signal: AbortSignal) {
  return loadOrderDashboard(signal);
}

export function useOrderDashboard(activity: RuntimeActivity | null) {
  const model = useManualScreenData(activity?.id ?? null, readDashboard, null, "订单看板数据加载失败");
  const manual = useManualRefresh(activity ? String(activity.id) : null, model.refreshing, () => model.refresh());
  const status = model.data?.dashboard.status ?? activity?.status;
  return { ...model, refresh: manual.refresh, coolingDown: manual.coolingDown, historical: status === "FINISHED" || status === "ARCHIVED" };
}
