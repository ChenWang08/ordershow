"use client";

import { useEffect, useState } from "react";
import { loadActivity, loadAdminActivity, loadPublicLottery, type RuntimeActivity } from "../../api";
import { initialLotteryRounds, mapLotteryRule, type LotteryRound } from "../lottery/Lottery";
import type { ActivityStatus } from "../shared/types";
import { runtimeActivityStatus, toDateTimeLocal } from "../shared/utils";

export function useActivityRuntime(adminActivity?: RuntimeActivity) {
  const [lotteryRounds, setLotteryRounds] = useState<LotteryRound[]>(initialLotteryRounds);
  const [activityName, setActivityName] = useState(adminActivity?.name || "2026年中秋订货会");
  const [activityId, setActivityId] = useState(String(adminActivity?.id || 1));
  const [activityStatus, setActivityStatus] = useState<ActivityStatus>(adminActivity ? runtimeActivityStatus(adminActivity.status) : "scheduled");
  const [activityStartAt, setActivityStartAt] = useState(adminActivity ? toDateTimeLocal(adminActivity.startsAt) : "2030-07-28T14:30");
  const [activityEndAt, setActivityEndAt] = useState(adminActivity ? toDateTimeLocal(adminActivity.endsAt) : "2030-07-30T18:30");
  const [activityEventEndAt, setActivityEventEndAt] = useState(adminActivity ? toDateTimeLocal(adminActivity.eventEndsAt || adminActivity.endsAt) : "2030-07-30T22:30");
  const [runtimeActivity, setRuntimeActivity] = useState<RuntimeActivity | null>(adminActivity || null);
  const [runtimeConnected, setRuntimeConnected] = useState(Boolean(adminActivity));
  useEffect(() => {
    let active = true;
    void (adminActivity ? Promise.resolve([adminActivity, { rules: [] }] as const) : Promise.all([loadActivity(), loadPublicLottery()])).then(([activity, lottery]) => {
      if (!active) return;
      setRuntimeActivity(activity); setRuntimeConnected(true); setActivityName(activity.name); setActivityId(String(activity.id));
      setActivityStartAt(toDateTimeLocal(activity.startsAt)); setActivityEndAt(toDateTimeLocal(activity.endsAt));
      setActivityEventEndAt(toDateTimeLocal(activity.eventEndsAt || new Date(new Date(activity.endsAt).getTime() + 4 * 60 * 60 * 1000).toISOString()));
      setActivityStatus(runtimeActivityStatus(activity.status));
      const rule = lottery.rules.find((item) => item.status === "PUBLISHED") ?? lottery.rules[0];
      if (rule) setLotteryRounds(mapLotteryRule(rule));
    }).catch(() => { if (active) setRuntimeConnected(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const timer = window.setInterval(() => {
      void (adminActivity ? loadAdminActivity(adminActivity.id) : loadActivity()).then((activity) => {
        if (!active) return;
        setRuntimeActivity(activity);
        setActivityStatus(runtimeActivityStatus(activity.status));
      }).catch(() => undefined);
    }, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return { lotteryRounds, setLotteryRounds, activityName, setActivityName, activityId, setActivityId, activityStatus, setActivityStatus, activityStartAt, setActivityStartAt, activityEndAt, setActivityEndAt, activityEventEndAt, setActivityEventEndAt, runtimeActivity, runtimeConnected };
}
