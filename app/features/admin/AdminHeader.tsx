"use client";

import { isManager, roleLabel } from "./permissions";
import type { Dispatch, SetStateAction } from "react";
import { ActivitySwitcher } from "./ActivitySwitcher";
import { useAdminIdentity, useAdminSession } from "../../admin-context";
import type { ActivityStatus } from "../shared/types";
import type { OperationLogEntry } from "./admin-types";
import type { useAdminActivities } from "./useAdminActivities";

type AdminHeaderProps = {
  activityCode: string;
  activityName: string;
  activityStatus: ActivityStatus;
  tab: string;
  activities: ReturnType<typeof useAdminActivities>;
  operationLogs: OperationLogEntry[];
  operationLogOpen: boolean;
  setOperationLogOpen: Dispatch<SetStateAction<boolean>>;
  logQuery?: { loading: boolean; error: string; refresh: () => Promise<unknown> };
};

export function AdminHeader({ activityCode, activityName, activityStatus, tab, activities,
  operationLogs, operationLogOpen, setOperationLogOpen, logQuery,
}: AdminHeaderProps) {
  const adminIdentity = useAdminIdentity();
  const adminSession = useAdminSession();
  const activityStarted = activityStatus === "running" || activityStatus === "closed" || activityStatus === "finished";
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityPublished = activityStatus !== "draft";
  return (
        <header>
           <div className="admin-heading"><ActivitySwitcher activities={activities} activityCode={activityCode} activityName={activityName} /><strong>{tab}</strong></div>
          <div className="admin-actions">{isManager(adminIdentity) && <button type="button" onClick={() => setOperationLogOpen((value) => !value)}>操作日志{operationLogs.length > 0 ? ` · ${operationLogs.length}` : ""}</button>}<span className={activityClosed ? "closed" : activityStarted ? "" : "pending"}>{activities.currentActivity?.status === "ARCHIVED" ? "已归档" : activityStatus === "draft" ? "草稿" : activityStatus === "scheduled" ? "待开始" : activityStatus === "running" ? "订货中" : activityStatus === "closed" ? "订货已截止" : "活动已结束"}</span>{activityPublished && <span className="locked">商品和白名单已锁定</span>}<div className="admin-identity-summary"><div><b>{adminIdentity?.displayName || adminIdentity?.username || "管理员"}</b><small>{roleLabel(adminIdentity)} · {adminIdentity?.departmentName || "全部部门"}</small></div><button type="button" className="admin-logout-button" onClick={() => void adminSession?.logout()} disabled={!adminSession || adminSession.busy}>退出登录</button></div>{adminSession?.error && <span className="admin-logout-error" role="alert">{adminSession.error}</span>}{operationLogOpen && <div className="operation-log-popover"><div><b>操作日志</b><button type="button" onClick={() => setOperationLogOpen(false)}>×</button></div>{logQuery?.loading && <p>正在读取操作记录…</p>}{logQuery?.error && <p role="alert">{logQuery.error}<button type="button" disabled={logQuery.loading} onClick={() => void logQuery.refresh()}>重试</button></p>}{operationLogs.length === 0 ? <p>暂无操作记录</p> : operationLogs.slice(0, 8).map((entry) => <article key={entry.id}><b>{entry.action}</b><span>{entry.target}</span><small>{entry.detail}</small><em>{entry.operator} · {entry.time}</em></article>)}</div>}</div>
        </header>
  );
}
