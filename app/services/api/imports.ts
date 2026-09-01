import { api, ApiError } from "./client";
import type { AttendanceMatchPreview, Envelope, ImportStagingRow, ImportTask } from "./types";

export async function uploadImport(activityId: number, importType: "PRODUCT" | "WHITELIST" | "ATTENDANCE", file: File) {
  const body = new FormData(); body.append("importType", importType); body.append("file", file);
  return (await api<Envelope<ImportTask>>(`/admin/activities/${activityId}/imports`, { method: "POST", body }, "admin")).data;
}

export async function confirmImport(activityId: number, taskId: number, imageZip?: File, imageDecisions?: Array<{ entryPath: string; status: "CONFIRMED" | "PENDING" | "UNMATCHED"; targetRowIds: number[] }>, attendanceWhitelistVersionId?: number | null) {
  const body = imageZip || imageDecisions?.length || attendanceWhitelistVersionId !== undefined ? new FormData() : undefined;
  if (body && imageZip) body.append("imageZip", imageZip);
  if (body && imageDecisions?.length) body.append("imageDecisions", JSON.stringify(imageDecisions));
  if (body && attendanceWhitelistVersionId != null) body.append("attendanceWhitelistVersionId", String(attendanceWhitelistVersionId));
  return (await api<Envelope<ImportTask>>(`/admin/activities/${activityId}/imports/${taskId}/confirm`, { method: "POST", body }, "admin")).data;
}

export async function loadImportTask(activityId: number, taskId: number) {
  return (await api<Envelope<ImportTask>>(`/admin/activities/${activityId}/imports/${taskId}`)).data;
}

export async function loadImportTasks(activityId: number) {
  return (await api<Envelope<ImportTask[]>>(`/admin/activities/${activityId}/imports`)).data;
}

export async function loadImportRows(activityId: number, taskId: number, validationStatus?: string) {
  const query = validationStatus ? `?validationStatus=${encodeURIComponent(validationStatus)}` : "";
  return (await api<Envelope<ImportStagingRow[]>>(`/admin/activities/${activityId}/imports/${taskId}/rows${query}`)).data;
}

export async function loadAttendanceMatchPreview(activityId: number, taskId: number) {
  return (await api<Envelope<AttendanceMatchPreview>>(`/admin/activities/${activityId}/imports/${taskId}/attendance-match-preview`)).data;
}

export async function updateImportRow(activityId: number, taskId: number, rowId: number, changes: Record<string, unknown>, deleted = false) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/imports/${taskId}/rows/${rowId}`, {
    method: "PATCH", body: JSON.stringify({ changes, deleted }),
  }, "admin")).data;
}
export async function deleteImportRows(activityId: number, taskId: number, rowIds: number[]) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/imports/${taskId}/rows`, {
    method: "PATCH", body: JSON.stringify({ rowIds }),
  }, "admin")).data;
}
export async function cancelImport(activityId: number, taskId: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/imports/${taskId}`, { method: "DELETE" }, "admin")).data;
}

export async function waitForImport(activityId: number, taskId: number) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const task = (await api<Envelope<Record<string, unknown>>>(`/admin/activities/${activityId}/imports/${taskId}`)).data;
    if (task.status === "COMPLETED") return task;
    if (task.status === "FAILED" || task.status === "CANCELLED") throw new ApiError(422, String(task.failureCode || "IMPORT_FAILED"), String(task.failureMessage || "导入发布失败"));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new ApiError(408, "IMPORT_TIMEOUT", "导入仍在处理中，请稍后刷新查看");
}

