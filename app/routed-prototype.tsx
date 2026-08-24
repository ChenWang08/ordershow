"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ACTIVITY_CODE, getActiveActivityCode, setActiveActivityCode, subscribeActiveActivityCode } from "./api";
import { Prototype } from "./prototype";

type RoutedSurface = "h5" | "ranking" | "report" | "lottery" | "admin";

type RoutedPrototypeProps = {
  activityCode?: string;
  surface: RoutedSurface;
};

/**
 * Keeps the existing single frontend build while giving each business surface
 * a stable URL and an activity-scoped API context.
 */
export function RoutedPrototype({ activityCode = ACTIVITY_CODE, surface }: RoutedPrototypeProps) {
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

  return <Prototype initialSurface={surface} showSurfaceTabs={false} />;
}
