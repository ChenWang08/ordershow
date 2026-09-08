"use client";

import type { Dispatch, SetStateAction } from "react";
import { setPreferredAdminActivityCode } from "../../api";
import { useAdminIdentity, useAdminSession } from "../../admin-context";
import type { ActivityStatus } from "../shared/types";
import { runtimeActivityStatus } from "../shared/utils";
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
};

export function AdminHeader({ activityCode, activityName, activityStatus, tab, activities,
  operationLogs, operationLogOpen, setOperationLogOpen,
}: AdminHeaderProps) {
  const adminIdentity = useAdminIdentity();
  const adminSession = useAdminSession();
  const activityStarted = activityStatus === "running" || activityStatus === "closed" || activityStatus === "finished";
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityPublished = activityStatus !== "draft";
  const { activityMenuOpen, setActivityMenuOpen, openNewActivity, activityDepartmentFilter, setActivityDepartmentFilter, departments, visibleActivities } = activities;
  return (
        <header>
           <div className="admin-heading"><div className="activity-switcher"><button type="button" onClick={() => setActivityMenuOpen((value) => !value)}><span>当前活动</span><b>{activityName}</b><em>⌄</em></button>{activityMenuOpen && <div className="activity-switcher-menu"><div><b>切换活动</b><button type="button" onClick={openNewActivity}>＋ 新建活动</button></div>{adminIdentity?.roleCode === "SUPER_ADMIN" && <label className="activity-department-filter"><span>按部门筛选</span><select value={activityDepartmentFilter} onChange={(event) => setActivityDepartmentFilter(event.target.value)}><option value="">全部部门</option>{departments.filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{visibleActivities.map((activity) => <button type="button" className={activity.code === activityCode ? "active" : ""} key={activity.id} onClick={() => { setPreferredAdminActivityCode(activity.code); window.location.assign("/admin"); }}><span><b>{activity.name}</b><small>{activity.code}{adminIdentity?.roleCode === "SUPER_ADMIN" && activity.departmentName ? ` · ${activity.departmentName}` : ""}</small></span><em className={runtimeActivityStatus(activity.status)}>{runtimeActivityStatus(activity.status) === "draft" ? "草稿" : runtimeActivityStatus(activity.status) === "scheduled" ? "待开始" : runtimeActivityStatus(activity.status) === "running" ? "订货中" : runtimeActivityStatus(activity.status) === "closed" ? "订货已截止" : "活动已结束"}</em></button>)}</div>}</div><strong>{tab}</strong></div>
          <div className="admin-actions"><button type="button" onClick={() => setOperationLogOpen((value) => !value)}>操作日志{operationLogs.length > 0 ? ` · ${operationLogs.length}` : ""}</button><span className={activityClosed ? "closed" : activityStarted ? "" : "pending"}>{activityStatus === "draft" ? "草稿" : activityStatus === "scheduled" ? "待开始" : activityStatus === "running" ? "订货中" : activityStatus === "closed" ? "订货已截止" : "活动已结束"}</span>{activityPublished && <span className="locked">商品和白名单已锁定</span>}<div className="admin-identity-summary"><div><b>{adminIdentity?.displayName || adminIdentity?.username || "管理员"}</b><small>{adminIdentity?.roleCode === "SUPER_ADMIN" ? "超级管理员" : "部门账号"} · {adminIdentity?.departmentName || "全部部门"}</small></div><button type="button" className="admin-logout-button" onClick={() => void adminSession?.logout()} disabled={!adminSession || adminSession.busy}>退出登录</button></div>{adminSession?.error && <span className="admin-logout-error" role="alert">{adminSession.error}</span>}{operationLogOpen && <div className="operation-log-popover"><div><b>操作日志</b><button type="button" onClick={() => setOperationLogOpen(false)}>×</button></div>{operationLogs.length === 0 ? <p>暂无操作记录</p> : operationLogs.slice(0, 8).map((entry) => <article key={entry.id}><b>{entry.action}</b><span>{entry.target}</span><small>{entry.detail}</small><em>{entry.operator} · {entry.time}</em></article>)}</div>}</div>
        </header>
  );
}
