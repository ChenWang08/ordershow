export const ACTIVITY_CODE = process.env.NEXT_PUBLIC_ACTIVITY_CODE || "2026-mid-autumn";
const ADMIN_ACTIVITY_PREFERENCE_KEY = "order-show.admin.activity-code";

let activeActivityCode = ACTIVITY_CODE;
const activeActivityListeners = new Set<() => void>();

/** Set by routed pages before their client data loading begins. */
export function setActiveActivityCode(activityCode: string) {
  const normalized = activityCode.trim();
  if (!normalized || normalized === activeActivityCode) return;
  activeActivityCode = normalized;
  activeActivityListeners.forEach((listener) => listener());
}

export function getActiveActivityCode() {
  return activeActivityCode;
}

export function getPreferredAdminActivityCode() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ADMIN_ACTIVITY_PREFERENCE_KEY)?.trim() || "";
}

export function setPreferredAdminActivityCode(activityCode: string) {
  const normalized = activityCode.trim();
  if (!normalized || typeof window === "undefined") return;
  window.localStorage.setItem(ADMIN_ACTIVITY_PREFERENCE_KEY, normalized);
}

/** Subscribe to activity changes for components that must wait before loading data. */
export function subscribeActiveActivityCode(listener: () => void) {
  activeActivityListeners.add(listener);
  return () => activeActivityListeners.delete(listener);
}

export function activeActivityPath() {
  return encodeURIComponent(activeActivityCode);
}

