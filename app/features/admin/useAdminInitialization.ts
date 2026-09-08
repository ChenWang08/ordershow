"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { ApiError, loadActivity, loadAdminProducts, loadProductImageReviews, loadAdminCustomers, loadAdminAttendees, loadLotteryRules, loadAuditLogs, loadImportTasks, loadImportRows, loadAttendanceMatchPreview, type ImportTask } from "../../api";
import { cloneProductRows, cloneWhitelistRows, type WhitelistRow } from "../../domain/import-domain";
import { mapLotteryRule } from "../lottery/Lottery";
import { mergeProductImageReviews, runtimeProductToImportRow, restoreProductPreview, restoreWhitelistPreview, restoreAttendancePreview, restoredSheetCounts } from "./admin-utils";
import { mapAdminAttendanceRows, mergeAttendanceMatchPreview } from "./attendance-utils";
import type { AdminWorkspaceProps, OperationLogEntry } from "./admin-types";
import type { ImportTaskIds } from "./product-module-types";
import type { useProductImport } from "./useProductImport";
import type { useWhitelistImport } from "./useWhitelistImport";
import type { useAttendanceManagement } from "./useAttendanceManagement";

type AdminInitializationOptions = Pick<AdminWorkspaceProps,
  "activityId" | "onAttendanceFileNameChange" | "onLotteryChange" | "onProductImportCommitted"
  | "onProductImportCompleted" | "onWhitelistImportCommitted" | "onWhitelistImportCompleted"
> & Pick<ReturnType<typeof useProductImport>,
  "setPendingProductRollbackRows" | "setProductFileName" | "setProductImportInputCount" | "setProductSheetCounts"
> & Pick<ReturnType<typeof useWhitelistImport>,
  "setPendingWhitelistRollbackRows" | "setWhitelistFileName" | "setWhitelistImportInputCount" | "setWhitelistSheetCounts"
> & Pick<ReturnType<typeof useAttendanceManagement>,
  "setAttendanceImportAttemptName" | "setAttendanceMatchPreview" | "setPendingAttendanceImport"
> & {
  setProductRows: AdminWorkspaceProps["onProductRowsChange"];
  setWhitelistRows: AdminWorkspaceProps["onWhitelistRowsChange"];
  setAttendanceRows: AdminWorkspaceProps["onAttendanceRowsChange"];
  setRegionCodesByName: Dispatch<SetStateAction<Record<string, string>>>;
  setOperationLogs: Dispatch<SetStateAction<OperationLogEntry[]>>;
  setServerImportTasks: Dispatch<SetStateAction<ImportTaskIds>>;
  setServerImportBlocking: Dispatch<SetStateAction<ImportTaskIds>>;
  setActionNotice: (notice: string) => void;
};

