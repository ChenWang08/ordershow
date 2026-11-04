import { api } from "./client";
import { beijingDateTimeToUtc } from "../../features/shared/time";
import type { CreateActivityInput } from "./activity";
import type { Envelope } from "./types";

export type ActivityCopySelection = { products: boolean; whitelist: boolean; lottery: boolean };
export type ActivityCopySource = { id: number; code: string; name: string; status: string };
export type ActivityCopyPreview = { sourceId: number; sourceName: string; stamp: string; products: number; customers: number; rounds: number };
export type ActivityCopyTask = { id: number; status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"; stage: string;
  copiedFiles: number; totalFiles: number; failureMessage?: string; activityId?: number; activityCode?: string };
export async function loadActivityCopySources(departmentId: number, signal?: AbortSignal) {
  return (await api<Envelope<ActivityCopySource[]>>(`/admin/activity-copy-sources?departmentId=${departmentId}`, { signal })).data;
}
export async function loadActivityCopyPreview(sourceId: number, departmentId: number, signal?: AbortSignal) {
  return (await api<Envelope<ActivityCopyPreview>>(`/admin/activities/${sourceId}/copy-preview?departmentId=${departmentId}`, { signal })).data;
}
export async function createActivityCopy(input: CreateActivityInput, source: ActivityCopyPreview, selection: ActivityCopySelection, requestKey: string) {
  return (await api<Envelope<ActivityCopyTask>>("/admin/activity-copies", { method: "POST", body: JSON.stringify({
    name: input.name.trim(), departmentId: input.departmentId, startsAt: beijingDateTimeToUtc(input.startsAt),
    endsAt: beijingDateTimeToUtc(input.endsAt), eventEndsAt: beijingDateTimeToUtc(input.eventEndsAt),
    sourceId: source.sourceId, sourceStamp: source.stamp, selection, requestKey,
  }) }, "admin")).data;
}
export async function loadActivityCopyTask(id: number, signal?: AbortSignal) {
  return (await api<Envelope<ActivityCopyTask>>(`/admin/activity-copies/${id}`, { signal })).data;
}
export async function retryActivityCopy(id: number) {
  return (await api<Envelope<ActivityCopyTask>>(`/admin/activity-copies/${id}/retry`, { method: "POST" }, "admin")).data;
}
export async function discardActivityCopy(id: number) {
  return (await api<Envelope<boolean>>(`/admin/activity-copies/${id}/discard`, { method: "POST" }, "admin")).data;
}
