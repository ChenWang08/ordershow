"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, createActivityCopy, discardActivityCopy, loadActivityCopyPreview, loadActivityCopySources, loadActivityCopyTask,
  retryActivityCopy, setPreferredAdminActivityCode, type ActivityCopyPreview, type ActivityCopySelection, type ActivityCopySource,
  type ActivityCopyTask, type CreateActivityInput } from "../../api";

const emptySelection: ActivityCopySelection = { products: false, whitelist: false, lottery: false };
type PendingSubmission = { kind: "submission"; input: CreateActivityInput; source: ActivityCopyPreview; selection: ActivityCopySelection; requestKey: string };
export function copySelectionValid(preview: ActivityCopyPreview | null, sourceId: string, selection: ActivityCopySelection) {
  return Boolean(preview && String(preview.sourceId) === sourceId && (selection.products || selection.whitelist || selection.lottery)
    && (!selection.products || preview.products > 0) && (!selection.whitelist || preview.customers > 0) && (!selection.lottery || preview.rounds > 0));
}
export function useActivityCopy({ open, departmentId, owner, setBusy, notice }: {
  open: boolean; departmentId: string; owner: string; setBusy: (busy: boolean) => void; notice: (message: string) => void;
}) {
  const [enabled, updateEnabled] = useState(false);
  const [sourceChoice, setSourceChoice] = useState({ departmentId: "", id: "" });
  const sourceId = sourceChoice.departmentId === departmentId ? sourceChoice.id : "";
  const [sourceResult, setSourceResult] = useState<{ scope: string; items: ActivityCopySource[]; error: string } | null>(null);
  const [previewResult, setPreviewResult] = useState<{ scope: string; value: ActivityCopyPreview | null; error: string } | null>(null);
  const previewScope = `${departmentId}:${sourceId}`;
  const sources = sourceResult?.scope === departmentId ? sourceResult.items : [];
  const preview = previewResult?.scope === previewScope ? previewResult.value : null;
  const sourceError = (sourceResult?.scope === departmentId ? sourceResult.error : "") || (previewResult?.scope === previewScope ? previewResult.error : "");
  const loading = Boolean(enabled && departmentId && (sourceResult?.scope !== departmentId || (sourceId && previewResult?.scope !== previewScope)));
  const [selection, setSelection] = useState<ActivityCopySelection>(emptySelection);
  const [task, setTask] = useState<ActivityCopyTask | null>(null);
  const [taskError, setTaskError] = useState("");
  const [pending, setPending] = useState<PendingSubmission | null>(null);
  const [refresh, setRefresh] = useState(0);
  const request = useRef({ input: "", key: "" });
  const actionLock = useRef(false);
  const storageKey = `activity-copy:${owner}`;
  const remember = useCallback((value: number | PendingSubmission | null) => {
    try { if (value === null) sessionStorage.removeItem(storageKey); else sessionStorage.setItem(storageKey, typeof value === "number" ? String(value) : JSON.stringify(value)); } catch { /* In-memory progress remains available. */ }
  }, [storageKey]);
  useEffect(() => {
    if (!open || !owner) return;
    let saved = ""; try { saved = sessionStorage.getItem(storageKey) || ""; } catch { return; }
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      if (/^\d+$/.test(saved)) { setTask(current => current?.id === Number(saved) ? current : { id: Number(saved), status: "QUEUED", stage: "QUEUED", copiedFiles: 0, totalFiles: 0 }); setBusy(true); }
      else if (saved) {
        try {
          const value = JSON.parse(saved) as PendingSubmission;
          if (value.kind === "submission" && value.requestKey && value.input && value.source && value.selection) {
            setPending(value); setTaskError("上次提交结果尚未确认，请点击“确认创建结果”继续，系统会避免重复创建。");
          }
        } catch { remember(null); }
      }
    });
    return () => { active = false; };
  }, [open, owner, storageKey, setBusy, remember]);
  useEffect(() => {
    if (!open || !enabled || !departmentId) return;
    const controller = new AbortController();
    void loadActivityCopySources(Number(departmentId), controller.signal).then(items => {
      if (!controller.signal.aborted) setSourceResult({ scope: departmentId, items, error: "" });
    }).catch(error => { if (!controller.signal.aborted) setSourceResult({ scope: departmentId, items: [], error: error instanceof ApiError ? error.message : "历史活动读取失败，请重新打开复用选项重试。" }); });
    return () => controller.abort();
  }, [open, enabled, departmentId]);
  useEffect(() => {
    if (!open || !enabled || !departmentId || !sourceId) return;
    const controller = new AbortController();
    void loadActivityCopyPreview(Number(sourceId), Number(departmentId), controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setPreviewResult({ scope: previewScope, value, error: "" }); setSelection({ products: value.products > 0, whitelist: value.customers > 0, lottery: value.rounds > 0 });
    }).catch(error => { if (!controller.signal.aborted) setPreviewResult({ scope: previewScope, value: null, error: error instanceof ApiError ? error.message : "来源配置读取失败，请重新选择来源活动。" }); });
    return () => controller.abort();
  }, [open, enabled, departmentId, sourceId, previewScope]);
  useEffect(() => {
    if (!open || !task?.id) return;
    const id = task.id; const controller = new AbortController(); let timer: number | undefined;
    let stopped = false, inFlight = false, failures = 0;
    const poll = async () => {
      if (stopped || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const value = await loadActivityCopyTask(id, controller.signal);
        if (controller.signal.aborted) return;
        setTask(value); setTaskError(""); failures = 0;
        if (value.status === "COMPLETED") {
          stopped = true; remember(null); setBusy(false);
          if (value.activityCode) { setPreferredAdminActivityCode(value.activityCode); window.location.assign("/admin"); }
          else setTaskError("复制任务已完成，新活动已被移除。请关闭后重新创建。");
          return;
        }
        if (value.status === "FAILED" || value.status === "CANCELLED") { stopped = true; if (value.status === "CANCELLED") remember(null); setBusy(false); return; }
        setBusy(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (++failures >= 3) { stopped = true; setBusy(false); setTaskError("暂时无法读取进度，可点击“查询进度”重试。后台任务会继续执行。"); return; }
        setTaskError(error instanceof ApiError ? error.message : "暂时无法读取复制进度，正在重试…");
      } finally {
        inFlight = false;
        if (!stopped && !controller.signal.aborted) timer = window.setTimeout(() => void poll(), failures ? 5000 : 2000);
      }
    };
    const onVisible = () => { if (document.visibilityState !== "hidden") { if (timer) window.clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", onVisible); void poll();
    return () => { stopped = true; controller.abort(); if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [open, task?.id, refresh, remember, setBusy]);
  const submit = useCallback(async (submission: PendingSubmission) => {
    remember(submission); setPending(submission); setTaskError(""); setBusy(true);
    try {
      const value = await createActivityCopy(submission.input, submission.source, submission.selection, submission.requestKey);
      remember(value.id); setPending(null); setTask(value);
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
        remember(null); setPending(null);
      } else setTaskError("暂未确认创建结果，请点击“确认创建结果”继续，系统会避免重复创建。");
      throw error;
    }
  }, [remember, setBusy]);
  const retrySubmission = async () => {
    if (!pending || actionLock.current) return;
    actionLock.current = true;
    try { await submit(pending); }
    catch (error) { notice(error instanceof Error ? error.message : "暂未确认创建结果，请稍后重试。"); }
    finally { actionLock.current = false; }
  };
  const start = async (input: CreateActivityInput) => {
    if (actionLock.current || (task && task.status !== "CANCELLED")) return;
    if (pending) { await retrySubmission(); return; }
    if (!copySelectionValid(preview, sourceId, selection)) throw new Error("请选择来源活动和至少一项有效的复制内容。");
    actionLock.current = true;
    try {
      const inputKey = JSON.stringify({ input, preview, selection });
      if (request.current.input !== inputKey) request.current = { input: inputKey, key: crypto.randomUUID() };
      await submit({ kind: "submission", input, source: preview!, selection, requestKey: request.current.key });
    } finally { actionLock.current = false; }
  };
  const retry = async () => {
    if (!task || actionLock.current) return; actionLock.current = true; setBusy(true);
    try { setTask(await retryActivityCopy(task.id)); setRefresh(value => value + 1); }
    catch (error) { setBusy(false); notice(error instanceof Error ? error.message : "重试失败，请稍后再试。"); }
    finally { actionLock.current = false; }
  };
  const discard = async () => {
    if (!task || actionLock.current) return; actionLock.current = true; setBusy(true);
    try { await discardActivityCopy(task.id); remember(null); setTask(null); setTaskError(""); request.current = { input: "", key: "" }; }
    catch (error) { notice(error instanceof Error ? error.message : "放弃复制失败，请重试。"); }
    finally { actionLock.current = false; setBusy(false); }
  };
  const setSourceId = (id: string) => { setSourceChoice({ departmentId, id }); setPreviewResult(null); setSelection(emptySelection); };
  const setEnabled = (value: boolean) => { updateEnabled(value); setSourceResult(null); setSourceId(""); };
  const reset = () => {
    setEnabled(false);
    if (task?.status === "COMPLETED" || task?.status === "CANCELLED") { setTask(null); setTaskError(""); setBusy(false); }
  };
  return { enabled, setEnabled, sourceId, setSourceId, sources, preview, selection, setSelection, loading, sourceError,
    task, pending, taskError, retrySubmission, queryProgress: () => setRefresh(value => value + 1), start, retry, discard, reset };
}
