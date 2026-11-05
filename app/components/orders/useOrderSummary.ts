"use client";

import { loadAdminOrderCounts } from "../../api";
import { useLazyAdminQuery } from "../../features/admin/useLazyAdminQuery";

/** Keep one activity snapshot; page/search changes do not invalidate activity-wide counts. */
export function useOrderSummary(activityId: number, enabled: boolean, entry: string, revision = 0, reloadKey = 0) {
  return useLazyAdminQuery(String(activityId), enabled,
    signal => loadAdminOrderCounts(activityId, signal), undefined, false,
    JSON.stringify([entry, revision, reloadKey]), "entry");
}
