import { ApiError } from "../api";

export type DrawerSaveResult = { ok: true } | { ok: false; message: string; requiresReload?: boolean };

export function saveFailure(message: string, requiresReload = false): DrawerSaveResult {
  return { ok: false, message, requiresReload };
}

export function saveRequestFailure(error: unknown, fallback: string, creating = false): DrawerSaveResult {
  const uncertain = creating && (!(error instanceof ApiError) || error.status >= 500);
  const message = error instanceof ApiError ? error.message : fallback;
  return saveFailure(uncertain ? `${message}。新增结果尚未确认，请先刷新列表核对是否已添加，再继续操作。` : message, uncertain);
}
