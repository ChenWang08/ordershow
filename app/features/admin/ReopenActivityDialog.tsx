"use client";

import type { useActivitySettings } from "./useActivitySettings";

export function ReopenActivityDialog({ settings }: { settings: ReturnType<typeof useActivitySettings> }) {
  const { reopenDraft: draft, setReopenDraft, reopenBusy, closeReopenDialog, submitReopen } = settings;
  if (!draft) return null;
  return <div className="drawer-backdrop"><form className="form-drawer compact-drawer reopen-drawer" role="dialog" aria-modal="true" aria-labelledby="reopen-activity-title"
    onSubmit={(event) => { event.preventDefault(); void submitReopen(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); closeReopenDialog(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)"));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header><div><span>{draft.activity.name}</span><h2 id="reopen-activity-title">重新开放订货</h2></div><button type="button" disabled={reopenBusy} onClick={closeReopenDialog} aria-label="关闭重新开放表单">×</button></header>
      <div className="drawer-body">
        <div className="new-activity-note"><b>恢复同一场活动的订货</b><span>保留已有订单和中奖记录，恢复抽奖与实时看板。已失效的客户登录需重新验证。</span></div>
        <label><span>新订货截止时间（北京时间） *</span><input autoFocus type="datetime-local" required disabled={reopenBusy} value={draft.endsAt} onChange={(event) => setReopenDraft({ ...draft, endsAt: event.target.value, error: "" })} /></label>
        <label><span>新整场活动结束时间（北京时间） *</span><input type="datetime-local" required disabled={reopenBusy} min={draft.endsAt || undefined} value={draft.eventEndsAt} onChange={(event) => setReopenDraft({ ...draft, eventEndsAt: event.target.value, error: "" })} /></label>
        <p>当前时间 &lt; 订货截止时间 &lt; 整场活动结束时间</p>
        <label><span>重新开放原因 *</span><textarea required maxLength={500} disabled={reopenBusy} value={draft.reason} onChange={(event) => setReopenDraft({ ...draft, reason: event.target.value, error: "" })} placeholder="例如：误操作截止，需要恢复客户订货" /></label>
        {draft.error && <p role="alert">{draft.error}</p>}
      </div>
      <footer><button type="button" disabled={reopenBusy} onClick={closeReopenDialog}>取消</button><button className="admin-primary" type="submit" disabled={reopenBusy}>{reopenBusy ? "正在重新开放…" : "确认重新开放"}</button></footer>
  </form></div>;
}
