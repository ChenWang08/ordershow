"use client";

import type { ActivityStatus } from "../shared/types";
import { ActivityEntryLinksCard } from "./ActivityEntryLinksCard";
import type { useActivitySettings } from "./useActivitySettings";
import type { useActivityOverview } from "./useActivityOverview";

type ActivityOverviewProps = {
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
};

export function ActivityOverview({
  activityCode, activityName, activityStatus, activityEndAt, activityEventEndAt,
  minimumFutureAt, departmentName, settings, overview, onViewOrders,
}: ActivityOverviewProps) {
  const activityStarted = activityStatus === "running" || activityStatus === "closed" || activityStatus === "finished";
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityFinished = activityStatus === "finished";
  const activityPublished = activityStatus !== "draft";
  const { activityNameDraft, setActivityNameDraft, activityStartDraft, setActivityStartDraft, activityEndDraft, setActivityEndDraft, activityEventEndDraft, setActivityEventEndDraft, saveActivityConfig, publishCurrentActivity, withdrawCurrentActivity, closeCurrentActivity, finishCurrentActivity } = settings;
  const { adminStats, progressRows } = overview;
  return (
          <>
            <div className="admin-stats">
              {adminStats.map((item) => <article key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]}</small></article>)}
            </div>
            <div className="admin-grid">
              <article className="progress-card"><h2>客户提交进度</h2>{progressRows.map((item) => <div key={item.label}><p><b>{item.label}</b><span>{item.submitted} / {item.total}</span></p><i><em style={{ width: `${item.percentage}%` }} /></i></div>)}</article>
              <article className="activity-card">
                <h2>活动设置</h2>
                <div className="activity-config-grid"><label><span>活动名称 *</span><input value={activityNameDraft} disabled={activityClosed} onChange={(event) => setActivityNameDraft(event.target.value)} placeholder="例如：2026 年中秋订货会" /></label><label><span>活动编号</span><input value={activityCode} readOnly aria-label="活动编号，只读" /></label><label><span>订货开始时间</span><input type="datetime-local" min={activityStatus === "draft" || activityStatus === "scheduled" ? minimumFutureAt : undefined} value={activityStartDraft} disabled={activityStarted} onChange={(event) => setActivityStartDraft(event.target.value)} /></label><label><span>订货截止时间</span><input type="datetime-local" min={activityStatus === "running" ? activityEndAt : activityStartDraft || minimumFutureAt} value={activityEndDraft} disabled={activityClosed} onChange={(event) => setActivityEndDraft(event.target.value)} /></label><label><span>整场活动结束时间</span><input type="datetime-local" min={activityStatus === "running" || activityStatus === "closed" ? activityEventEndAt : activityEndDraft || minimumFutureAt} value={activityEventEndDraft} disabled={activityFinished} onChange={(event) => setActivityEventEndDraft(event.target.value)} /></label><label><span>活动状态</span><div className={`activity-status-display ${activityStatus}`}>{activityStatus === "draft" ? "草稿" : activityStatus === "scheduled" ? "待开始" : activityStatus === "running" ? "订货中" : activityStatus === "closed" ? "订货已截止" : "活动已结束"}</div></label></div>
                <p><span>当前状态</span><b className={activityClosed ? "closed-text" : activityStarted ? "green" : "pending-text"}>{activityStatus === "draft" ? "草稿 · H5 未发布" : activityStatus === "scheduled" ? `待开始 · ${activityStartDraft.replace("T", " ")} 自动开放` : activityStatus === "running" ? "订货中 · H5 可下单" : activityStatus === "closed" ? "订货已截止 · 抽奖和实时看板可继续" : "活动已结束 · 历史看板和战报只读"}</b></p><p><span>基础数据</span><b className={activityPublished ? "closed-text" : "green"}>{activityPublished ? "商品和白名单已锁定" : "可导入和替换"}</b></p><p><span>运行规则</span><small>{activityFinished ? "抽奖和实时推送已关闭；最终看板与战报可回看" : activityStatus === "closed" ? "订单只读；可继续抽奖，也可延长或立即结束整场活动" : activityStatus === "running" ? "开始时间不可修改；两个结束时间只能延长" : activityStatus === "scheduled" ? "可调整未来时间；修改基础数据请先撤回发布" : "保存设置不会发布活动"}</small></p><div className="activity-card-actions">{!activityFinished && <button className="admin-primary" onClick={() => void saveActivityConfig()}>{activityStatus === "closed" ? "保存延长活动时间" : activityStatus === "running" ? "保存延长时间" : activityStatus === "scheduled" ? "保存时间调整" : "保存活动设置"}</button>}{activityStatus === "draft" && <button onClick={() => void publishCurrentActivity()}>发布活动</button>}{activityStatus === "scheduled" && <button onClick={() => void withdrawCurrentActivity()}>撤回发布</button>}{activityStatus === "running" && <button className="danger-action" onClick={() => void closeCurrentActivity()}>立即截止订货</button>}{activityStatus === "closed" && <button className="danger-action" onClick={() => void finishCurrentActivity()}>结束整场活动</button>}{activityFinished && <button type="button" onClick={() => onViewOrders()}>查看最终数据</button>}</div>
              </article>
             </div>
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
