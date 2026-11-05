"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, cancelOrderExport, createOrderExport, loadOrderExports, type OrderExportFilters, type OrderExportTask } from "../../api";
import { createIdempotencyKey } from "../../services/api/idempotency-key";

export function useOrderExports(activityId: number, owner: number | undefined, allowed: boolean, active: boolean, filters: OrderExportFilters) {
  const [tasks, setTasks] = useState<OrderExportTask[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const scope = `${activityId}:${owner}:${allowed}`;
  const [previousScope, setPreviousScope] = useState(scope);
  if (scope !== previousScope) {
    setPreviousScope(scope); setTasks([]); setError(""); setBusy(false); setLoading(false);
  }
  const epoch = useRef(0);
  const mutation = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const reading = useRef(false);

  useEffect(() => {
    const version = ++epoch.current;
    mutation.current?.abort(); pending.current = false; request.current = null;
    return () => { epoch.current = version + 1; mutation.current?.abort(); };
  }, [activityId, owner, allowed]);

  useEffect(() => {
    if (!allowed || !active) return;
    let stopped = false, running = false, timer: number | undefined, controller: AbortController | undefined;
    const stopRequest = () => { controller?.abort(); running = false; reading.current = false; window.clearTimeout(timer); };
    const load = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      if (running) return;
      stopRequest(); controller = new AbortController(); const current = controller;
      reading.current = true; running = true;
      setLoading(true);
      try {
        const rows = await loadOrderExports(activityId, current.signal);
        if (stopped || current.signal.aborted) return;
        setTasks(rows); setError(""); setCheckedAt(Date.now());
        if (rows.some(task => task.status === "PENDING" || task.status === "RUNNING")) timer = window.setTimeout(() => void load(), 5000);
        else {
          const expiry = Math.min(...rows.filter(task => task.status === "COMPLETED" && task.expiresAt).map(task => Date.parse(task.expiresAt!)).filter(time => time > Date.now()));
          if (Number.isFinite(expiry)) timer = window.setTimeout(() => void load(), Math.min(2147483647, expiry - Date.now() + 1000));
        }
      } catch (reason) {
        if (stopped || current.signal.aborted) return;
        setError(message(reason));
        // Back off on a temporary error; permissions and missing activities must be refreshed by the workspace.
        if (!(reason instanceof ApiError) || reason.status >= 500) timer = window.setTimeout(() => void load(), 15000);
      } finally { if (!stopped && controller === current) { running = false; reading.current = false; setLoading(false); } }
    };
    const visibility = () => { if (document.visibilityState === "hidden") stopRequest(); else void load(); };
    document.addEventListener("visibilitychange", visibility); void load();
    return () => { stopped = true; stopRequest(); document.removeEventListener("visibilitychange", visibility); };
  }, [activityId, owner, allowed, active, reload]);

  async function mutate(action: (signal: AbortSignal) => Promise<OrderExportTask>) {
    if (!allowed || pending.current) return;
    const version = epoch.current;
    const controller = new AbortController(); mutation.current = controller; pending.current = true;
    setBusy(true); setError("");
    try {
      const task = await action(controller.signal);
      if (version !== epoch.current || controller.signal.aborted) return;
      setTasks(rows => [task, ...rows.filter(row => row.id !== task.id)].slice(0, 20));
      setReload(value => value + 1);
      return task;
    } catch (reason) {
      if (version === epoch.current && !controller.signal.aborted) setError(message(reason));
    } finally {
      if (version === epoch.current) { pending.current = false; setBusy(false); }
    }
  }
  async function create() {
    if (!allowed || pending.current) return;
    const normalized = { status: filters.status || null, customerType: filters.customerType || null, keyword: filters.keyword?.trim() || null };
    const signature = JSON.stringify(normalized);
    if (request.current?.signature !== signature) request.current = { signature, key: createIdempotencyKey() };
    const key = request.current.key;
    const result = await mutate(signal => createOrderExport(activityId, normalized, key, signal));
    if (result && request.current?.key === key) request.current = null;
  }
  const refresh = () => {
    if (!allowed || !active || reading.current) return;
    reading.current = true;
    setLoading(true);
    setReload(value => value + 1);
  };
  return { tasks, error, busy, loading, checkedAt, create, cancel: (id: number) => mutate(signal => cancelOrderExport(activityId, id, signal)), refresh };
}
function message(reason: unknown) {
  const detail = reason instanceof Error ? reason.message : "导出请求失败，请稍后重试";
  return reason instanceof ApiError && reason.traceId ? `${detail}（排查编号：${reason.traceId}）` : detail;
}
