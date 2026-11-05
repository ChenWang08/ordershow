"use client";

import { useAdminIdentity } from "../../admin-context";
import { canUse, isManager } from "./permissions";
import { formatBeijingTime } from "../shared/time";
import type { ActivityStatus } from "../shared/types";
import { ReopenActivityDialog } from "./ReopenActivityDialog";
import { ActivityEntryLinksCard } from "./ActivityEntryLinksCard";
import { ActivityLiveRoomCard } from "./ActivityLiveRoomCard";
import { ActivityBackgroundCard } from "./ActivityBackgroundCard";
import { ActivityManagementActions } from "./ActivityManagementActions";
import type { useActivitySettings } from "./useActivitySettings";
import type { useActivityOverview } from "./useActivityOverview";
import type { RuntimeActivity } from "../../api";

type ActivityOverviewProps = {
  activityId?: number;
  activityCode: string;
  activityName: string;
  activityStatus: ActivityStatus;
  activityEndAt: string;
  activityEventEndAt: string;
  minimumFutureAt: string;
  departmentName: string;
  settings: ReturnType<typeof useActivitySettings>;
  overview: ReturnType<typeof useActivityOverview>;
  onViewOrders: () => void;
  activity?: RuntimeActivity | null;
  statisticsStale?: boolean;
  onLiveRoomDirtyChange?: (dirty: boolean) => void;
};

