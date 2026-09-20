"use client";

import type { ReactNode } from "react";
import { useAdminIdentity, useAdminSession } from "../../admin-context";

export function AdminLayout({ tab, onTabChange, hasActivity = true, header, children }: {
  tab: string; onTabChange: (tab: string) => void; hasActivity?: boolean;
  header: ReactNode; children: ReactNode;
}) {
  const identity = useAdminIdentity();
  const navigation = ["活动概览", "商品导入", "白名单", "现场到场", "订单管理", "抽奖规则",
    ...(identity?.roleCode === "SUPER_ADMIN" ? ["部门与账号"] : [])];
  return <section className="admin-app">
    <aside className="admin-sidebar">
      <div className="admin-logo"><span>金</span><b>订购会管理平台</b></div>
      <nav aria-label="后台导航">{navigation.map((item) => {
        const disabled = !hasActivity && item !== "活动概览" && item !== "部门与账号";
        return <button key={item} type="button" disabled={disabled} title={disabled ? "请先创建活动" : undefined}
          className={tab === item ? "active" : ""} onClick={() => onTabChange(item)}>
          <i aria-hidden="true">{item.slice(0, 1)}</i>{item}
        </button>;
      })}</nav>
      {!hasActivity && <p className="admin-navigation-note">创建活动后即可使用业务功能</p>}
      <div className="admin-user"><span>{(identity?.displayName || "管").slice(0, 1)}</span><p><b>{identity?.displayName || "管理员"}</b><small>{identity?.roleCode === "SUPER_ADMIN" ? "超级管理员" : identity?.departmentName || "部门账号"}</small></p></div>
    </aside>
    <main className="admin-main">{header}{children}</main>
  </section>;
}

export function AdminAccountSummary() {
  const identity = useAdminIdentity();
  const session = useAdminSession();
  return <div className="admin-actions"><div className="admin-identity-summary">
    <div><b>{identity?.displayName || identity?.username || "管理员"}</b><small>{identity?.roleCode === "SUPER_ADMIN" ? "超级管理员 · 全部部门" : `部门账号 · ${identity?.departmentName || ""}`}</small></div>
    <button type="button" className="admin-logout-button" disabled={session?.busy} onClick={() => void session?.logout()}>退出登录</button>
  </div>{session?.error && <span className="admin-logout-error" role="alert">{session.error}</span>}</div>;
}
