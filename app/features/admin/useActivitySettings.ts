"use client";

import { useRef, useState } from "react";
import {
  ApiError, loadAdminActivity, updateActivity, publishActivity, withdrawActivityPublication,
  closeActivityNow, finishActivityNow, reopenActivity, type RuntimeActivity,
} from "../../api";
import { beijingDateTimeMillis } from "../shared/time";
import type { ActivityStatus } from "../shared/types";
import { runtimeActivityStatus, toDateTimeLocal } from "../shared/utils";
import { useLazyAdminQuery } from "./useLazyAdminQuery";

type ActivitySettingsOptions = {
  tab?: string;
  initialActivity?: RuntimeActivity | null;
  activityId: string;
  activityCode: string;
  activityName: string;
  activityStatus: ActivityStatus;
  activityStartAt: string;
  activityEndAt: string;
  activityEventEndAt: string;
  productImportCompleted: boolean;
  whitelistImportCompleted: boolean;
  onActivityNameChange: (value: string) => void;
  onActivityStatusChange: (value: ActivityStatus) => void;
  onActivityStartAtChange: (value: string) => void;
  onActivityEndAtChange: (value: string) => void;
  onActivityEventEndAtChange: (value: string) => void;
  setActionNotice: (value: string) => void;
  recordOperation: (action: string, target: string, detail: string) => void;
  onActivityLoaded?: (activity: RuntimeActivity) => void;
};