export function ActivityOverview({
  activityId, activityCode, activityName, activityStatus, activityEventEndAt,
  minimumFutureAt, departmentName, settings, overview, onViewOrders, activity, statisticsStale, onLiveRoomDirtyChange,
}: ActivityOverviewProps) {
  const identity = useAdminIdentity();
  const archived = activity?.status === "ARCHIVED";
  const manager = isManager(identity) && !archived;
  const activityStarted = activityStatus === "running" || activityStatus === "closed" || activityStatus === "finished";
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityFinished = activityStatus === "finished";
  const activityPublished = activityStatus !== "draft";
  const { activityNameDraft, setActivityNameDraft, activityStartDraft, setActivityStartDraft, activityEndDraft, setActivityEndDraft, activityEventEndDraft, setActivityEventEndDraft, saveActivityConfig, publishCurrentActivity, withdrawCurrentActivity, closeCurrentActivity, finishCurrentActivity } = settings;
  const { adminStats, progressRows } = overview;
  return (
          <>
            <div className="admin-refresh-bar" aria-live="polite">
              <span>{overview.updatedAt ? `最后更新时间：${formatBeijingTime(overview.updatedAt)}` : overview.loading ? "正在加载统计…" : "尚未加载统计，请点击刷新统计"}</span>
              <button type="button" className="admin-primary" disabled={overview.loading || overview.coolingDown} onClick={() => void overview.manualRefresh()}>{overview.loading ? "正在刷新…" : "刷新统计"}</button>
              {overview.error && <span role="alert">统计刷新失败：{overview.error}{overview.loaded ? "；当前保留上次成功的数据" : ""}</span>}
              {statisticsStale && overview.loaded && <span>相关数据有变化，请点击刷新统计。</span>}
            </div>
            <div className="admin-stats">
              {adminStats.map((item) => <article key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]}</small></article>)}
            </div>
            <div className="admin-grid">
              <article className="progress-card"><h2>客户提交进度</h2>{progressRows.map((item) => <div key={item.label}><p><b>{item.label}</b><span>{overview.loaded ? `${item.submitted} / ${item.total}` : "— / —"}</span></p><i><em style={{ width: `${overview.loaded ? item.percentage : 0}%` }} /></i></div>)}</article>
              <article className="activity-card">
                <fieldset className="admin-activity-fields" disabled={settings.activityRefreshing}>
                <h2>活动设置</h2>
                <div className="activity-config-grid"><label><span>活动名称 *</span><input value={activityNameDraft} disabled={!manager || activityClosed} onChange={(event) => setActivityNameDraft(event.target.value)} placeholder="例如：2026 年中秋订货会" /></label><label><span>活动编号</span><input value={activityCode} readOnly aria-label="活动编号，只读" /></label><label><span>订货开始时间（北京时间）</span><input type="datetime-local" min={activityStatus === "draft" || activityStatus === "scheduled" ? minimumFutureAt : undefined} value={activityStartDraft} disabled={!manager || activityStarted} onChange={(event) => setActivityStartDraft(event.target.value)} /></label><label><span>订货截止时间（北京时间）</span><input type="datetime-local" min={activityStatus === "running" ? minimumFutureAt : activityStartDraft || minimumFutureAt} value={activityEndDraft} disabled={!manager || activityClosed} onChange={(event) => setActivityEndDraft(event.target.value)} /></label><label><span>整场活动结束时间（北京时间）</span><input type="datetime-local" min={activityStatus === "closed" ? activityEventEndAt : activityEndDraft || minimumFutureAt} value={activityEventEndDraft} disabled={!manager || activityFinished} onChange={(event) => setActivityEventEndDraft(event.target.value)} /></label><label><span>活动状态</span><div className={`activity-status-display ${activityStatus}`}>{archived ? "已归档" : activityStatus === "draft" ? "草稿" : activityStatus === "scheduled" ? "待开始" : activityStatus === "running" ? "订货中" : activityStatus === "closed" ? "订货已截止" : "活动已结束"}</div></label></div>
                <p><span>当前状态</span><b className={activityClosed ? "closed-text" : activityStarted ? "green" : "pending-text"}>{activityStatus === "draft" ? "草稿 · H5 未发布" : activityStatus === "scheduled" ? `待开始 · ${activityStartDraft.replace("T", " ")} 自动开放` : activityStatus === "running" ? "订货中 · H5 可下单" : activityStatus === "closed" ? "订货已截止 · 抽奖和实时看板可继续" : "活动已结束 · 历史看板和战报只读"}</b></p><p><span>基础数据</span><b className={activityPublished ? "closed-text" : "green"}>{activityPublished ? "商品和白名单已锁定" : "可导入和替换"}</b></p><p><span>运行规则</span><small>{activityFinished ? "抽奖和实时推送已关闭；最终看板与战报可回看" : activityStatus === "closed" ? "订单只读；可继续抽奖，也可延长或立即结束整场活动" : activityStatus === "running" ? "开始时间不可修改；当前时间须早于订货截止时间，整场结束须晚于订货截止" : activityStatus === "scheduled" ? "可调整未来时间；修改基础数据请先撤回发布" : "保存设置不会发布活动"}</small></p><div className="activity-card-actions">{manager && <>{activityClosed && <button className="admin-primary" disabled={settings.reopenBusy} onClick={() => void settings.openReopenDialog()}>重新开放订货</button>}{!activityFinished && <button className="admin-primary" onClick={() => void saveActivityConfig()}>{activityStatus === "closed" ? "保存延长活动时间" : activityStatus === "running" ? "保存时间调整" : activityStatus === "scheduled" ? "保存时间调整" : "保存活动设置"}</button>}{activityStatus === "draft" && <button onClick={() => void publishCurrentActivity()}>发布活动</button>}{activityStatus === "scheduled" && <button onClick={() => void withdrawCurrentActivity()}>撤回发布</button>}{activityStatus === "running" && <button className="danger-action" onClick={() => void closeCurrentActivity()}>立即截止订货</button>}{activityStatus === "closed" && <button className="danger-action" onClick={() => void finishCurrentActivity()}>结束整场活动</button>}</>}{activityFinished && canUse(identity, "ORDER") && <button type="button" onClick={() => onViewOrders()}>查看最终数据</button>}</div>
                </fieldset>
                {activity && <ActivityManagementActions activity={activity} />}
              </article>
             </div>
             {manager && <ReopenActivityDialog settings={settings} />}
             {activityId && <ActivityBackgroundCard key={`background-${activityId}`} activityId={activityId} editable={manager} initialActivity={activity} />}
             {activityId && <ActivityLiveRoomCard key={activityId} activityId={activityId} editable={manager} initialActivity={activity} onDirtyChange={onLiveRoomDirtyChange} />}
             <ActivityEntryLinksCard
               key={activityCode}
               activityCode={activityCode}
               activityName={activityName}
               activityStatus={activityStatus}
                departmentName={departmentName}
             />
           </>
  );
}