export function useAdminInitialization({
  activityId, onAttendanceFileNameChange, onLotteryChange,
    onProductImportCommitted, onProductImportCompleted, onWhitelistImportCommitted,
    onWhitelistImportCompleted, setAttendanceRows, setProductRows,
    setWhitelistRows, setPendingProductRollbackRows, setProductFileName,
    setProductImportInputCount, setProductSheetCounts, setPendingWhitelistRollbackRows,
    setWhitelistFileName, setWhitelistImportInputCount, setWhitelistSheetCounts,
    setAttendanceImportAttemptName, setAttendanceMatchPreview, setPendingAttendanceImport,
    setRegionCodesByName, setOperationLogs, setServerImportTasks,
    setServerImportBlocking, setActionNotice,
}: AdminInitializationOptions) {
  useEffect(() => {
    const numericActivityId = Number(activityId);
    if (!Number.isFinite(numericActivityId)) return;
    let active = true;
    void Promise.all([loadActivity(), loadAdminProducts(numericActivityId), loadProductImageReviews(numericActivityId), loadAdminCustomers(numericActivityId),
      loadAdminAttendees(numericActivityId), loadLotteryRules(numericActivityId), loadAuditLogs(numericActivityId), loadImportTasks(numericActivityId)]).then(async ([activity, serverProducts, imageReviews, customers, attendees, rules, auditLogs, importTasks]) => {
      if (!active) return;
      const regionNames = new Map(activity.regions.map((region) => [region.code, region.name]));
      setRegionCodesByName(Object.fromEntries(activity.regions.map((region) => [region.name, region.code])));
      const publishedProductRows = mergeProductImageReviews(serverProducts.map(runtimeProductToImportRow), imageReviews);
      if (serverProducts.length > 0) {
        setProductRows(publishedProductRows);
        onProductImportCompleted(true); onProductImportCommitted(); setProductFileName("当前已发布商品目录"); setProductImportInputCount(serverProducts.length);
      }
      const publishedWhitelistRows: WhitelistRow[] = customers.map((customer, index) => ({
        id: String(customer.id), serverVersion: customer.lockVersion, sequence: customer.excelSequence ?? index + 1,
        customerType: customer.customerType === "GENERAL" ? "综合客户" : customer.customerType === "SPECIAL" ? "特渠专业客户" : "",
        region: regionNames.get(customer.regionCode || "") || customer.regionCode || "", branch: customer.branchName || "",
        dealerShort: customer.dealerShortName || "", dealerFull: customer.dealerFullName, dealerType: customer.dealerCategory || "",
        dealerName: customer.contactName || "", dealerPhone: customer.phone || customer.phoneMasked, confirmerName: customer.confirmerName || "",
        confirmerPhone: customer.confirmerPhone || customer.confirmerPhoneMasked || "", status: customer.active ? "有效" : "待处理", source: "excel",
      }));
      if (customers.length > 0) {
        setWhitelistRows(publishedWhitelistRows);
        onWhitelistImportCompleted(true); onWhitelistImportCommitted(); setWhitelistFileName("当前已发布白名单"); setWhitelistImportInputCount(customers.length);
      }
      if (attendees.length > 0) {
        setAttendanceRows(mapAdminAttendanceRows(attendees));
        onAttendanceFileNameChange("当前已发布现场到场名单");
      }
      const rule = rules.find((item) => item.status === "PUBLISHED") ?? rules[0];
      if (rule) onLotteryChange(mapLotteryRule(rule));
      setOperationLogs(auditLogs.map((entry) => ({ id: String(entry.id), action: entry.actionCode, target: `${entry.objectType}${entry.objectId ? ` #${entry.objectId}` : ""}`,
        detail: entry.result === "SUCCESS" ? `操作成功 · 追踪号 ${entry.traceId}` : `操作失败：${entry.errorCode || "未知错误"}`,
        operator: entry.actorName || (entry.actorType === "H5_CUSTOMER" ? "H5 客户" : "系统"),
        time: new Date(entry.occurredAt).toLocaleString("zh-CN", { hour12: false }) })));
      const pendingTasks = (["PRODUCT", "WHITELIST", "ATTENDANCE"] as const)
        .map((type) => importTasks.find((task) => task.importType === type && task.status === "PREVIEW_READY"))
        .filter((task): task is ImportTask => Boolean(task));
      for (const task of pendingTasks) {
        const staging = await loadImportRows(numericActivityId, task.id);
        if (!active) return;
        setServerImportTasks((current) => ({ ...current, [task.importType]: task.id }));
        setServerImportBlocking((current) => ({ ...current, [task.importType]: task.errorCount }));
        if (task.importType === "PRODUCT") {
          setPendingProductRollbackRows(cloneProductRows(publishedProductRows));
          setProductRows(restoreProductPreview(staging));
          setProductFileName(task.sourceFilename); setProductSheetCounts(restoredSheetCounts(staging));
          setProductImportInputCount(task.inputCount); onProductImportCompleted(false);
        } else if (task.importType === "WHITELIST") {
          setPendingWhitelistRollbackRows(cloneWhitelistRows(publishedWhitelistRows));
          setWhitelistRows(restoreWhitelistPreview(staging));
          setWhitelistFileName(task.sourceFilename); setWhitelistSheetCounts(restoredSheetCounts(staging));
          setWhitelistImportInputCount(task.inputCount); onWhitelistImportCompleted(false);
        } else {
          const restoredRows = restoreAttendancePreview(staging);
          const matchPreview = await loadAttendanceMatchPreview(numericActivityId, task.id);
          if (!active) return;
          setAttendanceMatchPreview(matchPreview); setAttendanceImportAttemptName(task.sourceFilename);
          setPendingAttendanceImport({ rows: mergeAttendanceMatchPreview(restoredRows, matchPreview), warnings: [],
            sheetCounts: restoredSheetCounts(staging), fileName: task.sourceFilename, inputCount: task.inputCount });
        }
      }
      if (pendingTasks.length > 0) setActionNotice("已恢复服务器中尚未确认的导入预览，请确认或取消后再发布活动。");
    }).catch((reason) => { if (active) setActionNotice(reason instanceof ApiError ? reason.message : "后台数据加载失败"); });
    return () => { active = false; };
  }, [activityId, onAttendanceFileNameChange, onLotteryChange, onProductImportCommitted, onProductImportCompleted,
    onWhitelistImportCommitted, onWhitelistImportCompleted, setAttendanceRows, setProductRows, setWhitelistRows,
    setPendingProductRollbackRows, setProductFileName, setProductImportInputCount, setProductSheetCounts,
    setPendingWhitelistRollbackRows, setWhitelistFileName, setWhitelistImportInputCount, setWhitelistSheetCounts,
    setAttendanceImportAttemptName, setAttendanceMatchPreview, setPendingAttendanceImport,
    setActionNotice, setRegionCodesByName, setOperationLogs, setServerImportTasks, setServerImportBlocking]);
}
