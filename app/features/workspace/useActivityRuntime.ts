"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveActivityCode, subscribeActiveActivityCode, type RuntimeActivity } from "../../api";
import { subscribeActivityInfo, type ActivityInfoConnectionState } from "../../services/api/activity-info-http";
import { initialLotteryRounds, type LotteryRound } from "../lottery/Lottery";
import type { ActivityStatus } from "../shared/types";
import { runtimeActivityStatus, toDateTimeLocal } from "../shared/utils";

export function useActivityRuntime(adminActivity?: RuntimeActivity) {
  const retry = useRef<(() => void) | undefined>(undefined);
  const retryActivity = useCallback(() => retry.current?.(), []);
  const adminActivityId = adminActivity?.id;
  const [publicActivityCode, setPublicActivityCode] = useState(getActiveActivityCode);
  const [lotteryRounds, setLotteryRounds] = useState<LotteryRound[]>(initialLotteryRounds);
  const [activityName, setActivityName] = useState(adminActivity?.name || "2026年中秋订货会");
  const [activityId, setActivityId] = useState(String(adminActivity?.id || 1));
  const [activityStatus, setActivityStatus] = useState<ActivityStatus>(adminActivity ? runtimeActivityStatus(adminActivity.status) : "scheduled");
  const [activityStartAt, setActivityStartAt] = useState(adminActivity ? toDateTimeLocal(adminActivity.startsAt) : "2030-07-28T14:30");
  const [activityEndAt, setActivityEndAt] = useState(adminActivity ? toDateTimeLocal(adminActivity.endsAt) : "2030-07-30T18:30");
  const [activityEventEndAt, setActivityEventEndAt] = useState(adminActivity ? toDateTimeLocal(adminActivity.eventEndsAt || adminActivity.endsAt) : "2030-07-30T22:30");
  const [runtimeActivity, setRuntimeActivity] = useState<RuntimeActivity | null>(adminActivity || null);
  const [runtimeConnected, setRuntimeConnected] = useState(Boolean(adminActivity));
  const [runtimeConnectionState, setRuntimeConnectionState] = useState<ActivityInfoConnectionState>(adminActivity ? "connected" : "connecting");
  const applyActivity = useCallback((activity: RuntimeActivity) => {
    setRuntimeActivity(activity); setActivityName(activity.name); setActivityId(String(activity.id));
    setActivityStartAt(toDateTimeLocal(activity.startsAt)); setActivityEndAt(toDateTimeLocal(activity.endsAt));
    setActivityEventEndAt(toDateTimeLocal(activity.eventEndsAt || activity.endsAt));
    setActivityStatus(runtimeActivityStatus(activity.status));
  }, []);
  useEffect(() => {
    if (adminActivityId != null) return;
    const unsubscribe = subscribeActiveActivityCode(() => {
      setRuntimeActivity(null); setRuntimeConnected(false);
      setRuntimeConnectionState("connecting"); setPublicActivityCode(getActiveActivityCode());
    });
    return () => { unsubscribe(); };
  }, [adminActivityId]);
  useEffect(() => {
    if (!adminActivity) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      applyActivity(adminActivity); setRuntimeConnected(true); setRuntimeConnectionState("connected");
    });
    return () => { active = false; };
  }, [adminActivity, applyActivity]);
  useEffect(() => {
    if (adminActivityId != null) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    // StrictMode's discarded mount must not send a second initial request.
    void Promise.resolve().then(() => {
      if (!active) return;
      const subscription = subscribeActivityInfo(publicActivityCode, {
        onActivity: activity => { if (active) applyActivity(activity); },
        onState: state => { if (active) { setRuntimeConnectionState(state); setRuntimeConnected(state === "connected"); } },
      });
      unsubscribe = subscription;
      retry.current = subscription.retry;
    });
    return () => { active = false; unsubscribe?.(); retry.current = undefined; };
  }, [adminActivityId, publicActivityCode, applyActivity]);
  const runtimeMessage = runtimeConnectionState === "unavailable" ? "活动不存在或已不可用，请检查活动链接。"
    : runtimeConnectionState === "error" ? runtimeActivity ? "活动资料同步失败，当前显示上次资料，可点击重试。" : "活动资料加载失败，请检查网络后重试。"
    : runtimeConnectionState === "connecting" ? runtimeActivity ? "活动信息正在重新同步，当前显示上次资料。" : "正在加载活动信息…" : "";
  return { lotteryRounds, setLotteryRounds, activityName, setActivityName, activityId, setActivityId, activityStatus, setActivityStatus, activityStartAt, setActivityStartAt, activityEndAt, setActivityEndAt, activityEventEndAt, setActivityEventEndAt, runtimeActivity, setRuntimeActivity, runtimeConnected, runtimeLoaded: Boolean(runtimeActivity), runtimeConnectionState, runtimeMessage, retryActivity };
}
