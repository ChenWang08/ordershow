"use client";

import { adminNavigation, isManager, roleLabel } from "./permissions";
import type { ReactNode } from "react";
import { useAdminIdentity, useAdminSession } from "../../admin-context";
import { ActivityDeletionProgressButton } from "./ActivityDeletionProgress";

export function AdminLayout({ tab, onTabChange, hasActivity = true, header, children }: {
  tab: string; onTabChange: (tab: string) => void; hasActivity?: boolean;
  header: ReactNode; children: ReactNode;
}) {
  const identity = useAdminIdentity();
  const navigation = adminNavigation(identity);
  return <section className="admin-app">
    <aside className="admin-sidebar">
      <div className="admin-logo"><span>金</span><b>订购会管理平台</b></div>
      <nav aria-label="后台导航">{navigation.map((item) => {
        const disabled = !hasActivity && item !== "活动概览" && item !== "部门与账号" && item !== "成员管理";
        return <button key={item} type="button" disabled={disabled} title={disabled ? "请先创建活动" : undefined}
          className={tab === item ? "active" : ""} onClick={() => onTabChange(item)}>
          <i aria-hidden="true">{item.slice(0, 1)}</i>{item}
        </button>;
      })}</nav>
      {!hasActivity && <p className="admin-navigation-note">{isManager(identity) ? "创建活动后即可使用业务功能" : "请联系部门管理员创建活动"}</p>}
      <div className="admin-user"><span>{(identity?.displayName || "管").slice(0, 1)}</span><p><b>{identity?.displayName || "管理员"}</b><small>{roleLabel(identity)}</small></p></div>
    </aside>
    <main className="admin-main">{header}{children}</main>
  </section>;
}

export function AdminAccountSummary() {
  const identity = useAdminIdentity();
  const session = useAdminSession();
  return <div className="admin-actions"><ActivityDeletionProgressButton /><div className="admin-identity-summary">
    <div><b>{identity?.displayName || identity?.username || "管理员"}</b><small>{identity?.roleCode === "SUPER_ADMIN" ? "超级管理员 · 全部部门" : `${roleLabel(identity)} · ${identity?.departmentName || ""}`}</small></div>
    <button type="button" className="admin-logout-button" disabled={session?.busy} onClick={() => void session?.logout()}>退出登录</button>
  </div>{session?.error && <span className="admin-logout-error" role="alert">{session.error}</span>}</div>;
}
