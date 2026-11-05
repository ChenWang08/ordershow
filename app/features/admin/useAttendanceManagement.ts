"use client";

import { deleteConfirmedRows } from "./delete-confirmed-rows";
import { saveFailure, saveRequestFailure, type DrawerSaveResult } from "../../components/drawer-save-result";

import { useState, type Dispatch, type SetStateAction } from "react";
import { ApiError, uploadImport, cancelImport, confirmImport, waitForImport, loadImportRows, loadAttendanceMatchPreview, loadAdminAttendees, updateImportRow, deleteImportRows, createAdminAttendee, updateAdminAttendee, deleteAdminAttendee, type ImportStagingRow, type AttendanceMatchPreview } from "../../api";
import { bindAttendanceStaging, parseAttendanceWorkbook, type AttendanceRow, type AttendanceImportDraft } from "../../domain/import-domain";
import { mapAdminAttendanceRows, mergeAttendanceMatchPreview, cloneAttendanceRows } from "./attendance-utils";
import type { CustomerImportOptions } from "./customer-module-types";

type AttendanceManagementOptions = CustomerImportOptions & {
  setAttendanceRows: Dispatch<SetStateAction<AttendanceRow[]>>;
  attendanceImportError: string;
  onReadbackFailed?: () => void;
  onAttendanceFileNameChange: (name: string) => void;
  onAttendanceWarningsChange: (warnings: string[]) => void;
  onAttendanceSheetCountsChange: (counts: Array<{ name: string; count: number }>) => void;
  onAttendanceImportErrorChange: (error: string) => void;
};

