"use client";

import { useAdminIdentity } from "../../admin-context";
import { setPreferredAdminActivityCode } from "../../api";
import { isManager } from "./permissions";
import type { useAdminActivities } from "./useAdminActivities";
import { ActivityDeletionTasks } from "./ActivityDeletionTasks";

const statusLabels: Record<string, string> = { DRAFT: "草稿", SCHEDULED: "待开始", ACTIVE: "订货中", CLOSED: "订货已截止", FINISHED: "活动已结束", ARCHIVED: "已归档" };
export function ActivitySwitcher({ activities, activityCode = "", activityName = "暂无活动" }: {
  activities: ReturnType<typeof useAdminActivities>; activityCode?: string; activityName?: string;
}) {
  const identity = useAdminIdentity();
  const a = activities;
  return <><div className="activity-switcher"><button type="button" onClick={() => a.setActivityMenuOpen(v => !v)}><span>当前活动</span><b>{activityName}</b><em>⌄</em></button>
    {a.activityMenuOpen && <div className="activity-switcher-menu">
      <div><b>切换活动</b>{isManager(identity) && <button type="button" onClick={a.openNewActivity}>＋ 新建活动</button>}</div>
      <label className="activity-department-filter"><span>活动范围</span><select aria-label="活动范围" value={a.activityArchiveFilter} onChange={e => a.setActivityArchiveFilter(e.target.value)}><option value="unarchived">未归档</option><option value="archived">已归档</option><option value="all">全部</option></select></label>
      {identity?.roleCode === "SUPER_ADMIN" && <label className="activity-department-filter"><span>按部门筛选</span><select value={a.activityDepartmentFilter} onChange={e => a.setActivityDepartmentFilter(e.target.value)}><option value="">全部部门</option>{a.departments.filter(d => d.status === "ACTIVE").map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
      {a.visibleActivities.map(activity => <button type="button" className={activity.code === activityCode ? "active" : ""} key={activity.id} onClick={() => {
        if (activity.code === activityCode) return; setPreferredAdminActivityCode(activity.code); window.location.assign("/admin");
      }}><span><b>{activity.name}</b><small>{activity.code}{identity?.roleCode === "SUPER_ADMIN" ? ` · ${activity.departmentName || ""}` : ""}</small></span><em className={activity.status === "ARCHIVED" ? "archived" : ""}>{statusLabels[activity.status] || activity.status}</em></button>)}
      {!a.visibleActivities.length && <p>当前筛选下暂无活动</p>}
      {identity?.roleCode === "SUPER_ADMIN" && <button type="button" onClick={() => { a.setActivityMenuOpen(false); a.setDeletionTasksOpen(true); }}>删除进度</button>}
    </div>}
  </div>{identity?.roleCode === "SUPER_ADMIN" && a.deletionTasksOpen && <ActivityDeletionTasks onClose={() => a.setDeletionTasksOpen(false)} />}</>;
}
