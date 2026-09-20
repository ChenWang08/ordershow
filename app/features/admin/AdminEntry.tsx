"use client";

import { useEffect, useState } from "react";
import { ApiError, loadAdminActivities, loadAdminActivity, setActiveActivityCode, getPreferredAdminActivityCode, setPreferredAdminActivityCode, type RuntimeActivity } from "../../api";
import { useAdminIdentity } from "../../admin-context";
import { ActivityWorkspaceProvider } from "../workspace/ActivityWorkspace";
import { AdminGateway } from "./AdminGateway";
import { AdminWorkspace } from "./AdminWorkspace";
import { DepartmentAdminPanel } from "./DepartmentAdminPanel";
import { NewActivityDrawer } from "./NewActivityDrawer";
import { useAdminActivities } from "./useAdminActivities";
import { AdminLayout, AdminAccountSummary } from "./AdminLayout";

export function AdminEntry() {
  return <AdminGateway><AuthorizedWorkspace /></AdminGateway>;
}

export function AuthorizedWorkspace() {
  const identity = useAdminIdentity();
  const [activity, setActivity] = useState<RuntimeActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setActivity(null); setLoading(true); setError("");
    void loadAdminActivities().then(async (items) => {
      const saved = new URLSearchParams(window.location.search).get("activity") || getPreferredAdminActivityCode();
      const selected = items.find((item) => item.code === saved)
        ?? items.find((item) => item.status === "ACTIVE")
        ?? items.find((item) => item.status === "SCHEDULED") ?? items[0];
      if (!selected) return;
      const detail = await loadAdminActivity(selected.id);
      if (!active) return;
      setActiveActivityCode(detail.code);
      setPreferredAdminActivityCode(detail.code);
      if (window.location.search) window.history.replaceState(null, "", "/admin");
      setActivity(detail);
    }).catch((reason) => { if (active) setError(reason instanceof ApiError ? reason.message : "活动加载失败，请重试"); })
      .finally(() => { if (active) setLoading(false); });
    const invalidate = () => { if (active) { setActivity(null); setError("登录状态或活动权限已变化，请重新加载"); } };
    window.addEventListener("admin-access-invalid", invalidate);
    return () => { active = false; window.removeEventListener("admin-access-invalid", invalidate); };
  }, [identity?.id, retry]);
  if (loading || error) return <PendingAdminWorkspace loading={loading} error={error} onRetry={() => setRetry((value) => value + 1)} />;
  if (!activity) return <EmptyAdminWorkspace />;
  return <ActivityWorkspaceProvider key={`${identity?.id}:${activity.id}`} adminActivity={activity}><AdminWorkspace /></ActivityWorkspaceProvider>;
}

export function EmptyAdminWorkspace() {
  const identity = useAdminIdentity();
  const [tab, setTab] = useState("活动概览");
  const [notice, setNotice] = useState("");
  const activities = useAdminActivities({ activityId: "", activityCode: "", setActionNotice: setNotice });
  return <>
    <AdminLayout tab={tab} onTabChange={setTab} hasActivity={false} header={
      <header className="admin-empty-header"><div className="admin-heading">
        <div className="admin-no-activity"><span>当前活动</span><b>暂无活动</b></div><strong>{tab}</strong>
        <button type="button" className="admin-primary" onClick={activities.openNewActivity}>＋ 新建活动</button>
      </div><AdminAccountSummary /></header>
    }>
      {tab === "部门与账号" && identity?.roleCode === "SUPER_ADMIN" ? <DepartmentAdminPanel /> :
        <section className="admin-panel admin-empty-panel">
          <div className="admin-empty-content">
            <div className="admin-empty-symbol" aria-hidden="true">＋</div>
            <h2>{identity?.roleCode === "SUPER_ADMIN" ? "暂无活动" : "本部门暂无活动"}</h2>
            <p>创建第一场订货活动，即可导入商品和白名单，管理订单与抽奖。</p>
            <button type="button" className="admin-primary" onClick={activities.openNewActivity}>新建活动</button>
            <small>{identity?.roleCode === "SUPER_ADMIN" ? "创建时请选择活动所属部门" : `新活动将自动归属${identity?.departmentName || "本部门"}`}</small>
          </div>
        </section>}
    </AdminLayout>
    {activities.newActivityOpen && <NewActivityDrawer activities={activities} />}
    {notice && <div className="admin-toast" role="alert">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
  </>;
}

function PendingAdminWorkspace({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  const [tab, setTab] = useState("活动概览");
  const identity = useAdminIdentity();
  return <AdminLayout tab={tab} onTabChange={setTab} hasActivity={false} header={
    <header className="admin-empty-header"><div className="admin-heading"><strong>{tab}</strong></div><AdminAccountSummary /></header>
  }>
    {tab === "部门与账号" && identity?.roleCode === "SUPER_ADMIN" ? <DepartmentAdminPanel /> :
      <section className="admin-panel admin-empty-panel" aria-busy={loading}><div className="admin-empty-content">
        <h2>{loading ? "正在加载活动…" : "活动加载失败"}</h2>
        <p role={loading ? "status" : "alert"}>{loading ? "正在获取当前账号可访问的活动" : error}</p>
        {!loading && <button type="button" className="admin-primary" onClick={onRetry}>重新加载</button>}
      </div></section>}
  </AdminLayout>;
}
