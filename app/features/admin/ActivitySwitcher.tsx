"use client";

import { useAdminIdentity } from "../../admin-context";
import { setPreferredAdminActivityCode } from "../../api";
import { isManager } from "./permissions";
import type { useAdminActivities } from "./useAdminActivities";

const statusLabels: Record<string, string> = { DRAFT: "草稿", SCHEDULED: "待开始", ACTIVE: "订货中", CLOSED: "订货已截止", FINISHED: "活动已结束", ARCHIVED: "活动已结束" };
const statusClasses: Record<string, string> = { DRAFT: "draft", SCHEDULED: "scheduled", ACTIVE: "running", CLOSED: "ended", FINISHED: "finished", ARCHIVED: "finished" };
export function ActivitySwitcher({ activities, activityCode = "", activityName = "暂无活动" }: {
  activities: ReturnType<typeof useAdminActivities>; activityCode?: string; activityName?: string;
}) {
  const identity = useAdminIdentity();
  const a = activities;
  return <div className="activity-switcher"><button type="button" onClick={() => a.setActivityMenuOpen(v => !v)}><span>当前活动</span><b>{activityName}</b><em>⌄</em></button>
    {a.activityMenuOpen && <div className="activity-switcher-menu">
      <div><b>切换活动</b>{isManager(identity) && <button type="button" onClick={a.openNewActivity}>＋ 新建活动</button>}</div>
      {identity?.roleCode === "SUPER_ADMIN" && <label className="activity-department-filter"><span>按部门筛选</span><select value={a.activityDepartmentFilter} onChange={e => a.setActivityDepartmentFilter(e.target.value)}><option value="">全部部门</option>{a.departments.filter(d => d.status === "ACTIVE").map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
      {a.visibleActivities.map(activity => <button type="button" className={activity.code === activityCode ? "active" : ""} key={activity.id} onClick={() => {
        if (activity.code === activityCode) return; setPreferredAdminActivityCode(activity.code); window.location.assign("/admin");
      }}><span><span className="activity-menu-title"><b title={activity.name}>{activity.name}</b>{(activity.status === "FINISHED" || activity.status === "ARCHIVED") && <span className={`activity-archive-badge ${activity.status === "ARCHIVED" ? "archived" : "unarchived"}`}>{activity.status === "ARCHIVED" ? "已归档" : "未归档"}</span>}</span><small>{activity.code}{identity?.roleCode === "SUPER_ADMIN" ? ` · ${activity.departmentName || ""}` : ""}</small></span><em className={statusClasses[activity.status]}>{statusLabels[activity.status] || activity.status}</em></button>)}
      {!a.visibleActivities.length && <p>当前筛选下暂无活动</p>}
    </div>}
  </div>;
}
