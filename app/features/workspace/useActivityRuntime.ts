"use client";

import { useEffect, useState } from "react";
import { loadActivity, loadPublicLottery, type RuntimeActivity } from "../../api";
import { initialLotteryRounds, mapLotteryRule, type LotteryRound } from "../lottery/Lottery";
import type { ActivityStatus } from "../shared/types";
import { runtimeActivityStatus, toDateTimeLocal } from "../shared/utils";

export function useActivityRuntime() {
  const [lotteryRounds, setLotteryRounds] = useState<LotteryRound[]>(initialLotteryRounds);
  const [activityName, setActivityName] = useState("2026年中秋订货会");
  const [activityId, setActivityId] = useState("1");
  const [activityStatus, setActivityStatus] = useState<ActivityStatus>("scheduled");
  const [activityStartAt, setActivityStartAt] = useState("2030-07-28T14:30");
  const [activityEndAt, setActivityEndAt] = useState("2030-07-30T18:30");
  const [activityEventEndAt, setActivityEventEndAt] = useState("2030-07-30T22:30");
  const [runtimeActivity, setRuntimeActivity] = useState<RuntimeActivity | null>(null);
  const [runtimeConnected, setRuntimeConnected] = useState(false);
  useEffect(() => {
    void Promise.all([loadActivity(), loadPublicLottery()]).then(([activity, lottery]) => {
      setRuntimeActivity(activity); setRuntimeConnected(true); setActivityName(activity.name); setActivityId(String(activity.id));
      setActivityStartAt(toDateTimeLocal(activity.startsAt)); setActivityEndAt(toDateTimeLocal(activity.endsAt));
      setActivityEventEndAt(toDateTimeLocal(activity.eventEndsAt || new Date(new Date(activity.endsAt).getTime() + 4 * 60 * 60 * 1000).toISOString()));
      setActivityStatus(runtimeActivityStatus(activity.status));
      const rule = lottery.rules.find((item) => item.status === "PUBLISHED") ?? lottery.rules[0];
      if (rule) setLotteryRounds(mapLotteryRule(rule));
    }).catch(() => setRuntimeConnected(false));
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadActivity().then((activity) => {
        setRuntimeActivity(activity);
        setActivityStatus(runtimeActivityStatus(activity.status));
      }).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return { lotteryRounds, setLotteryRounds, activityName, setActivityName, activityId, setActivityId, activityStatus, setActivityStatus, activityStartAt, setActivityStartAt, activityEndAt, setActivityEndAt, activityEventEndAt, setActivityEventEndAt, runtimeActivity, runtimeConnected };
}
