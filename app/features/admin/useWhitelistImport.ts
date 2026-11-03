"use client";

import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ApiError, cancelImport, confirmImport, waitForImport, uploadImport, loadImportRows, loadAdminCustomers, type ImportStagingRow } from "../../api";
import { bindWhitelistStaging, cloneWhitelistRows, prepareWhitelistImportRows, summarizeWhitelistRows, type WhitelistRow, type AttendanceRow, type AttendanceImportDraft } from "../../domain/import-domain";
import { parseWhitelistWorkbook } from "./admin-utils";
import type { CustomerImportOptions } from "./customer-module-types";
import { mapAdminWhitelistRows } from "./whitelist-utils";

type WhitelistImportOptions = CustomerImportOptions & {
  whitelistRows: WhitelistRow[];
  setWhitelistRows: Dispatch<SetStateAction<WhitelistRow[]>>;
  whitelistImportHasRun: boolean;
  setWhitelistImportCompleted: (completed: boolean) => void;
  onWhitelistImportCommitted: () => void;
  attendanceRows: AttendanceRow[];
  setAttendanceRows: Dispatch<SetStateAction<AttendanceRow[]>>;
  pendingAttendanceImport: AttendanceImportDraft | null;
  refreshProductScopes?: () => Promise<void>;
  regionCodesByName?: Record<string, string>;
  onReadbackFailed?: () => void;
};

