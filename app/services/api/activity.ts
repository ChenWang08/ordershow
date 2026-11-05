import { beijingDateTimeToUtc } from "../../features/shared/time";
import { api } from "./client";
import type { AdminActivitySummary, Envelope, RuntimeActivity } from "./types";

export type ActivityDeletionPreview = { activityId: number; code: string; name: string; departmentName: string; version: number;
  orders: number; products: number; customers: number; winners: number; files: number };
export type ActivityDeletionTask = { id: number; activityId: number; activityCode: string; activityName: string;
  departmentName: string; requestedByName: string; reason: string; status: "QUEUED" | "RUNNING" | "PAUSED" | "FAILED" | "COMPLETED";
  stage: number; stageName: string; stageDetail: string; totalStages: number; deletedRows: number; deletedFiles: number;
  retryCount: number; maxRetries: number; nextAttemptAt: string; lastProgressAt: string;
  lastError?: string; createdAt: string; updatedAt: string; completedAt?: string };

export async function changeActivityArchive(activity: RuntimeActivity, archive: boolean, reason: string) {
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${activity.id}/${archive ? "archive" : "unarchive"}`, {
    method: "POST", headers: { "If-Match": String(activity.version) }, body: JSON.stringify({ reason }),
  }, "admin")).data;
}
export async function loadActivityDeletionPreview(id: number, signal?: AbortSignal) {
  return (await api<Envelope<ActivityDeletionPreview>>(`/admin/activities/${id}/deletion-preview`, { signal })).data;
}
export async function permanentlyDeleteActivity(preview: ActivityDeletionPreview, code: string, reason: string) {
  return (await api<Envelope<ActivityDeletionTask>>(`/admin/activities/${preview.activityId}/permanent-deletion`, {
    method: "POST", headers: { "If-Match": String(preview.version) }, body: JSON.stringify({ code, reason }),
  }, "admin")).data;
}
export async function loadActivityDeletionTasks(page: number, signal?: AbortSignal) {
  return (await api<Envelope<ActivityDeletionTask[]>>(`/admin/activity-deletion-tasks?page=${page}`, { signal })).data;
}
export async function retryActivityDeletionTask(id: number) {
  return (await api<Envelope<ActivityDeletionTask>>(`/admin/activity-deletion-tasks/${id}/retry`, { method: "POST" }, "admin")).data;
}
export async function pauseActivityDeletionTask(id: number) {
  return (await api<Envelope<ActivityDeletionTask>>(`/admin/activity-deletion-tasks/${id}/pause`, { method: "POST" }, "admin")).data;
}
export async function resumeActivityDeletionTask(id: number) {
  return (await api<Envelope<ActivityDeletionTask>>(`/admin/activity-deletion-tasks/${id}/resume`, { method: "POST" }, "admin")).data;
}

export async function loadCurrentActivity() {
  return (await api<Envelope<RuntimeActivity>>("/public/activities/current")).data;
}

export async function loadAdminActivities(signal?: AbortSignal) {
  return (await api<Envelope<AdminActivitySummary[]>>("/admin/activities?summary=true", { signal })).data;
}

export async function loadAdminActivity(id: number, signal?: AbortSignal) {
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${id}`, { signal })).data;
}

export async function saveActivityBackground(activityId: number, kind: "h5" | "desktop", file: File | null) {
  const body = new FormData();
  if (file) body.append("file", file);
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${activityId}/backgrounds/${kind}`, {
    method: file ? "POST" : "DELETE", ...(file ? { body } : {}),
  }, "admin")).data;
}

export async function updateActivityLiveRoom(activity: RuntimeActivity, liveRoomUrl: string) {
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${activity.id}/live-room`, {
    method: "PATCH", headers: { "If-Match": String(activity.version) },
    body: JSON.stringify({ liveRoomUrl: liveRoomUrl.trim() || null }),
  }, "admin")).data;
}

export type CreateActivityInput = {
  name: string;
  startsAt: string;
  endsAt: string;
  eventEndsAt: string;
  departmentId?: number;
};

export async function createActivity(input: CreateActivityInput) {
  return (await api<Envelope<RuntimeActivity>>("/admin/activities", {
    method: "POST",
    body: JSON.stringify({
      name: input.name.trim(),
      description: "",
      timezone: "Asia/Shanghai",
      startsAt: beijingDateTimeToUtc(input.startsAt),
      endsAt: beijingDateTimeToUtc(input.endsAt),
      eventEndsAt: beijingDateTimeToUtc(input.eventEndsAt),
      customerScope: "ALL",
      companyRankingTopN: 90,
      branchRankingTopN: 30,
      tonDisplayScale: 3,
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
    }),
  }, "admin")).data;
}


export async function updateActivity(activity: RuntimeActivity, changes: { name: string; startsAt: string; endsAt: string; eventEndsAt: string }) {
  const body = {
    code: activity.code, name: changes.name, description: activity.description || "", timezone: activity.timezone,
    startsAt: beijingDateTimeToUtc(changes.startsAt), endsAt: beijingDateTimeToUtc(changes.endsAt),
    eventEndsAt: beijingDateTimeToUtc(changes.eventEndsAt),
    customerScope: activity.customerScope, companyRankingTopN: activity.companyRankingTopN,
    branchRankingTopN: activity.branchRankingTopN, tonDisplayScale: activity.tonDisplayScale,
  };
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${activity.id}`, {
    method: "PUT", headers: { "If-Match": String(activity.version) }, body: JSON.stringify(body),
  }, "admin")).data;
}

export async function publishActivity(activity: RuntimeActivity) {
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${activity.id}/publish`, {
    method: "POST", headers: { "If-Match": String(activity.version) },
  }, "admin")).data;
}

export async function withdrawActivityPublication(activity: RuntimeActivity) {
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${activity.id}/withdraw-publication`, {
    method: "POST", headers: { "If-Match": String(activity.version) },
  }, "admin")).data;
}

export async function closeActivityNow(activity: RuntimeActivity, reason: string) {
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${activity.id}/close`, {
    method: "POST", headers: { "If-Match": String(activity.version) }, body: JSON.stringify({ reason }),
  }, "admin")).data;
}

export async function finishActivityNow(activity: RuntimeActivity, reason: string) {
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${activity.id}/finish`, {
    method: "POST", headers: { "If-Match": String(activity.version) }, body: JSON.stringify({ reason }),
  }, "admin")).data;
}

export async function reopenActivity(activity: RuntimeActivity, input: { endsAt: string; eventEndsAt: string; reason: string }) {
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${activity.id}/reopen`, {
    method: "POST", headers: { "If-Match": String(activity.version) },
    body: JSON.stringify({ endsAt: beijingDateTimeToUtc(input.endsAt), eventEndsAt: beijingDateTimeToUtc(input.eventEndsAt), reason: input.reason.trim() }),
  }, "admin")).data;
}
