"use client";

import { useEffect, useState } from "react";
import { ApiError, loadAdminActivity, updateActivityLiveRoom, type RuntimeActivity } from "../../api";
import { validLiveRoomUrl } from "../shared/live-room";

export function ActivityLiveRoomCard({ activityId, editable, initialActivity, onDirtyChange }: { activityId: number; editable: boolean; initialActivity?: RuntimeActivity | null; onDirtyChange?: (dirty: boolean) => void }) {
  const [activity, setActivity] = useState<RuntimeActivity | null>(initialActivity ?? null);
  const [draft, setDraft] = useState(initialActivity?.liveRoomUrl || "");
  const [source, setSource] = useState(initialActivity);
  if (source !== initialActivity) {
    setSource(initialActivity);
    if (initialActivity) {
      setActivity(initialActivity);
      if (draft === (source?.liveRoomUrl || "")) setDraft(initialActivity.liveRoomUrl || "");
    }
  }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (initialActivity) return;
    let active = true;
    loadAdminActivity(activityId).then(value => {
      if (active) { setActivity(value); setDraft(value.liveRoomUrl || ""); }
    }).catch(() => { if (active) setNotice("直播间配置加载失败，请刷新页面重试。"); });
    return () => { active = false; };
  }, [activityId, initialActivity]);
  useEffect(() => { onDirtyChange?.(draft !== (activity?.liveRoomUrl || "")); }, [draft, activity, onDirtyChange]);
  async function save() {
    if (!activity || busy) return;
    if (draft.trim() && !validLiveRoomUrl(draft)) { setNotice("请填写有效的 HTTPS 直播间完整链接。"); return; }
    setBusy(true);
    try {
      const updated = await updateActivityLiveRoom(activity, draft);
      setActivity(updated); setDraft(updated.liveRoomUrl || "");
      setNotice("直播间链接已保存，新打开或刷新的订货页面将使用此配置。");
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : "保存失败，请稍后重试。");
    } finally { setBusy(false); }
  }
  const preview = validLiveRoomUrl(draft);
  return <article className="activity-card" style={{ marginTop: 20 }}>
    <h2>直播间链接</h2>
    <div className="activity-config-grid"><label style={{ gridColumn: "1 / -1" }}>
      <span>微赞直播间完整链接</span>
      <input type="url" maxLength={2048} value={draft} disabled={!editable || !activity || busy}
        placeholder="https://…" onChange={event => setDraft(event.target.value)} />
    </label></div>
    <p><small>配置后，订货 H5 右上角显示圆圈退出按钮，点击返回此直播间；清空并保存后不显示。</small></p>
    <div className="activity-card-actions">
      {editable && <button className="admin-primary" disabled={!activity || busy} onClick={() => void save()}>{busy ? "保存中…" : "保存直播间链接"}</button>}
      {preview && <a href={preview} target="_blank" rel="noopener noreferrer">打开直播间</a>}
    </div>
    {notice && <p role="status">{notice}</p>}
  </article>;
}
