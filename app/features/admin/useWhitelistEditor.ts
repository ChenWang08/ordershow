"use client";

import { mapAdminWhitelistRows } from "./whitelist-utils";
import { deleteConfirmedRows } from "./delete-confirmed-rows";

import { saveFailure, saveRequestFailure, type DrawerSaveResult } from "../../components/drawer-save-result";

import { useState, type Dispatch, type SetStateAction } from "react";
import { ApiError, createAdminCustomer, updateAdminCustomer, deleteAdminCustomer, updateImportRow, deleteImportRows } from "../../api";
import { whitelistCustomerTypeCode, whitelistIdentityKey, type WhitelistRow } from "../../domain/import-domain";
import type { CustomerModuleOptions } from "./customer-module-types";
import type { useWhitelistImport } from "./useWhitelistImport";

type WhitelistEditorOptions = CustomerModuleOptions & {
  setWhitelistRows: Dispatch<SetStateAction<WhitelistRow[]>>;
  whitelistRows: WhitelistRow[];
  whitelistImportCompleted: boolean;
  regionCodesByName: Record<string, string>;
  whitelistImport: Pick<ReturnType<typeof useWhitelistImport>, "whitelistFileName" | "whitelistImportError" | "setWhitelistImportInputCount">;
};

export function useWhitelistEditor({
  activityId, activityStatus, whitelistRows, setWhitelistRows, whitelistImportCompleted,
  regionCodesByName, serverImportTasks, setActionNotice, recordOperation, refreshServerImportPreview, whitelistImport,
}: WhitelistEditorOptions) {
  const regions = new Map(Object.entries(regionCodesByName).map(([name, code]) => [code, name]));
  const activityStarted = activityStatus === "running" || activityStatus === "closed" || activityStatus === "finished";
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityPublished = activityStatus !== "draft";
  const baseDataReadOnly = activityStatus === "scheduled" || activityClosed;
  const { whitelistFileName, whitelistImportError, setWhitelistImportInputCount } = whitelistImport;
  const [editingWhitelistRow, setEditingWhitelistRow] = useState<WhitelistRow | null>(null);
  const [whitelistFormOpen, setWhitelistFormOpen] = useState(false);
  const openWhitelistForm = () => {
    if (baseDataReadOnly) {
      setActionNotice(activityClosed ? "活动已截止，白名单数据只读。" : "活动已发布，修改白名单请先撤回发布。" );
      return;
    }
    if (!whitelistImportCompleted && (!whitelistFileName || whitelistImportError)) {
      setActionNotice("请先完成一次白名单 Excel 解析，再手动添加客户。" );
      return;
    }
    setEditingWhitelistRow(null);
    setWhitelistFormOpen(true);
  };
  const saveWhitelistRow = async (row: WhitelistRow, reason = ""): Promise<DrawerSaveResult> => {
    if (activityClosed) {
      return saveFailure("活动已截止，白名单数据只读。" );
    }
    const nextRow = { ...row, identityKey: whitelistIdentityKey(row) };
    const customerBody = {
      customerType: whitelistCustomerTypeCode(nextRow.customerType),
      regionCode: regionCodesByName[nextRow.region] || nextRow.region || null, branchName: nextRow.branch,
      dealerShortName: nextRow.dealerShort, dealerFullName: nextRow.dealerFull, dealerCategory: nextRow.dealerType,
      contactName: nextRow.dealerName, phone: nextRow.dealerPhone, confirmerName: nextRow.confirmerName,
      confirmerPhone: nextRow.confirmerPhone,
      expectedVersion: editingWhitelistRow?.serverVersion ?? 0, reason,
    };
    if (editingWhitelistRow) {
      if (!whitelistImportCompleted) {
        const taskId = serverImportTasks.WHITELIST;
        if (!taskId || !editingWhitelistRow.serverRowId) {
          return saveFailure("当前白名单预览记录未绑定后端 staging，请重新选择 Excel 后再编辑。");
        }
        try {
          const previewChanges: Record<string, unknown> = {
            customerType: whitelistCustomerTypeCode(nextRow.customerType), regionName: nextRow.region,
            branchName: nextRow.branch, dealerShortName: nextRow.dealerShort, dealerFullName: nextRow.dealerFull,
            dealerCategory: nextRow.dealerType, contactName: nextRow.dealerName, customerTypeInvalid: false,
            confirmerName: nextRow.confirmerName,
          };
          if (!nextRow.dealerPhone.includes("*")) previewChanges.dealerPhone = nextRow.dealerPhone;
          if (!nextRow.confirmerPhone.includes("*")) previewChanges.confirmerPhone = nextRow.confirmerPhone;
          await updateImportRow(Number(activityId), taskId, editingWhitelistRow.serverRowId, previewChanges);
        } catch (error) { return saveFailure(error instanceof ApiError ? error.message : "白名单预览修改失败"); }
      }
      let savedRow: WhitelistRow = { ...nextRow, manuallyEdited: true };
      if (whitelistImportCompleted) {
        if (editingWhitelistRow.serverVersion === undefined) {
          return saveFailure("当前白名单记录缺少后端版本信息，请刷新页面后重试。");
        }
        try {
          const saved = await updateAdminCustomer(Number(activityId), Number(editingWhitelistRow.id), customerBody);
          savedRow = { ...mapAdminWhitelistRows([saved], regions)[0], sequence: saved.excelSequence ?? nextRow.sequence, manuallyEdited: true };
        } catch (error) { return saveFailure(error instanceof ApiError ? error.message : "白名单保存失败"); }
      }
      setWhitelistRows((current) => current.map((item) => item.id === nextRow.id ? savedRow : item));
      if (!whitelistImportCompleted) {
        try { await refreshServerImportPreview("WHITELIST"); }
        catch (error) { return saveFailure(error instanceof ApiError ? `修改已保存，但预览刷新失败：${error.message}。请先刷新列表核对。` : "修改已保存，但预览刷新失败，请先刷新列表核对。", true); }
      }
      if (activityStarted) recordOperation("活动开始后改单条白名单", nextRow.dealerShort || nextRow.dealerFull, `修改前：客户类型 ${editingWhitelistRow.customerType}、全称 ${editingWhitelistRow.dealerFull || "—"}、姓名 ${editingWhitelistRow.dealerName || "—"}、电话 ${editingWhitelistRow.dealerPhone || "—"}、分公司 ${editingWhitelistRow.branch || "—"}、状态 ${editingWhitelistRow.status}；修改后：客户类型 ${nextRow.customerType}、全称 ${nextRow.dealerFull || "—"}、姓名 ${nextRow.dealerName || "—"}、电话 ${nextRow.dealerPhone || "—"}、分公司 ${nextRow.branch || "—"}、状态 ${nextRow.status}；原因：${reason || "—"}。`);
      if (!activityStarted) recordOperation("修改白名单", nextRow.dealerShort || nextRow.dealerFull, "已保存当前白名单资料。");
      setActionNotice(`${activityStarted ? "已记录并保存" : "已保存"}白名单修改：${nextRow.dealerShort}`);
      return { ok: true };
    }
    if (!whitelistImportCompleted && whitelistFileName) {
      return saveFailure("导入预览阶段不能新增白名单客户；请先发布本次 Excel，再使用单条新增。");
    }
    let manualRow: WhitelistRow = { ...nextRow, source: "manual", status: "有效", manuallyEdited: true };
    if (whitelistImportCompleted) {
      try {
        const saved = await createAdminCustomer(Number(activityId), customerBody);
        manualRow = { ...mapAdminWhitelistRows([saved], regions)[0], sequence: saved.excelSequence ?? nextRow.sequence, source: "manual", manuallyEdited: true };
      } catch (error) { return saveRequestFailure(error, "白名单新增失败，请检查网络连接", true); }
    }
    setWhitelistRows((current) => [...current, manualRow]);
    if (!whitelistImportCompleted && whitelistFileName) {
      setWhitelistImportInputCount((current) => current + 1);
    }
    recordOperation(activityStarted ? "活动开始后手动新增白名单客户" : "手动添加白名单客户", manualRow.dealerShort || manualRow.dealerFull, `客户类型：${manualRow.customerType}；电话：${manualRow.dealerPhone || "—"}；${activityStarted ? `原因：${reason || "—"}。` : ""}`);
    setActionNotice(`${activityStarted ? "已记录并添加" : "已添加"}白名单客户：${manualRow.dealerShort || manualRow.dealerFull}`);
    return { ok: true };
  };
  const deleteWhitelistRows = async (ids: string[]) => {
    if (activityPublished) {
      setActionNotice("活动发布后禁止删除白名单客户；待开始状态请先撤回发布。");
      return;
    }
    if (!whitelistImportCompleted && serverImportTasks.WHITELIST) {
      const targets = whitelistRows.filter((row) => ids.includes(row.id) && row.serverRowId);
      try {
        if (targets.length > 0) await deleteImportRows(Number(activityId), serverImportTasks.WHITELIST, targets.map((row) => row.serverRowId!));
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单预览删除失败"); return; }
    } else if (whitelistImportCompleted) {
      const result = await deleteConfirmedRows(ids, async id => {
        const row = whitelistRows.find(item => item.id === id);
        if (!row || row.serverVersion === undefined) throw new Error("记录版本缺失，请刷新列表核对。");
        await deleteAdminCustomer(Number(activityId), Number(id), row.serverVersion);
      });
      if (result.deleted.length) setWhitelistRows(current => current.filter(row => !result.deleted.includes(row.id)));
      setEditingWhitelistRow(current => current && result.deleted.includes(current.id) ? null : current);
      if (result.deleted.length) recordOperation("删除白名单", result.deleted.length + " 条", "已同步移除服务器确认删除的记录。");
      setActionNotice(result.error ? "已删除 " + result.deleted.length + " 条，其余记录未确认删除：" + result.error
        : "已删除 " + result.deleted.length + " 条白名单，已有订单不会被删除。");
      return;
    }
    setWhitelistRows((current) => {
      const nextRows = current.filter((row) => !ids.includes(row.id));
      return nextRows;
    });
    if (!whitelistImportCompleted) await refreshServerImportPreview("WHITELIST");
    setEditingWhitelistRow((current) => current && ids.includes(current.id) ? null : current);
    recordOperation("删除白名单", `${ids.length} 名客户`, "从当前有效白名单移除；已有订单不会被删除。" );
    setActionNotice(`${whitelistImportCompleted ? "已删除" : "已从待导入结果移除"} ${ids.length} 名白名单客户，已有订单不会被删除。`);
  };
  return { editingWhitelistRow, setEditingWhitelistRow, whitelistFormOpen, setWhitelistFormOpen, openWhitelistForm, saveWhitelistRow, deleteWhitelistRows };
}
