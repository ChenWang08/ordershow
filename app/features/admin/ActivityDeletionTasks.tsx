"use client";

import { useCallback, useEffect, useState } from "react";
import { loadActivityDeletionTasks, retryActivityDeletionTask, type ActivityDeletionTask } from "../../api";
import { formatBeijingTime } from "../shared/time";

const labels = { QUEUED: "排队中", RUNNING: "清理中", FAILED: "失败待重试", COMPLETED: "已完成" };
export function ActivityDeletionTasks({ onClose }: { onClose: () => void }) {
  const [tasks, setTasks] = useState<ActivityDeletionTask[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const cancelRead = () => {
      window.clearTimeout(timer);
      timer = undefined;
      controller?.abort();
    };
    const load = async () => {
      cancelRead();
      if (!active || document.visibilityState === "hidden") return;
      const request = new AbortController();
      controller = request;
      try {
        const result = await loadActivityDeletionTasks(page, request.signal);
        if (!active || request.signal.aborted) return;
        setTasks(result); setError("");
        if (result.some(task => task.status === "QUEUED" || task.status === "RUNNING")) timer = window.setTimeout(() => void load(), 3000);
      } catch (e) { if (active && !request.signal.aborted) setError(e instanceof Error ? e.message : "进度加载失败，请刷新重试"); }
      finally { if (active && !request.signal.aborted) setLoading(false); }
    };
    const visible = () => {
      cancelRead();
      if (document.visibilityState === "visible") void load();
    };
    void load(); document.addEventListener("visibilitychange", visible);
    return () => { active = false; cancelRead(); document.removeEventListener("visibilitychange", visible); };
  }, [page, revision]);
  const retry = async (id: number) => {
    if (retrying !== null) return;
    setRetrying(id);
    try { await retryActivityDeletionTask(id); refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "重试失败"); }
    finally { setRetrying(null); }
  };
  return <div className="drawer-backdrop"><aside className="form-drawer compact-drawer deletion-task-drawer" role="dialog" aria-modal="true" aria-label="删除进度">
    <header><h2>删除进度</h2><button type="button" aria-label="关闭删除进度" onClick={onClose}>×</button></header>
    <div className="drawer-body" aria-live="polite">
      <p>任务在后台执行，关闭页面不影响清理。已删除的数据无法撤销。</p>
      <button type="button" onClick={refresh}>刷新进度</button>
      {loading && <p role="status">正在加载进度…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !tasks.length && <p>暂无删除任务</p>}
      {tasks.map(task => <article className="deletion-task" key={task.id}>
        <h3>{task.activityName} <span>{labels[task.status]}</span></h3>
        <p>{task.activityCode} · {task.departmentName}</p>
        <p>{task.status === "COMPLETED" ? "数据和文件清理完成" : task.stageName}</p>
        <p>已清理 {task.deletedRows.toLocaleString()} 条数据、{task.deletedFiles.toLocaleString()} 个文件及其图片衍生版本</p>
        <small>{task.requestedByName} · {formatBeijingTime(task.createdAt)} · 原因：{task.reason}</small>
        {task.lastError && <p role="alert">{task.lastError}</p>}
        {task.status === "FAILED" && <button type="button" disabled={retrying !== null} onClick={() => void retry(task.id)}>{retrying === task.id ? "正在提交…" : "继续清理"}</button>}
      </article>)}
    </div>
    <footer><button type="button" disabled={page === 1} onClick={() => setPage(v => v - 1)}>上一页</button><span>第 {page} 页</span><button type="button" disabled={tasks.length < 20} onClick={() => setPage(v => v + 1)}>下一页</button></footer>
  </aside></div>;
}