export function useAttendanceManagement({
  activityId, activityStatus, setAttendanceRows, attendanceImportError,
  onAttendanceFileNameChange, onAttendanceWarningsChange, onAttendanceSheetCountsChange, onAttendanceImportErrorChange,
  serverImportTasks, serverImportBlocking, setServerImportTasks, setServerImportBlocking,
  setActionNotice, recordOperation, refreshServerImportPreview, importWaitOptions, onReadbackFailed,
}: AttendanceManagementOptions) {
  const activityStarted = activityStatus === "running" || activityStatus === "closed" || activityStatus === "finished";
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const [attendanceFormOpen, setAttendanceFormOpen] = useState(false);
  const [editingAttendanceRow, setEditingAttendanceRow] = useState<AttendanceRow | null>(null);
  const [pendingAttendanceImport, setPendingAttendanceImport] = useState<AttendanceImportDraft | null>(null);
  const [attendanceMatchPreview, setAttendanceMatchPreview] = useState<AttendanceMatchPreview | null>(null);
  const [attendancePreviewLoading, setAttendancePreviewLoading] = useState(false);
  const [attendancePublishing, setAttendancePublishing] = useState(false);
  const [attendanceImportAttemptName, setAttendanceImportAttemptName] = useState("");
  const handleAttendanceFile = async (file: File) => {
    if (attendancePreviewLoading || attendancePublishing) return;
    if (activityClosed) {
      onAttendanceImportErrorChange("活动已截止，现场到场名单只读。" );
      setActionNotice("活动已截止，现场到场名单只读。" );
      return;
    }
    setAttendanceImportAttemptName(file.name);
    onAttendanceImportErrorChange("");
    setPendingAttendanceImport(null);
    setAttendanceMatchPreview(null);
    setAttendancePreviewLoading(true);
    let stage = "文件解析";
    try {
      const result = await parseAttendanceWorkbook(file);
      let serverRows: ImportStagingRow[] = [];
      let matchPreview: AttendanceMatchPreview | null = null;
      if (Number.isFinite(Number(activityId))) {
        stage = "文件上传或服务端校验";
        const task = await uploadImport(Number(activityId), "ATTENDANCE", file);
        setServerImportTasks((current) => ({ ...current, ATTENDANCE: Number(task.id) }));
        setServerImportBlocking((current) => ({ ...current, ATTENDANCE: Number(task.errorCount || 0) }));
        setPendingAttendanceImport({ ...result, fileName: file.name, inputCount: result.rows.length });
        stage = "导入预览读取";
        serverRows = await loadImportRows(Number(activityId), Number(task.id));
        setPendingAttendanceImport({ ...result, rows: bindAttendanceStaging(result.rows, serverRows),
          fileName: file.name, inputCount: result.rows.length });
        stage = "白名单关联试算";
        matchPreview = await loadAttendanceMatchPreview(Number(activityId), Number(task.id));
      }
      const boundRows = bindAttendanceStaging(result.rows, serverRows);
      setAttendanceMatchPreview(matchPreview);
      setPendingAttendanceImport({ ...result, rows: matchPreview ? mergeAttendanceMatchPreview(boundRows, matchPreview) : boundRows,
        fileName: file.name, inputCount: result.rows.length });
      setActionNotice(matchPreview
        ? `已解析 ${result.rows.length} 名现场到场客户：预计关联 ${matchPreview.matchedCount} 名、待确认 ${matchPreview.pendingCount} 名、未关联 ${matchPreview.unmatchedCount} 名。`
        : `已解析 ${result.rows.length} 名现场到场客户，请检查预览后确认导入。`);
    } catch (error) {
      onAttendanceImportErrorChange(`${stage}失败：${error instanceof Error ? error.message : "请稍后重试。"}`);
      setAttendanceMatchPreview(null);
    } finally {
      setAttendancePreviewLoading(false);
    }
  };
  const retryAttendancePreview = async () => {
    if (activityClosed || attendancePreviewLoading || attendancePublishing || !pendingAttendanceImport || !serverImportTasks.ATTENDANCE) return;
    try {
      await refreshServerImportPreview("ATTENDANCE");
      setActionNotice("现场到场名单预览及白名单关联试算已更新，请检查后确认导入。");
    } catch (error) {
      onAttendanceImportErrorChange(`导入预览或白名单关联试算失败：${error instanceof Error ? error.message : "请稍后重试。"}`);
    }
  };
  const cancelAttendanceImport = async () => {
    if (attendancePreviewLoading || attendancePublishing) return;
    if (!pendingAttendanceImport && !attendanceImportError) return;
    const taskId = serverImportTasks.ATTENDANCE;
    if (taskId && Number.isFinite(Number(activityId))) {
      try {
        await cancelImport(Number(activityId), taskId);
      } catch (error) {
        setActionNotice(error instanceof ApiError ? error.message : "取消现场到场导入失败，请稍后重试。");
        return;
      }
      setServerImportTasks((current) => ({ ...current, ATTENDANCE: undefined }));
      setServerImportBlocking((current) => ({ ...current, ATTENDANCE: 0 }));
    }
    setPendingAttendanceImport(null);
    setAttendanceMatchPreview(null);
    setAttendanceImportAttemptName("");
    onAttendanceImportErrorChange("");
    setAttendanceFormOpen(false);
    setEditingAttendanceRow(null);
    setActionNotice("已取消本次现场到场名单导入，当前名单保持不变。" );
  };
  const confirmAttendanceImport = async () => {
    if (attendancePublishing || attendancePreviewLoading || attendanceImportError) return;
    if (activityClosed) {
      setActionNotice("活动已截止，现场到场名单只读。" );
      return;
    }
    if (!pendingAttendanceImport) return;
    if ((serverImportBlocking.ATTENDANCE ?? 0) > 0) {
      setActionNotice(`仍有 ${serverImportBlocking.ATTENDANCE} 条到场名单异常，请先编辑或删除后再发布。`);
      return;
    }
    if (!attendanceMatchPreview) {
      setActionNotice("请先等待到场名单与当前白名单的实时试算完成。");
      return;
    }
    const eligibleCustomers = new Set(pendingAttendanceImport.rows.filter((row) => row.matchStatus === "MATCHED" && row.lotteryEligible)
      .map((row) => row.activityCustomerId).filter((id): id is number => id != null)).size;
    const pendingMatches = pendingAttendanceImport.rows.filter((row) => row.matchStatus === "PENDING_CONFIRMATION").length;
    const unmatchedMatches = pendingAttendanceImport.rows.filter((row) => row.matchStatus === "UNMATCHED").length;
    if (!window.confirm(`将以当前预览完整替换现场到场名单：共 ${pendingAttendanceImport.rows.length} 名，资格客户 ${eligibleCustomers} 名，待确认 ${pendingMatches} 条，未关联 ${unmatchedMatches} 条。待确认和未关联记录不会进入抽奖候选池，是否继续？`)) return;
    setAttendancePublishing(true);
    const taskId = serverImportTasks.ATTENDANCE;
    try {
      if (taskId) {
        await confirmImport(Number(activityId), taskId, undefined, undefined, attendanceMatchPreview.whitelistVersionId ?? null);
        await waitForImport(Number(activityId), taskId, importWaitOptions?.());
      }
      const imported = pendingAttendanceImport;
      let publishedRows = cloneAttendanceRows(imported.rows), readbackError = false;
      if (taskId) {
        try { publishedRows = mapAdminAttendanceRows(await loadAdminAttendees(Number(activityId))); }
        catch { readbackError = true; publishedRows = []; }
        setServerImportTasks(current => ({ ...current, ATTENDANCE: undefined }));
        setServerImportBlocking(current => ({ ...current, ATTENDANCE: 0 }));
      }
      setAttendanceRows(publishedRows);
      onAttendanceFileNameChange(imported.fileName);
      onAttendanceWarningsChange(imported.warnings);
      onAttendanceSheetCountsChange(imported.sheetCounts);
      onAttendanceImportErrorChange("");
      setPendingAttendanceImport(null);
      setAttendanceMatchPreview(null);
      setAttendanceImportAttemptName("");
      setAttendanceFormOpen(false);
      setEditingAttendanceRow(null);
      const linkedCount = publishedRows.filter((row) => row.lotteryEligible).length;
      recordOperation("替换现场到场 Excel", imported.fileName, `确认导入 ${publishedRows.length} 名现场到场客户；重新关联当前白名单，${linkedCount} 名具备抽奖资格。`);
      if (readbackError) onReadbackFailed?.();
      setActionNotice(readbackError ? "现场到场名单已替换成功，但最新列表读取失败。请点击刷新列表核对，请勿重复确认导入。" : `现场到场 Excel 导入完成：${publishedRows.length} 名，已关联 ${linkedCount} 名。`);
    } catch (error) {
      setActionNotice(error instanceof ApiError ? error.message : "现场到场名单发布失败，请处理异常数据后重试。");
    } finally {
      setAttendancePublishing(false);
    }
  };
  const saveAttendanceRow = async (row: AttendanceRow): Promise<DrawerSaveResult> => {
    if (activityClosed) {
      return saveFailure("活动已截止，现场到场名单只读。" );
    }
    if (pendingAttendanceImport) {
      if (editingAttendanceRow) {
        const taskId = serverImportTasks.ATTENDANCE;
        if (!taskId || !editingAttendanceRow.serverRowId) {
          return saveFailure("当前到场预览记录未绑定后端 staging，请重新选择 Excel 后再编辑。");
        }
        try {
          await updateImportRow(Number(activityId), taskId, editingAttendanceRow.serverRowId, {
            participantName: row.dealerName, gender: row.gender, contactPhone: row.contactPhone,
            branchName: row.branch, dealerFullName: row.dealerCompany, participantType: row.participantType,
          });
        } catch (error) { return saveFailure(error instanceof ApiError ? error.message : "到场名单预览修改失败"); }
        setPendingAttendanceImport((current) => current ? { ...current, rows: current.rows.map((item) => item.id === row.id ? row : item) } : current);
        try { await refreshServerImportPreview("ATTENDANCE"); }
        catch (error) { return saveFailure(error instanceof ApiError ? `修改已保存，但关联试算刷新失败：${error.message}。请先刷新列表核对。` : "修改已保存，但关联试算刷新失败，请先刷新列表核对。", true); }
        setActionNotice(`已修改待导入到场客户：${row.dealerCompany || row.dealerName || "未命名客户"}，确认导入后生效。`);
        return { ok: true };
      } else {
        return saveFailure("导入预览阶段不能新增到场客户；请先发布本次 Excel，再使用单条新增。");
      }
    }
    const attendeeBody = { participantName: row.dealerName, gender: row.gender, participantType: row.participantType,
      dealerName: row.dealerCompany, branchName: row.branch, phone: row.contactPhone };
    if (editingAttendanceRow) {
      let savedRow = row;
      try {
        const saved = await updateAdminAttendee(Number(activityId), Number(editingAttendanceRow.id), attendeeBody);
        savedRow = { ...mapAdminAttendanceRows([saved])[0], sequence: row.sequence, manuallyEdited: true };
      } catch (error) { return saveFailure(error instanceof ApiError ? error.message : "到场客户保存失败"); }
      setAttendanceRows((current) => current.map((item) => item.id === row.id ? savedRow : item));
      if (activityStarted) recordOperation("活动开始后改单条现场到场客户", row.dealerCompany || row.dealerName, `修改现场到场信息；原因由表单记录。`);
      else recordOperation("编辑现场到场客户", row.dealerCompany || row.dealerName, "修改当前现场到场名单信息。" );
      setActionNotice(`${activityStarted ? "已记录并保存" : "已保存"}到场客户修改：${row.dealerCompany || row.dealerName || "未命名客户"}`);
      return { ok: true };
    } else {
      let savedRow = row;
      try {
        const saved = await createAdminAttendee(Number(activityId), attendeeBody);
        savedRow = { ...mapAdminAttendanceRows([saved])[0], sequence: row.sequence, manuallyEdited: true };
      } catch (error) { return saveRequestFailure(error, "到场客户新增失败，请检查网络连接", true); }
      setAttendanceRows((current) => [...current, savedRow]);
      recordOperation(activityStarted ? "活动开始后手动新增现场到场客户" : "手动添加现场到场客户", row.dealerCompany || row.dealerName, activityStarted ? "活动开始后单条补录现场到场客户。" : "手动添加现场到场客户。" );
      setActionNotice(`已添加到场客户：${row.dealerCompany || row.dealerName || "未命名客户"}`);
      return { ok: true };
    }
  };
  const deleteAttendanceRows = async (ids: string[]) => {
    if (activityClosed) {
      setActionNotice("活动已截止，现场到场名单只读。");
      return;
    }
    if (ids.length === 0) return;
    if (pendingAttendanceImport) {
      if (serverImportTasks.ATTENDANCE) {
        const targets = pendingAttendanceImport.rows.filter((row) => ids.includes(row.id) && row.serverRowId);
        try {
          if (targets.length > 0) await deleteImportRows(Number(activityId), serverImportTasks.ATTENDANCE, targets.map((row) => row.serverRowId!));
        } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "到场名单预览删除失败"); return; }
      }
      setPendingAttendanceImport((current) => current ? { ...current, rows: current.rows.filter((row) => !ids.includes(row.id)) } : current);
      try { await refreshServerImportPreview("ATTENDANCE"); }
      catch (error) { setActionNotice(error instanceof ApiError ? `删除已保存，但关联试算刷新失败：${error.message}` : "删除已保存，但关联试算刷新失败，请重试。"); return; }
      setActionNotice(`已从待导入结果移除 ${ids.length} 名到场客户，确认导入后生效。`);
      return;
    }
    const result = await deleteConfirmedRows(ids, id => deleteAdminAttendee(Number(activityId), Number(id)));
    if (result.deleted.length) setAttendanceRows(current => current.filter(row => !result.deleted.includes(row.id)));
    setEditingAttendanceRow(current => current && result.deleted.includes(current.id) ? null : current);
    if (result.deleted.length) recordOperation("删除现场到场客户", result.deleted.length + " 名客户", "服务器确认删除的记录已同步移除，抽奖候选池已更新。");
    setActionNotice(result.error ? "已删除 " + result.deleted.length + " 名，其余记录未确认删除：" + result.error
      : "已删除 " + result.deleted.length + " 名现场到场客户，抽奖候选池已同步更新。");
  };
  return {
    attendanceFormOpen,
    setAttendanceFormOpen,
    editingAttendanceRow,
    setEditingAttendanceRow,
    pendingAttendanceImport,
    setPendingAttendanceImport,
    setAttendanceMatchPreview,
    attendancePreviewReady: attendanceMatchPreview !== null && !attendanceImportError,
    attendancePreviewLoading,
    setAttendancePreviewLoading,
    attendancePublishing,
    attendanceImportAttemptName,
    setAttendanceImportAttemptName,
    handleAttendanceFile,
    retryAttendancePreview,
    cancelAttendanceImport,
    confirmAttendanceImport,
    saveAttendanceRow,
    deleteAttendanceRows,
  };
}
