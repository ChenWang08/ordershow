import { api } from "./client";
import type { AuditLogApi, PageEnvelope } from "./types";

export async function loadAuditLogs(activityId: number) {
  return (await api<PageEnvelope<AuditLogApi>>(`/admin/activities/${activityId}/audit-logs?page=1&size=50`)).data;
}
