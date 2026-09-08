"use client";

import { getActiveActivityCode } from "../../api";
import type { AdminWorkspaceProps } from "../admin/admin-types";
import { useActivityWorkspace, useImportWorkspace } from "./ActivityWorkspace";

export function useAdminWorkspaceProps(): AdminWorkspaceProps {
  const a = useActivityWorkspace();
  const { products, whitelist, attendance } = useImportWorkspace();
  return {
    lotteryRounds: a.lotteryRounds, onLotteryChange: a.setLotteryRounds,
    activityCode: a.runtimeActivity?.code || getActiveActivityCode(), activityName: a.activityName,
    onActivityNameChange: a.setActivityName, activityId: a.runtimeActivity ? String(a.runtimeActivity.id) : a.activityId,
    activityStatus: a.activityStatus, onActivityStatusChange: a.setActivityStatus,
    activityStartAt: a.activityStartAt, onActivityStartAtChange: a.setActivityStartAt,
    activityEndAt: a.activityEndAt, onActivityEndAtChange: a.setActivityEndAt,
    activityEventEndAt: a.activityEventEndAt, onActivityEventEndAtChange: a.setActivityEventEndAt,
    productRows: products.rows, onProductRowsChange: products.setRows,
    productImportCompleted: products.completed, onProductImportCompleted: products.setCompleted,
    productImportHasRun: products.hasRun, onProductImportCommitted: products.markCommitted,
    whitelistRows: whitelist.rows, onWhitelistRowsChange: whitelist.setRows,
    whitelistImportCompleted: whitelist.completed, onWhitelistImportCompleted: whitelist.setCompleted,
    whitelistImportHasRun: whitelist.hasRun, onWhitelistImportCommitted: whitelist.markCommitted,
    attendanceRows: attendance.rows, onAttendanceRowsChange: attendance.setRows,
    attendanceFileName: attendance.fileName, onAttendanceFileNameChange: attendance.setFileName,
    attendanceWarnings: attendance.warnings, onAttendanceWarningsChange: attendance.setWarnings,
    attendanceSheetCounts: attendance.sheetCounts, onAttendanceSheetCountsChange: attendance.setSheetCounts,
    attendanceImportError: attendance.error, onAttendanceImportErrorChange: attendance.setError,
  };
}
