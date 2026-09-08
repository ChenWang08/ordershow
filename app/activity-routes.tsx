"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ACTIVITY_CODE,
  ApiError,
  getActiveActivityCode,
  getPreferredAdminActivityCode,
  loadCurrentActivity,
  setActiveActivityCode,
  setPreferredAdminActivityCode,
  subscribeActiveActivityCode,
} from "./api";
import { OrderShowApp } from "./order-show-app";

type RoutedSurface = "h5" | "dashboard" | "ranking" | "report" | "lottery" | "admin";

type ActivityRouteProps = {
  activityCode?: string;
  surface: RoutedSurface;
};

/**
 * Keeps the existing single frontend build while giving each business surface
 * a stable URL and an activity-scoped API context.
 */
export function ActivityRoute({ activityCode = ACTIVITY_CODE, surface }: ActivityRouteProps) {
  const normalizedActivityCode = activityCode.trim() || ACTIVITY_CODE;
  const configuredActivityCode = useSyncExternalStore(
    subscribeActiveActivityCode,
    getActiveActivityCode,
    () => ACTIVITY_CODE,
  );

  useEffect(() => {
    setActiveActivityCode(normalizedActivityCode);
  }, [normalizedActivityCode]);

  if (configuredActivityCode !== normalizedActivityCode) {
    return (
      <main className="prototype-root">
        <div className="prototype-canvas">
          <section className="surface-slot">
            <div className="empty-state">正在进入活动页面…</div>
          </section>
        </div>
      </main>
    );
  }

  return <OrderShowApp initialSurface={surface} showSurfaceTabs={false} />;
}

export function AdminRoute() {
  const activityCode = useSyncExternalStore(
    () => () => undefined,
    () => getPreferredAdminActivityCode() || ACTIVITY_CODE,
    () => ACTIVITY_CODE,
  );
  return <ActivityRoute activityCode={activityCode} surface="admin" />;
}

export function LegacyAdminActivityRoute({ activityCode }: { activityCode: string }) {
  useEffect(() => {
    setPreferredAdminActivityCode(activityCode);
    window.location.replace("/admin");
  }, [activityCode]);

  return <RouteLoading message="正在进入统一管理后台…" />;
}

export function CurrentH5Route() {
  const [activityCode, setActivityCode] = useState("");
  const [message, setMessage] = useState("正在查找当前订货活动…");

  useEffect(() => {
    let active = true;
    void loadCurrentActivity()
      .then((activity) => { if (active) setActivityCode(activity.code); })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof ApiError ? error.message : "当前暂无可下单活动");
      });
    return () => { active = false; };
  }, []);

  if (!activityCode) return <RouteLoading message={message} />;
  return <ActivityRoute activityCode={activityCode} surface="h5" />;
}

function RouteLoading({ message }: { message: string }) {
  return (
    <main className="prototype-root">
      <div className="prototype-canvas">
        <section className="surface-slot">
          <div className="empty-state">{message}</div>
        </section>
      </div>
    </main>
  );
}