export function useActivitySettings({
  tab = "活动概览", initialActivity, activityId, activityCode, activityName, activityStatus, activityStartAt, activityEndAt, activityEventEndAt, onActivityNameChange, onActivityStatusChange, onActivityStartAtChange, onActivityEndAtChange, onActivityEventEndAtChange, setActionNotice, recordOperation, onActivityLoaded,
}: ActivitySettingsOptions) {
  const [activityStartDraft, setActivityStartDraft] = useState(activityStartAt);
  const [activityEndDraft, setActivityEndDraft] = useState(activityEndAt);
  const [activityEventEndDraft, setActivityEventEndDraft] = useState(activityEventEndAt);
  const [activityNameDraft, setActivityNameDraft] = useState(activityName);
  const [reopenDraft, setReopenDraft] = useState<{ activity: RuntimeActivity; endsAt: string; eventEndsAt: string; reason: string; error: string } | null>(null);
  const [reopenBusy, setReopenBusy] = useState(false);
  const reopenPending = useRef(false);
  const initialSnapshot = useRef(initialActivity);
  const actionPending = useRef(false);
  const [activityActionBusy, setActivityActionBusy] = useState(false);
  const applyActivity = (activity: RuntimeActivity, preserveDrafts = false) => {
    onActivityLoaded?.(activity);
    const nextStatus = runtimeActivityStatus(activity.status);
    onActivityStatusChange(nextStatus);
    onActivityNameChange(activity.name);
    onActivityStartAtChange(toDateTimeLocal(activity.startsAt));
    onActivityEndAtChange(toDateTimeLocal(activity.endsAt));
    onActivityEventEndAtChange(toDateTimeLocal(activity.eventEndsAt || new Date(new Date(activity.endsAt).getTime() + 4 * 60 * 60 * 1000).toISOString()));
    if (preserveDrafts) return;
    setActivityNameDraft(activity.name);
    setActivityStartDraft(toDateTimeLocal(activity.startsAt));
    setActivityEndDraft(toDateTimeLocal(activity.endsAt));
    setActivityEventEndDraft(toDateTimeLocal(activity.eventEndsAt || new Date(new Date(activity.endsAt).getTime() + 4 * 60 * 60 * 1000).toISOString()));
  };
  const dirty = activityNameDraft !== activityName || activityStartDraft !== activityStartAt
    || activityEndDraft !== activityEndAt || activityEventEndDraft !== activityEventEndAt;
  const activityQuery = useLazyAdminQuery(activityId, Boolean(tab), async signal => {
    // AdminEntry already read this activity. Reuse that first response only.
    const snapshot = initialSnapshot.current;
    initialSnapshot.current = null;
    return snapshot?.id === Number(activityId) ? snapshot : loadAdminActivity(Number(activityId), signal);
  }, activity => applyActivity(activity, dirty), Boolean(reopenDraft) || activityActionBusy || reopenBusy, tab);
  const refreshActivity = activityQuery.refresh;
  const saveActivityConfig = async (): Promise<boolean> => {
    if (!activityNameDraft.trim()) {
      setActionNotice("请填写活动名称。" );
      return false;
    }
    if (!activityStartDraft || !activityEndDraft || !activityEventEndDraft) {
      setActionNotice("请填写订货开始、订货截止和整场活动结束时间。" );
      return false;
    }
    const startTime = beijingDateTimeMillis(activityStartDraft);
    const endTime = beijingDateTimeMillis(activityEndDraft);
    const eventEndTime = beijingDateTimeMillis(activityEventEndDraft);
    if (startTime >= endTime) {
      setActionNotice("活动开始时间必须早于截止时间。" );
      return false;
    }
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || !Number.isFinite(eventEndTime)) {
      setActionNotice("请填写有效的活动时间。");
      return false;
    }
    if (eventEndTime <= endTime) {
      setActionNotice("整场活动结束时间必须晚于订货截止时间。" );
      return false;
    }
    if ((activityStatus === "draft" || activityStatus === "scheduled") && startTime <= Date.now()) {
      setActionNotice("订货开始时间必须晚于当前时间，请重新选择。" );
      return false;
    }
    if (activityStatus === "running" && startTime !== beijingDateTimeMillis(activityStartAt)) {
      setActionNotice("活动进行中，订货开始时间不能修改。" );
      return false;
    }
    if (activityStatus === "running" && endTime <= Date.now()) {
      setActionNotice("订货截止时间必须晚于当前时间。" );
      return false;
    }
    if (Number.isFinite(Number(activityId))) {
      try {
        const updated = await updateActivity(await loadAdminActivity(Number(activityId)), { name: activityNameDraft.trim(), startsAt: activityStartDraft, endsAt: activityEndDraft, eventEndsAt: activityEventEndDraft });
        applyActivity(updated);
      } catch (error) {
        setActionNotice(error instanceof ApiError ? error.message : "活动配置保存失败，请稍后重试。");
        return false;
      }
    } else {
      onActivityNameChange(activityNameDraft.trim());
      onActivityStartAtChange(activityStartDraft);
      onActivityEndAtChange(activityEndDraft);
      onActivityEventEndAtChange(activityEventEndDraft);
    }
    recordOperation("保存活动配置", activityCode, `活动名称：${activityNameDraft.trim()}；活动编号：${activityCode}；订货开始：${activityStartDraft.replace("T", " ")}；订货截止：${activityEndDraft.replace("T", " ")}；整场结束：${activityEventEndDraft.replace("T", " ")}。`);
    setActionNotice(activityStatus === "running" ? "新的订货截止时间已保存。" : "活动名称和时间配置已保存。" );
    return true;
  };
  const publishCurrentActivity = async () => {
    // Publishing validates actual server bindings, not unopened modules' local flags.
    if (!window.confirm(`发布后活动将于 ${activityStartDraft.replace("T", " ")} 自动开始，商品和白名单将锁定。确定发布吗？`)) return;
    if (!await saveActivityConfig()) return;
    try {
      if (Number.isFinite(Number(activityId))) applyActivity(await publishActivity(await loadAdminActivity(Number(activityId))));
      else onActivityStatusChange("scheduled");
      recordOperation("发布活动", activityId, `活动将于 ${activityStartDraft.replace("T", " ")} 自动开始订货。`);
      setActionNotice("活动已发布，当前为待开始；到达开始时间后将自动开放 H5 订货。" );
    } catch (error) {
      setActionNotice(error instanceof ApiError ? error.message : "活动发布失败，请稍后重试。" );
    }
  };
  const withdrawCurrentActivity = async () => {
    if (!window.confirm("撤回发布后活动将恢复为草稿，并重新开放商品和白名单维护。确定撤回吗？")) return;
    try {
      if (Number.isFinite(Number(activityId))) applyActivity(await withdrawActivityPublication(await loadAdminActivity(Number(activityId))));
      else onActivityStatusChange("draft");
      recordOperation("撤回活动发布", activityId, "活动恢复为草稿，H5 保持关闭。" );
      setActionNotice("活动已撤回发布并恢复为草稿。" );
    } catch (error) {
      setActionNotice(error instanceof ApiError ? error.message : "撤回发布失败，请稍后重试。" );
    }
  };
  const closeCurrentActivity = async () => {
    const reason = window.prompt("请输入立即截止原因（必填）：")?.trim();
    if (!reason) return;
    if (!window.confirm("确定立即截止订货吗？截止后客户将无法新增、修改或撤回订单。")) return;
    try {
      if (Number.isFinite(Number(activityId))) applyActivity(await closeActivityNow(await loadAdminActivity(Number(activityId)), reason));
      else onActivityStatusChange("closed");
      recordOperation("立即截止订货", activityId, `原因：${reason}`);
      setActionNotice("活动已立即截止；H5 订单只读，看板和抽奖仍可使用。" );
    } catch (error) {
      setActionNotice(error instanceof ApiError ? error.message : "立即截止失败，请稍后重试。" );
    }
  };
  const finishCurrentActivity = async () => {
    const reason = window.prompt("请输入结束整场活动的原因（必填）：")?.trim();
    if (!reason) return;
    if (!window.confirm("确定结束整场活动吗？结束后将停止抽奖和实时推送，并冻结最终看板与战报。")) return;
    try {
      if (Number.isFinite(Number(activityId))) applyActivity(await finishActivityNow(await loadAdminActivity(Number(activityId)), reason));
      else onActivityStatusChange("finished");
      recordOperation("结束整场活动", activityId, `原因：${reason}`);
      setActionNotice("整场活动已结束；抽奖已关闭，看板和战报可只读回看。" );
    } catch (error) {
      setActionNotice(error instanceof ApiError ? error.message : "结束整场活动失败，请稍后重试。" );
    }
  };
  const openReopenDialog = async () => {
    if (reopenPending.current) return;
    reopenPending.current = true;
    setReopenBusy(true);
    try {
      const activity = await loadAdminActivity(Number(activityId));
      if (activity.status !== "CLOSED" && activity.status !== "FINISHED") {
        setActionNotice("活动状态已变化，请刷新后重试。");
        return;
      }
      const now = Date.now();
      setReopenDraft({ activity,
        endsAt: new Date(activity.endsAt).getTime() > now ? toDateTimeLocal(activity.endsAt) : "",
        eventEndsAt: activity.eventEndsAt && new Date(activity.eventEndsAt).getTime() > now ? toDateTimeLocal(activity.eventEndsAt) : "",
        reason: "", error: "" });
    } catch (error) {
      setActionNotice(error instanceof ApiError ? error.message : "活动信息加载失败，请稍后重试。");
    } finally { reopenPending.current = false; setReopenBusy(false); }
  };
  const closeReopenDialog = () => { if (!reopenPending.current) setReopenDraft(null); };
  const submitReopen = async () => {
    if (!reopenDraft || reopenPending.current) return;
    const { activity, endsAt, eventEndsAt, reason } = reopenDraft;
    const end = beijingDateTimeMillis(endsAt);
    const eventEnd = beijingDateTimeMillis(eventEndsAt);
    const error = !Number.isFinite(end) || end <= Date.now() ? "订货截止时间必须晚于当前时间。"
      : !Number.isFinite(eventEnd) || eventEnd <= end ? "整场活动结束时间必须晚于订货截止时间。"
      : !reason.trim() || reason.trim().length > 500 ? "请填写重新开放原因（最多 500 字）。" : "";
    if (error) { setReopenDraft({ ...reopenDraft, error }); return; }
    if (!window.confirm(`确定重新开放“${activity.name}”的订货吗？\n订货截止：${endsAt.replace("T", " ")}\n整场结束：${eventEndsAt.replace("T", " ")}\n已有订单和中奖记录保留，订货、抽奖和实时看板恢复；已失效的客户登录需重新验证。`)) return;
    reopenPending.current = true;
    setReopenBusy(true);
    try {
      applyActivity(await reopenActivity(activity, { endsAt, eventEndsAt, reason }));
      recordOperation("重新开放订货", activityId, `原因：${reason.trim()}；订货截止：${endsAt}；整场结束：${eventEndsAt}`);
      setReopenDraft(null);
      setActionNotice("已重新开放订货，已有订单和中奖记录保留；已失效的客户登录需重新验证。");
    } catch (error) {
      setReopenDraft({ ...reopenDraft, error: error instanceof ApiError ? error.message : "重新开放失败，请稍后重试。" });
    } finally { reopenPending.current = false; setReopenBusy(false); }
  };
  const runAction = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (actionPending.current || activityQuery.loading || reopenPending.current) return undefined;
    actionPending.current = true; setActivityActionBusy(true);
    try { return await action(); }
    finally { actionPending.current = false; setActivityActionBusy(false); }
  };
  return { dirty,
    refreshActivity, activityRefreshing: activityQuery.loading || activityActionBusy || reopenBusy, activityRefreshError: activityQuery.error,
    activityNameDraft, setActivityNameDraft, activityStartDraft, setActivityStartDraft, activityEndDraft, setActivityEndDraft, activityEventEndDraft, setActivityEventEndDraft,
    saveActivityConfig: async () => (await runAction(saveActivityConfig)) ?? false,
    publishCurrentActivity: () => runAction(publishCurrentActivity), withdrawCurrentActivity: () => runAction(withdrawCurrentActivity),
    closeCurrentActivity: () => runAction(closeCurrentActivity), finishCurrentActivity: () => runAction(finishCurrentActivity),
    reopenDraft, setReopenDraft, reopenBusy, openReopenDialog, closeReopenDialog, submitReopen };
}
