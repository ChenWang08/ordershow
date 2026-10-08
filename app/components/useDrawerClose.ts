"use client";

import { useState } from "react";

// Compare form values, not object insertion order or UI-only search state.
export function formSignature(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
}

export function confirmDrawerClose(dirty: boolean, busy = false): boolean {
  return !busy && (!dirty || window.confirm("存在未保存的修改，确定放弃并关闭？"));
}

// Form drawers mount for each editing session; successful saves bypass this guard.
export function useDrawerClose(value: unknown, onClose: () => void, busy = false) {
  const signature = formSignature(value);
  const [initialSignature] = useState(signature);
  return () => { if (confirmDrawerClose(signature !== initialSignature, busy)) onClose(); };
}
