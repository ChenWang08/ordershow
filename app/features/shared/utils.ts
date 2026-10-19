import type { ActivityStatus } from "./types";
import { toBeijingDateTimeLocal } from "./time";

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

export function maskPhone(value: string) {
  return value.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

export function money(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


export function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}


export const toDateTimeLocal = toBeijingDateTimeLocal;

export function nextMinuteDateTimeLocal() {
  const next = new Date();
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);
  return toDateTimeLocal(next.toISOString());
}

export function runtimeActivityStatus(status: string): ActivityStatus {
  return status === "ACTIVE" ? "running" : status === "CLOSED" ? "closed" : status === "FINISHED" || status === "ARCHIVED" ? "finished" : status === "SCHEDULED" ? "scheduled" : "draft";
}

