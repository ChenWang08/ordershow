"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadActivityDeletionTasks, pauseActivityDeletionTask, resumeActivityDeletionTask, retryActivityDeletionTask, type ActivityDeletionTask } from "../../api";
import { formatBeijingTime } from "../shared/time";

const labels = { QUEUED: "排队中", RUNNING: "清理中", PAUSED: "已暂停", FAILED: "失败待重试", COMPLETED: "已完成" };
type TaskAction = "pause" | "resume" | "retry";
export function ActivityDeletionTasks({ onClose }: { onClose: () => void }) {
  const [tasks, setTasks] = useState<ActivityDeletionTask[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<{ id: number; kind: TaskAction } | null>(null);
  const acting = useRef(false);
  const [revision, setRevision] = useState(0);
  const reading = useRef(false);
  const refresh = useCallback(() => setRevision(v => v + 1), []);
  const manualRefresh = () => {
    if (reading.current) return;
    reading.current = true;
    setLoading(true);
    refresh();
  };
  useEffect(() => {
    let active = true;
    let running = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const cancelRead = () => {
      window.clearTimeout(timer);
      timer = undefined;
      controller?.abort();
      running = false;
      reading.current = false;
    };
    const load = async () => {
      if (!active || document.visibilityState === "hidden") return;
      if (running) return;
      cancelRead();
      const request = new AbortController();
      controller = request;
      reading.current = true; running = true;
      setLoading(true);
      try {
        const result = await loadActivityDeletionTasks(page, request.signal);
        if (!active || request.signal.aborted) return;
        setTasks(result); setError("");
        if (result.some(task => task.status === "QUEUED" || task.status === "RUNNING")) timer = window.setTimeout(() => void load(), 3000);
      } catch (e) { if (active && !request.signal.aborted) setError(e instanceof Error ? e.message : "进度加载失败，请刷新重试"); }
      finally { if (active && controller === request) { running = false; reading.current = false; setLoading(false); } }
    };
    const visible = () => {
      cancelRead();
      if (document.visibilityState === "visible") void load();
    };
    void load(); document.addEventListener("visibilitychange", visible);
    return () => { active = false; cancelRead(); document.removeEventListener("visibilitychange", visible); };
  }, [page, revision]);
  const changeTask = async (id: number, kind: TaskAction) => {
    if (acting.current) return;
    acting.current = true; setAction({ id, kind }); setError("");
    try {
      await ({ pause: pauseActivityDeletionTask, resume: resumeActivityDeletionTask, retry: retryActivityDeletionTask })[kind](id);
      refresh();
    }
    catch (e) { setError(e instanceof Error ? e.message : "操作失败，请刷新进度后重试"); }
    finally { acting.current = false; setAction(null); }
  };
  return <div className="drawer-backdrop"><aside className="form-drawer compact-drawer deletion-task-drawer" role="dialog" aria-modal="true" aria-label="删除进度">
    <header><h2>删除进度</h2><button type="button" aria-label="关闭删除进度" onClick={onClose}>×</button></header>
    <div className="drawer-body" aria-live="polite">
      <p>任务在后台执行，关闭页面不影响清理。已删除的数据无法撤销。</p>
      <p>暂停将在当前批次结束后生效；暂停期间活动仍不可用，继续时从原进度清理。</p>
      <button type="button" disabled={loading} onClick={manualRefresh}>刷新进度</button>
      {loading && <p role="status">正在加载进度…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !tasks.length && <p>暂无删除任务</p>}
      {tasks.map(task => <article className="deletion-task" key={task.id}>
        <h3>{task.activityName} <span>{task.status === "RUNNING" && task.lastError ? "等待自动重试" : labels[task.status]}</span></h3>
        <p>{task.activityCode} · {task.departmentName}</p>
        <p>{task.status === "COMPLETED" ? "数据和文件清理完成" : <>{task.stageDetail || task.stageName}{task.totalStages ? `（步骤 ${task.stage}/${task.totalStages}）` : ""}</>}</p>
        <p>已清理 {task.deletedRows.toLocaleString()} 条数据、{task.deletedFiles.toLocaleString()} 个文件及其图片衍生版本</p>
        <small>{task.requestedByName} · {formatBeijingTime(task.createdAt)} · 原因：{task.reason}</small>
        {task.lastProgressAt && <p>最近推进：{formatBeijingTime(task.lastProgressAt)}</p>}
        {task.status === "RUNNING" && task.lastError && <p role="status">本批已失败 {task.retryCount}/{task.maxRetries} 次，正在自动重试。下次尝试：{formatBeijingTime(task.nextAttemptAt)}。{task.lastError}</p>}
        {task.status === "FAILED" && <p role="alert">本批连续失败 {task.retryCount}/{task.maxRetries} 次，已停止自动重试。{task.lastError}</p>}
        {task.status === "PAUSED" && task.lastError && <p>暂停前提示：{task.lastError}</p>}
        {(task.status === "QUEUED" || task.status === "RUNNING") && <button type="button" disabled={action !== null} onClick={() => void changeTask(task.id, "pause")}>{action?.id === task.id && action.kind === "pause" ? "正在等待当前批次结束…" : "暂停清理"}</button>}
        {(task.status === "FAILED" || task.status === "PAUSED") && <button type="button" disabled={action !== null} onClick={() => void changeTask(task.id, task.status === "PAUSED" ? "resume" : "retry")}>{action?.id === task.id ? "正在提交…" : "继续清理"}</button>}
      </article>)}
    </div>
    <footer><button type="button" disabled={page === 1} onClick={() => setPage(v => v - 1)}>上一页</button><span>第 {page} 页</span><button type="button" disabled={tasks.length < 20} onClick={() => setPage(v => v + 1)}>下一页</button></footer>
  </aside></div>;
}
