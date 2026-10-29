import { formatBeijingTime } from "../shared/time";

export function ScreenRefreshControls({ refreshing, refreshedAt, historical, disabled = false, onRefresh }: {
  refreshing: boolean;
  refreshedAt: string | null;
  historical: boolean;
  disabled?: boolean;
  onRefresh: () => void;
}) {
  return <div className="screen-refresh-controls" aria-busy={refreshing}>
    <em>{historical ? "历史回看" : "手动更新"}</em>
    <button type="button" onClick={onRefresh} disabled={disabled || refreshing}>{refreshing ? "刷新中…" : "↻ 手动刷新"}</button>
    <small aria-live="polite">{refreshedAt ? `最近刷新 ${formatBeijingTime(refreshedAt)}` : refreshing ? "正在加载数据" : "尚未加载数据"}</small>
  </div>;
}
