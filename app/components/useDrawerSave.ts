"use client";

import { useRef, useState } from "react";
import type { DrawerSaveResult } from "./drawer-save-result";

export function useDrawerSave(onClose: () => void) {
  const inFlight = useRef(false);
  const blocked = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [requiresReload, setRequiresReload] = useState(false);

  const save = async (submit: () => Promise<DrawerSaveResult>) => {
    if (inFlight.current || blocked.current) return;
    inFlight.current = true;
    setSaving(true);
    setSaveError("");
    try {
      const result = await submit();
      if (result.ok) {
        blocked.current = true;
        onClose();
      } else {
        blocked.current = Boolean(result.requiresReload);
        setRequiresReload(blocked.current);
        setSaveError(result.message);
      }
    } catch {
      blocked.current = true;
      setRequiresReload(true);
      setSaveError("保存结果尚未确认，请先刷新列表核对后再继续操作。");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return { saving, saveError, requiresReload, save };
}
