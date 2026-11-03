"use client";

import { useRef, useState } from "react";
import { useAdminIdentity } from "../../admin-context";
import { changeActivityArchive, loadActivityDeletionPreview, permanentlyDeleteActivity,
  type ActivityDeletionPreview, type RuntimeActivity } from "../../api";

export function ActivityManagementActions({ activity }: { activity: RuntimeActivity }) {
  const identity = useAdminIdentity();
  const [action, setAction] = useState<"archive" | "unarchive" | "delete" | null>(null);
  const [preview, setPreview] = useState<ActivityDeletionPreview | null>(null);
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  if (identity?.roleCode !== "SUPER_ADMIN") return null;
  const archived = activity.status === "ARCHIVED";
  const deletable = ["DRAFT", "FINISHED", "ARCHIVED"].includes(activity.status);
  const open = async (next: "archive" | "unarchive" | "delete") => {
    if (pending.current) return;
    setAction(next); setReason(""); setCode(""); setAcknowledged(false); setError(""); setPreview(null);
    if (next !== "delete") return;
    pending.current = true; setBusy(true);
    try { setPreview(await loadActivityDeletionPreview(activity.id)); }
    catch (e) { setError(e instanceof Error ? e.message : "删除范围加载失败"); }
    finally { pending.current = false; setBusy(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || !action || !reason.trim()) return;
    if (action === "delete" && (!preview || code !== preview.code || !acknowledged)) return;
    pending.current = true; setBusy(true); setError("");
    try {
      if (action === "delete" && preview) {
        await permanentlyDeleteActivity(preview, code, reason.trim());
        sessionStorage.setItem("activity-deletion-progress", "open");
        window.location.assign("/admin");
      } else {
        await changeActivityArchive(activity, action === "archive", reason.trim());
        window.location.reload();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败，请重试"); }
    finally { pending.current = false; setBusy(false); }
  };
  const title = action === "delete" ? "永久删除活动" : action === "archive" ? "归档活动" : "解除归档";
  return <section className="activity-management-actions">
    <h3>活动管理</h3>
    <p>仅超级管理员可操作。归档保留历史记录，永久删除将清理活动及关联数据。</p>
    <div className="activity-card-actions">
      {activity.status === "FINISHED" && <button type="button" onClick={() => void open("archive")}>归档活动</button>}
      {archived && <button type="button" onClick={() => void open("unarchive")}>解除归档</button>}
      {deletable && <button type="button" className="danger-action" onClick={() => void open("delete")}>永久删除</button>}
    </div>
    {action && <div className="drawer-backdrop"><aside className="form-drawer compact-drawer" role="dialog" aria-modal="true" aria-label={title}>
      <form onSubmit={event => void submit(event)}>
        <header><h2>{title}</h2><button type="button" disabled={busy} onClick={() => setAction(null)} aria-label="关闭">×</button></header>
        <div className="drawer-body">
          <p><b>{activity.name}</b><br />{activity.code} · {activity.departmentName}</p>
          {action === "archive" && <p>归档后所有业务数据只读，原有权限的人员仍可查看和导出。</p>}
          {action === "unarchive" && <p>解除归档后恢复为“已结束”，不会自动开放下单。</p>}
          {action === "delete" && <>
            <p role="note" className="warning-box">永久删除不自动备份、不设回收站，已清理的数据不可恢复。确认后活动立即关闭访问，后台分批清理。</p>
            {busy && !preview && <p role="status">正在核对删除范围…</p>}
            {preview && <><dl className="deletion-preview">{[["订单",preview.orders],["商品",preview.products],["客户名单",preview.customers],["中奖记录",preview.winners],["文件",preview.files]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              <label>输入活动编号确认<input required autoComplete="off" value={code} onChange={e => setCode(e.target.value)} disabled={busy} /></label>
              <label className="deletion-acknowledgement"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} disabled={busy} />我已了解：无自动备份，永久删除后不可恢复</label></>}
            {!preview && !busy && <button type="button" onClick={() => void open("delete")}>重新核对删除范围</button>}
          </>}
          <label>操作原因<textarea required maxLength={500} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
          {error && <p role="alert">{error}</p>}
        </div>
        <footer><button type="button" disabled={busy} onClick={() => setAction(null)}>取消</button><button type="submit" className={action === "delete" ? "danger-action" : "admin-primary"}
          disabled={busy || !reason.trim() || (action === "delete" && (!preview || code !== preview.code || !acknowledged))}>{busy ? "正在处理…" : action === "delete" ? "确认永久删除" : title}</button></footer>
      </form>
    </aside></div>}
  </section>;
}
