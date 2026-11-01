"use client";

import { useState } from "react";
import { CollapsibleScreenHeader } from "./components/CollapsibleScreenHeader";
import { ActivityWorkspaceProvider, useActivityWorkspace } from "./features/workspace/ActivityWorkspace";
import { AdminSurface, H5Surface, LotterySurface } from "./features/workspace/SurfaceConnections";
import { OrderDashboard, RankingBoard, ReportBoard } from "./features/screens/ScreenBoards";
import { AdminEntry } from "./features/admin/AdminEntry";
import { useBackgroundImage, type BackgroundStyle } from "./features/shared/activity-background";

type Surface = "h5" | "dashboard" | "ranking" | "report" | "lottery" | "admin";
type OrderShowAppProps = {
  initialSurface?: Surface;
  showSurfaceTabs?: boolean;
};

export function OrderShowApp(props: OrderShowAppProps = {}) {
  if (props.initialSurface === "admin" && props.showSurfaceTabs === false) return <main className="prototype-root surface-admin"><nav className="prototype-nav"><div className="prototype-title"><span>金</span><p><b>订购会管理平台</b><small>多活动运营 · 部门管理</small></p></div></nav><div className="prototype-canvas"><AdminEntry /></div></main>;
  return <ActivityWorkspaceProvider><OrderShowContent {...props} /></ActivityWorkspaceProvider>;
}

function OrderShowContent({ initialSurface = "h5", showSurfaceTabs = true }: OrderShowAppProps) {
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const standaloneH5 = surface === "h5" && !showSurfaceTabs;
  const collapsibleScreen = ["dashboard", "ranking", "report", "lottery"].includes(surface);
  const manualScreen = ["dashboard", "ranking", "report"].includes(surface);
  const { activityName, runtimeConnected, runtimeActivity, runtimeMessage, runtimeConnectionState, retryActivity } = useActivityWorkspace();
  const h5Background = useBackgroundImage(surface === "h5" ? runtimeActivity?.h5BackgroundUrl : null);
  const desktopBackground = useBackgroundImage(["ranking", "report", "lottery"].includes(surface) ? runtimeActivity?.desktopBackgroundUrl : null);
  const backgroundStyle: BackgroundStyle = {
    "--activity-h5-background": h5Background,
    "--activity-desktop-background": desktopBackground,
  };
  const surfaces: { key: Surface; label: string; sub: string }[] = [
    { key: "h5", label: "订货 H5", sub: "手机端" },
    { key: "dashboard", label: "订单看板", sub: "大屏总览" },
    { key: "ranking", label: "订货排行", sub: "大屏 A" },
    { key: "report", label: "专题战报", sub: "大屏 B" },
    { key: "lottery", label: "幸运抽奖", sub: "现场" },
    { key: "admin", label: "管理后台", sub: "运营端" },
  ];
  const navigation = <nav className="prototype-nav">
        <div className="prototype-title"><span>金</span><p><b>{surface === "admin" ? "订购会管理平台" : activityName}</b><small>{surface === "admin" ? (runtimeConnected ? "多活动运营 · 实时数据" : "多活动运营 · 服务连接中") : runtimeConnected ? manualScreen ? "业务系统 · 手动更新" : "业务系统 · 实时数据" : "业务服务连接中"}</small></p></div>
        {showSurfaceTabs && <div className="surface-tabs">{surfaces.map((item) => <button key={item.key} className={surface === item.key ? "active" : ""} onClick={() => setSurface(item.key)}><b>{item.label}</b><small>{item.sub}</small></button>)}</div>}
        <div className="prototype-status"><i /> {runtimeConnected ? "服务已连接" : "服务未连接"}</div>
      </nav>;
  return (
    <main className={`prototype-root surface-${surface}${collapsibleScreen ? " collapsible-screen" : ""}${standaloneH5 ? " standalone-h5" : ""}${desktopBackground ? " has-desktop-background" : ""}`} style={backgroundStyle}>
      {!standaloneH5 && (collapsibleScreen ? <CollapsibleScreenHeader key={surface}>{navigation}</CollapsibleScreenHeader> : navigation)}
      {runtimeMessage && surface !== "admin" && surface !== "h5" && <div className="activity-sync-status" role="status">{runtimeMessage}
        {(runtimeConnectionState === "error" || runtimeConnectionState === "unavailable") && <button type="button" onClick={retryActivity}>重试活动资料</button>}</div>}
      <div className="prototype-canvas">
        {showSurfaceTabs
          ? <div className={surface === "h5" ? "surface-slot" : "surface-slot surface-hidden"}><H5Surface /></div>
          : surface === "h5" && <H5Surface />}
        {surface === "dashboard" && <OrderDashboard activity={runtimeActivity} />}
        {surface === "ranking" && <RankingBoard activity={runtimeActivity} />}
        {surface === "report" && <ReportBoard activity={runtimeActivity} />}
        {surface === "lottery" && <LotterySurface />}
        {surface === "admin" && <AdminSurface />}
      </div>
    </main>
  );
}
