"use client";

import { AdminEntry } from "../admin/AdminEntry";
import { H5Ordering } from "../h5/H5Ordering";
import { LotteryBoard } from "../lottery/Lottery";
import { useActivityWorkspace, useImportWorkspace } from "./ActivityWorkspace";

export function AdminSurface() {
  return <AdminEntry />;
}

export function H5Surface() {
  const { activityStatus, runtimeActivity, runtimeMessage, runtimeConnectionState, retryActivity } = useActivityWorkspace();
  const { products, whitelist } = useImportWorkspace();
  return <H5Ordering key={runtimeActivity?.code ?? "loading"} activityStatus={activityStatus} importedRows={products.completed ? products.rows : null}
    importedWhitelistRows={whitelist.completed ? whitelist.rows : null} runtimeActivity={runtimeActivity} activitySyncMessage={runtimeMessage}
    activityLoadFailed={runtimeConnectionState === "error" || runtimeConnectionState === "unavailable"}
    retryActivity={retryActivity} />;
}

export function LotterySurface() {
  const { lotteryRounds, setLotteryRounds, runtimeActivity, activityId, activityStatus } = useActivityWorkspace();
  const { attendance } = useImportWorkspace();
  if (!runtimeActivity) return null;
  return <LotteryBoard key={activityId} rounds={lotteryRounds} attendanceRows={attendance.rows} activityId={Number(activityId)}
    activityFinished={activityStatus === "finished"}
    onComplete={(id) => setLotteryRounds((items) => items.map((item) => item.id === id ? { ...item, status: "completed", serverStatus: "COMPLETED" } : item))} />;
}
