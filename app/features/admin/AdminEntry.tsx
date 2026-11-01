"use client";

import { MemberAdminPanel } from "./MemberAdminPanel";
import { isManager } from "./permissions";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError, loadAdminActivities, loadAdminActivity, setActiveActivityCode, getPreferredAdminActivityCode, setPreferredAdminActivityCode, type RuntimeActivity, type AdminActivitySummary } from "../../api";
import { useAdminIdentity } from "../../admin-context";
import { ActivityWorkspaceProvider } from "../workspace/ActivityWorkspace";
import { AdminGateway } from "./AdminGateway";
import { AdminWorkspace } from "./AdminWorkspace";
import { DepartmentAdminPanel } from "./DepartmentAdminPanel";
import { NewActivityDrawer } from "./NewActivityDrawer";
import { useAdminActivities } from "./useAdminActivities";
import { AdminLayout, AdminAccountSummary } from "./AdminLayout";

type AdminWorkspaceLoadState =
  | { requestKey: string; status: "ready"; activity: RuntimeActivity | null; activities: AdminActivitySummary[] }
  | { requestKey: string; status: "error"; message: string };

export function AdminEntry() {
  return <AdminGateway><AuthorizedWorkspace /></AdminGateway>;
}

export function AuthorizedWorkspace() {
  const identity = useAdminIdentity();
  const [retry, setRetry] = useState(0);
  const [loadState, setLoadState] = useState<AdminWorkspaceLoadState | null>(null);
  const requestKey = [identity?.id, identity?.departmentId, identity?.roleCode, (identity?.permissions || []).slice().sort().join(","), retry].join(":");
  const currentLoadState = loadState?.requestKey === requestKey ? loadState : null;
  const loading = currentLoadState === null;
  const error = currentLoadState?.status === "error" ? currentLoadState.message : "";
  const activity = currentLoadState?.status === "ready" ? currentLoadState.activity : null;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void loadAdminActivities(controller.signal).then(async (items) => {
      if (!active) return;
      const saved = new URLSearchParams(window.location.search).get("activity") || getPreferredAdminActivityCode();
      const selected = items.find((item) => item.code === saved)
        ?? items.find((item) => item.status === "ACTIVE")
        ?? items.find((item) => item.status === "SCHEDULED") ?? items[0];
      if (!selected) {
        if (active) setLoadState({ requestKey, status: "ready", activity: null, activities: items });
        return;
      }
      const detail = await loadAdminActivity(selected.id, controller.signal);
      if (!active) return;
      setActiveActivityCode(detail.code);
      setPreferredAdminActivityCode(detail.code);
      if (window.location.search) window.history.replaceState(null, "", "/admin");
      setLoadState({ requestKey, status: "ready", activity: detail, activities: items });
    }).catch((reason) => {
      if (active) setLoadState({ requestKey, status: "error", message: reason instanceof ApiError ? reason.message : "活动加载失败，请重试" });
    });
    const invalidate = () => {
      if (active) setLoadState({ requestKey, status: "error", message: "登录状态或活动权限已变化，请重新加载" });
      active = false;
      controller.abort();
    };
    window.addEventListener("admin-access-invalid", invalidate);
    return () => { active = false; controller.abort(); window.removeEventListener("admin-access-invalid", invalidate); };
  }, [requestKey]);
  if (loading || error) return <PendingAdminWorkspace loading={loading} error={error} onRetry={() => setRetry((value) => value + 1)} />;
  const activities = currentLoadState?.status === "ready" ? currentLoadState.activities : [];
  if (!activity) return <EmptyAdminWorkspace activities={activities} />;
  return <ActivityWorkspaceProvider key={requestKey + ":" + activity.id} adminActivity={activity}><AdminWorkspace activities={activities} /></ActivityWorkspaceProvider>;
}

export function EmptyAdminWorkspace({ activities: initialActivities }: { activities?: AdminActivitySummary[] } = {}) {
  const identity = useAdminIdentity();
  const { tab, visited, selectTab } = useAccountTabs();
  const [notice, setNotice] = useState("");
  const activities = useAdminActivities({ activityId: "", activityCode: "", setActionNotice: setNotice, initialActivities });
  return <>
    <AdminLayout tab={tab} onTabChange={selectTab} hasActivity={false} header={
      <header className="admin-empty-header"><div className="admin-heading">
        <div className="admin-no-activity"><span>当前活动</span><b>暂无活动</b></div><strong>{tab}</strong>
        {isManager(identity) && <button type="button" className="admin-primary" onClick={activities.openNewActivity}>＋ 新建活动</button>}
      </div><AdminAccountSummary /></header>
    }>
      <RetainedAccountPages tab={tab} visited={visited}>
        <section className="admin-panel admin-empty-panel">
          <div className="admin-empty-content">
            <div className="admin-empty-symbol" aria-hidden="true">＋</div>
            <h2>{identity?.roleCode === "SUPER_ADMIN" ? "暂无活动" : "本部门暂无活动"}</h2>
            <p>{isManager(identity) ? "创建第一场订货活动，即可导入商品和白名单，管理订单与抽奖。" : "请联系部门管理员创建活动并分配功能权限。"}</p>
            {isManager(identity) && <button type="button" className="admin-primary" onClick={activities.openNewActivity}>新建活动</button>}
            {isManager(identity) && <small>{identity?.roleCode === "SUPER_ADMIN" ? "创建时请选择活动所属部门" : `新活动将自动归属${identity?.departmentName || "本部门"}`}</small>}
          </div>
        </section></RetainedAccountPages>
    </AdminLayout>
    {activities.newActivityOpen && <NewActivityDrawer activities={activities} />}
    {notice && <div className="admin-toast" role="alert">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button></div>}
  </>;
}

function PendingAdminWorkspace({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  const { tab, visited, selectTab } = useAccountTabs();
  return <AdminLayout tab={tab} onTabChange={selectTab} hasActivity={false} header={
    <header className="admin-empty-header"><div className="admin-heading"><strong>{tab}</strong></div><AdminAccountSummary /></header>
  }>
    <RetainedAccountPages tab={tab} visited={visited}>
      <section className="admin-panel admin-empty-panel" aria-busy={loading}><div className="admin-empty-content">
        <h2>{loading ? "正在加载活动…" : "活动加载失败"}</h2>
        <p role={loading ? "status" : "alert"}>{loading ? "正在获取当前账号可访问的活动" : error}</p>
        {!loading && <button type="button" className="admin-primary" onClick={onRetry}>重新加载</button>}
      </div></section></RetainedAccountPages>
  </AdminLayout>;
}

function useAccountTabs() {
  const [tab, setTab] = useState("活动概览");
  const [visited, setVisited] = useState<string[]>([]);
  const selectTab = (next: string) => {
    setVisited(current => current.includes(next) ? current : [...current, next]);
    setTab(next);
  };
  return { tab, visited, selectTab };
}

// Account pages also retain forms when there is no selected activity yet.
function RetainedAccountPages({ tab, visited, children }: { tab: string; visited: string[]; children: ReactNode }) {
  const identity = useAdminIdentity();
  return <>
    {visited.includes("成员管理") && isManager(identity) && <div hidden={tab !== "成员管理"}><MemberAdminPanel active={tab === "成员管理"} /></div>}
    {visited.includes("部门与账号") && identity?.roleCode === "SUPER_ADMIN" && <div hidden={tab !== "部门与账号"}><DepartmentAdminPanel active={tab === "部门与账号"} /></div>}
    {tab !== "成员管理" && tab !== "部门与账号" && children}
  </>;
}
