"use client";

import { useState } from "react";
import { useDrawerClose } from "../../components/useDrawerClose";
import { useAdminIdentity } from "../../admin-context";
import type { useAdminActivities } from "./useAdminActivities";

export function NewActivityDrawer({ activities }: { activities: ReturnType<typeof useAdminActivities> }) {
  const adminIdentity = useAdminIdentity();
  const { creatingActivity, setNewActivityOpen, newActivity, setNewActivity, departments, minimumFutureAt, submitNewActivity } = activities;
  const [initialActivity] = useState(newActivity);
  const requestClose = useDrawerClose(newActivity, () => { setNewActivity(initialActivity); setNewActivityOpen(false); }, creatingActivity);
  return (
    <div className="drawer-backdrop"><aside className="form-drawer compact-drawer" onClick={(event) => event.stopPropagation()}><header><div><span>多活动管理</span><h2>新建活动</h2></div><button type="button" disabled={creatingActivity} onClick={requestClose}>×</button></header><div className="drawer-body"><div className="new-activity-note"><b>创建后为草稿状态</b><span>订货截止后仍可现场抽奖；整场活动结束后冻结看板与战报。</span></div>{adminIdentity?.roleCode === "SUPER_ADMIN" && <label><span>所属部门 *</span><select value={newActivity.departmentId} onChange={(event) => setNewActivity((value) => ({ ...value, departmentId: event.target.value }))}><option value="">请选择部门</option>{departments.filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.name}（{item.code}）</option>)}</select></label>}<label><span>活动名称 *</span><input value={newActivity.name} onChange={(event) => setNewActivity((value) => ({ ...value, name: event.target.value }))} placeholder="例如：2027 年春节订货会" /></label><div className="generated-activity-no"><span>活动编号</span><b>创建后自动生成</b><small>用于后台识别、报表和数据关联，创建后不可修改</small></div><label><span>订货开始时间（北京时间） *</span><input type="datetime-local" min={minimumFutureAt} value={newActivity.startsAt} onChange={(event) => setNewActivity((value) => ({ ...value, startsAt: event.target.value }))} /></label><label><span>订货截止时间（北京时间） *</span><input type="datetime-local" min={newActivity.startsAt || minimumFutureAt} value={newActivity.endsAt} onChange={(event) => setNewActivity((value) => ({ ...value, endsAt: event.target.value }))} /></label><label><span>整场活动结束时间（北京时间） *</span><input type="datetime-local" min={newActivity.endsAt || minimumFutureAt} value={newActivity.eventEndsAt} onChange={(event) => setNewActivity((value) => ({ ...value, eventEndsAt: event.target.value }))} /></label></div><footer><button type="button" disabled={creatingActivity} onClick={requestClose}>取消</button><button type="button" className="admin-primary" disabled={creatingActivity} onClick={() => void submitNewActivity()}>{creatingActivity ? "正在创建…" : "创建草稿活动"}</button></footer></aside></div>
  );
}