// The admin shell owns mounting so switching tabs retains the current preview.
export function useWhitelistImport({
  activityId, activityStatus, whitelistRows, setWhitelistRows, whitelistImportHasRun,
  setWhitelistImportCompleted, onWhitelistImportCommitted, serverImportTasks, serverImportBlocking, setServerImportTasks,
  setServerImportBlocking, setActionNotice, recordOperation, refreshProductScopes, importWaitOptions, regionCodesByName = {}, onReadbackFailed,
}: WhitelistImportOptions) {
  const activityPublished = activityStatus !== "draft";
  const [whitelistImportStage, setWhitelistImportStage] = useState<"preview" | "publishing" | "cancelling" | null>(null);
  const whitelistImportBusyRef = useRef(false);
  const [whitelistFileName, setWhitelistFileName] = useState("");
  const [whitelistImportWarnings, setWhitelistImportWarnings] = useState<string[]>([]);
  const [whitelistImportError, setWhitelistImportError] = useState("");
  const [whitelistSheetCounts, setWhitelistSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [whitelistImportInputCount, setWhitelistImportInputCount] = useState(0);
  const whitelistImportStats = useMemo(() => summarizeWhitelistRows(whitelistRows), [whitelistRows]);
  const [pendingWhitelistRollbackRows, setPendingWhitelistRollbackRows] = useState<WhitelistRow[] | null>(null);
  const beginWhitelistImport = () => {
    if (whitelistImportBusyRef.current) return;
    if (activityPublished) {
      setActionNotice("活动发布后白名单 Excel 已锁定，请先撤回发布。");
      return;
    }
    setWhitelistImportCompleted(false);
    setWhitelistFileName("");
    setWhitelistSheetCounts([]);
    setWhitelistImportWarnings([]);
    setWhitelistImportError("");
    setWhitelistImportInputCount(0);
    setPendingWhitelistRollbackRows(null);
  };
  const cancelWhitelistImport = async () => {
    if (whitelistImportBusyRef.current) return;
    whitelistImportBusyRef.current = true;
    setWhitelistImportStage("cancelling");
    try {
      const taskId = serverImportTasks.WHITELIST;
      if (taskId && Number.isFinite(Number(activityId))) {
        try {
          await cancelImport(Number(activityId), taskId);
        } catch (error) {
          setActionNotice(error instanceof ApiError ? error.message : "取消白名单导入失败，请稍后重试。");
          return;
        }
        setServerImportTasks((current) => ({ ...current, WHITELIST: undefined }));
        setServerImportBlocking((current) => ({ ...current, WHITELIST: 0 }));
      }
      const hadConfirmedImport = whitelistImportHasRun;
      const rollbackRows = pendingWhitelistRollbackRows ? cloneWhitelistRows(pendingWhitelistRollbackRows) : whitelistRows;
      if (pendingWhitelistRollbackRows) setWhitelistRows(rollbackRows);
      setPendingWhitelistRollbackRows(null);
      setWhitelistFileName("");
      setWhitelistSheetCounts([]);
      setWhitelistImportWarnings([]);
      setWhitelistImportError("");
      setWhitelistImportInputCount(0);
      setWhitelistImportCompleted(hadConfirmedImport);
      setActionNotice("已取消本次白名单替换，当前白名单保持不变。" );
    } finally {
      whitelistImportBusyRef.current = false;
      setWhitelistImportStage(null);
    }
  };
  const confirmWhitelistImport = async () => {
    if (whitelistImportBusyRef.current) return;
    if (activityPublished) {
      setActionNotice("活动发布后禁止确认白名单 Excel 导入，请先撤回发布。");
      return;
    }
    if ((serverImportBlocking.WHITELIST ?? 0) > 0) {
      setActionNotice(`仍有 ${serverImportBlocking.WHITELIST} 条白名单异常，请先编辑或删除后再发布。`);
      return;
    }
    whitelistImportBusyRef.current = true;
    setWhitelistImportStage("publishing");
    try {
      const taskId = serverImportTasks.WHITELIST;
      if (taskId) {
        try { await confirmImport(Number(activityId), taskId); await waitForImport(Number(activityId), taskId, importWaitOptions?.()); }
        catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单导入发布失败，请处理异常数据后重试。"); return; }
      }
      let readbackError = false;
      if (taskId) {
        try {
          const regions = new Map(Object.entries(regionCodesByName).map(([name, code]) => [code, name]));
          setWhitelistRows(mapAdminWhitelistRows(await loadAdminCustomers(Number(activityId)), regions));
        } catch { readbackError = true; setWhitelistRows([]); }
        setServerImportTasks(current => ({ ...current, WHITELIST: undefined }));
        setServerImportBlocking(current => ({ ...current, WHITELIST: 0 }));
      }
      setPendingWhitelistRollbackRows(null);
      setWhitelistImportCompleted(true);
      onWhitelistImportCommitted();
      try { await refreshProductScopes?.(); } catch { readbackError = true; }
      recordOperation("替换白名单 Excel", whitelistFileName || "客户白名单 Excel", `共 ${whitelistImportStats.total} 名；有效 ${whitelistImportStats.valid} 名，待处理 ${whitelistImportStats.pending} 名。`);
      if (readbackError) onReadbackFailed?.();
      setActionNotice(readbackError ? "白名单已替换成功，但最新列表读取失败。请点击刷新列表核对，请勿重复确认导入。" : `白名单已替换：共 ${whitelistImportStats.total} 名，有效 ${whitelistImportStats.valid} 名；到场关联已在服务器更新，打开现场到场模块时读取最新结果。`);
    } finally {
      whitelistImportBusyRef.current = false;
      setWhitelistImportStage(null);
    }
  };
  const handleWhitelistFile = async (file: File) => {
    if (whitelistImportBusyRef.current) return;
    if (activityPublished) {
      setWhitelistImportError("活动发布后白名单 Excel 已锁定，请先撤回发布。");
      setActionNotice("活动发布后白名单 Excel 已锁定，请先撤回发布。");
      return;
    }
    whitelistImportBusyRef.current = true;
    setWhitelistImportStage("preview");
    setWhitelistImportError("");
    try {
      const result = await parseWhitelistWorkbook(file);
      let serverRows: ImportStagingRow[] = [];
      if (Number.isFinite(Number(activityId))) {
        const task = await uploadImport(Number(activityId), "WHITELIST", file);
        setServerImportTasks((current) => ({ ...current, WHITELIST: Number(task.id) }));
        setServerImportBlocking((current) => ({ ...current, WHITELIST: Number(task.errorCount || 0) }));
        serverRows = await loadImportRows(Number(activityId), Number(task.id));
      }
      const prepared = prepareWhitelistImportRows(result.rows);
      setPendingWhitelistRollbackRows(pendingWhitelistRollbackRows ? pendingWhitelistRollbackRows : cloneWhitelistRows(whitelistRows));
      const nextRows = bindWhitelistStaging(prepared.rows, serverRows);
      setWhitelistRows(nextRows);
      setWhitelistFileName(file.name);
      setWhitelistSheetCounts(result.sheetCounts);
      setWhitelistImportInputCount(result.rows.length);
      setWhitelistImportWarnings([...result.warnings, ...prepared.warnings]);
      setWhitelistImportCompleted(false);
      const stats = summarizeWhitelistRows(nextRows);
      setActionNotice(`已解析 ${stats.total} 名白名单客户：有效 ${stats.valid} 名、待处理 ${stats.pending} 名，请检查后确认替换。`);
    } catch (error) {
      setWhitelistFileName(file.name);
      setWhitelistSheetCounts([]);
      setWhitelistImportInputCount(0);
      setWhitelistImportWarnings([]);
      setWhitelistImportError(error instanceof Error ? error.message : "文件解析失败，请检查 Excel 格式。");
      setWhitelistImportCompleted(false);
    } finally {
      whitelistImportBusyRef.current = false;
      setWhitelistImportStage(null);
    }
  };
  return {
    whitelistImportBusy: whitelistImportStage !== null,
    whitelistPreviewLoading: whitelistImportStage === "preview",
    whitelistPublishing: whitelistImportStage === "publishing",
    whitelistFileName,
    setWhitelistFileName,
    whitelistImportWarnings,
    whitelistImportError,
    whitelistSheetCounts,
    setWhitelistSheetCounts,
    whitelistImportInputCount,
    setWhitelistImportInputCount,
    whitelistImportStats,
    setPendingWhitelistRollbackRows,
    beginWhitelistImport,
    cancelWhitelistImport,
    confirmWhitelistImport,
    handleWhitelistFile,
  };
}
