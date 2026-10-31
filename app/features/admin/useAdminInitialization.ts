"use client";

import { formatBeijingTime } from "../shared/time";
import { useAdminIdentity } from "../../admin-context";
import { canUse, isManager } from "./permissions";
import { type Dispatch, type SetStateAction } from "react";
import { loadAdminProducts, loadProductImageReviews, loadAdminCustomers, loadAdminAttendees,
  loadLotteryRules, loadAuditLogs, loadImportTasks, loadImportRows, loadAttendanceMatchPreview, waitForImport,
  type RuntimeActivity, type ImportTask } from "../../api";
import { cloneProductRows, cloneWhitelistRows, type WhitelistRow } from "../../domain/import-domain";
import { initialLotteryRounds, mapLotteryRule } from "../lottery/Lottery";
import { mergeProductImageReviews, runtimeProductToImportRow, restoreProductPreview, restoreWhitelistPreview,
  restoreAttendancePreview, restoredSheetCounts } from "./admin-utils";
import { mapAdminAttendanceRows, mergeAttendanceMatchPreview } from "./attendance-utils";
import type { AdminWorkspaceProps, OperationLogEntry } from "./admin-types";
import type { ImportTaskIds } from "./product-module-types";
import type { useProductImport } from "./useProductImport";
import type { useWhitelistImport } from "./useWhitelistImport";
import type { useAttendanceManagement } from "./useAttendanceManagement";
import { useLazyAdminQuery } from "./useLazyAdminQuery";

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
  tab: string;
  logsOpen: boolean;
  activity: RuntimeActivity | null;
  preservePreviews?: { product: boolean; whitelist: boolean; attendance: boolean; lottery: boolean };
  setProductRows: AdminWorkspaceProps["onProductRowsChange"];
  setWhitelistRows: AdminWorkspaceProps["onWhitelistRowsChange"];
  setAttendanceRows: AdminWorkspaceProps["onAttendanceRowsChange"];
  setOperationLogs: Dispatch<SetStateAction<OperationLogEntry[]>>;
  setServerImportTasks: Dispatch<SetStateAction<ImportTaskIds>>;
  setServerImportBlocking: Dispatch<SetStateAction<ImportTaskIds>>;
  setActionNotice: (notice: string) => void;
};

const commit = (apply: () => void) => apply();

export function useAdminInitialization(options: AdminInitializationOptions) {
  const identity = useAdminIdentity();
  const o = options, id = Number(o.activityId);
  const enabled = (tab: string, permission: "PRODUCT" | "WHITELIST" | "ATTENDANCE" | "LOTTERY") =>
    o.tab === tab && canUse(identity, permission);
  async function preview(type: ImportTask["importType"], signal: AbortSignal) {
    const tasks = await loadImportTasks(id, type, signal);
    const processing = tasks.find(item => item.importType === type
      && ["CONFIRMING", "MATERIALIZING", "READY_TO_PUBLISH", "PUBLISHING"].includes(item.status));
    if (processing) { await waitForImport(id, processing.id, { signal }); return null; }
    const task = tasks.find(item => item.importType === type && (item.status === "PREVIEW_READY"
      || (item.status === "FAILED" && item.failureCode === "PUBLISH_FAILED")));
    if (!task) return null;
    const rows = await loadImportRows(id, task.id, undefined, signal);
    return { task, rows };
  }
  function importState(type: ImportTask["importType"], task?: ImportTask) {
    o.setServerImportTasks(current => ({ ...current, [type]: task?.id }));
    o.setServerImportBlocking(current => ({ ...current, [type]: task?.errorCount ?? 0 }));
    if (task) o.setActionNotice("已恢复当前模块尚未确认的导入预览，请确认或取消后再发布活动。");
  }
  const product = useLazyAdminQuery(o.activityId + ":PRODUCT", enabled("商品导入", "PRODUCT"), async signal => {
    const pending = await preview("PRODUCT", signal);
    const [products, reviews] = await Promise.all([
      loadAdminProducts(id, {}, signal), loadProductImageReviews(id, signal),
    ]);
    const published = mergeProductImageReviews(products.map(runtimeProductToImportRow), reviews);
    return () => {
      o.setProductRows(published); o.onProductImportCompleted(products.length > 0);
      if (products.length > 0) o.onProductImportCommitted();
      o.setProductFileName(products.length ? "当前已发布商品目录" : "");
      o.setProductImportInputCount(products.length); o.setProductSheetCounts([]);
      o.setPendingProductRollbackRows(null); importState("PRODUCT", pending?.task);
      if (pending) {
        o.setPendingProductRollbackRows(cloneProductRows(published));
        o.setProductRows(restoreProductPreview(pending.rows)); o.onProductImportCompleted(false);
        o.setProductFileName(pending.task.sourceFilename); o.setProductImportInputCount(pending.task.inputCount);
        o.setProductSheetCounts(restoredSheetCounts(pending.rows));
      }
    };
  }, commit, o.preservePreviews?.product);
  const whitelist = useLazyAdminQuery(o.activityId + ":WHITELIST", enabled("白名单", "WHITELIST"), async signal => {
    const pending = await preview("WHITELIST", signal);
    const customers = await loadAdminCustomers(id, signal);
    const regions = new Map(o.activity?.regions.map(region => [region.code, region.name]) ?? []);
    const published: WhitelistRow[] = customers.map((customer, index) => ({
      id: String(customer.id), serverVersion: customer.lockVersion, sequence: customer.excelSequence ?? index + 1,
      customerType: customer.customerType === "GENERAL" ? "综合客户" : customer.customerType === "SPECIAL" ? "特渠专业客户" : "",
      region: regions.get(customer.regionCode || "") || customer.regionCode || "", branch: customer.branchName || "",
      dealerShort: customer.dealerShortName || "", dealerFull: customer.dealerFullName, dealerType: customer.dealerCategory || "",
      dealerName: customer.contactName || "", dealerPhone: customer.phone || customer.phoneMasked, confirmerName: customer.confirmerName || "",
      confirmerPhone: customer.confirmerPhone || customer.confirmerPhoneMasked || "", status: customer.active ? "有效" : "待处理", source: "excel",
    }));
    return () => {
      o.setWhitelistRows(published); o.onWhitelistImportCompleted(customers.length > 0);
      if (customers.length > 0) o.onWhitelistImportCommitted();
      o.setWhitelistFileName(customers.length ? "当前已发布白名单" : "");
      o.setWhitelistImportInputCount(customers.length); o.setWhitelistSheetCounts([]);
      o.setPendingWhitelistRollbackRows(null); importState("WHITELIST", pending?.task);
      if (pending) {
        o.setPendingWhitelistRollbackRows(cloneWhitelistRows(published));
        o.setWhitelistRows(restoreWhitelistPreview(pending.rows)); o.onWhitelistImportCompleted(false);
        o.setWhitelistFileName(pending.task.sourceFilename); o.setWhitelistImportInputCount(pending.task.inputCount);
        o.setWhitelistSheetCounts(restoredSheetCounts(pending.rows));
      }
    };
  }, commit, o.preservePreviews?.whitelist);
  const attendance = useLazyAdminQuery(o.activityId + ":ATTENDANCE", enabled("现场到场", "ATTENDANCE"), async signal => {
    const pending = await preview("ATTENDANCE", signal);
    const attendees = await loadAdminAttendees(id, signal);
    const match = pending ? await loadAttendanceMatchPreview(id, pending.task.id, signal) : null;
    return () => {
      o.setAttendanceRows(mapAdminAttendanceRows(attendees));
      o.onAttendanceFileNameChange(attendees.length ? "当前已发布现场到场名单" : "");
      o.setPendingAttendanceImport(null); o.setAttendanceMatchPreview(null); o.setAttendanceImportAttemptName("");
      importState("ATTENDANCE", pending?.task);
      if (pending && match) {
        o.setAttendanceMatchPreview(match); o.setAttendanceImportAttemptName(pending.task.sourceFilename);
        o.setPendingAttendanceImport({ rows: mergeAttendanceMatchPreview(restoreAttendancePreview(pending.rows), match),
          warnings: [], sheetCounts: restoredSheetCounts(pending.rows), fileName: pending.task.sourceFilename,
          inputCount: pending.task.inputCount });
      }
    };
  }, commit, o.preservePreviews?.attendance);
  const lottery = useLazyAdminQuery(o.activityId + ":LOTTERY", enabled("抽奖规则", "LOTTERY"), async signal => {
    const rules = await loadLotteryRules(id, signal);
    const rule = rules.find(item => item.status === "PUBLISHED") ?? rules[0];
    return () => o.onLotteryChange(rule ? mapLotteryRule(rule) : initialLotteryRounds.map(item => ({ ...item })));
  }, commit, o.preservePreviews?.lottery);
  const logs = useLazyAdminQuery(o.activityId + ":LOGS", o.logsOpen && isManager(identity), async signal => {
    const entries = await loadAuditLogs(id, signal);
    return () => o.setOperationLogs(entries.map(entry => ({ id: String(entry.id), action: entry.actionCode,
      target: `${entry.objectType}${entry.objectId ? ` #${entry.objectId}` : ""}`,
      detail: entry.result === "SUCCESS" ? `操作成功 · 追踪号 ${entry.traceId}` : `操作失败：${entry.errorCode || "未知错误"}`,
      operator: entry.actorName || (entry.actorType === "H5_CUSTOMER" ? "H5 客户" : "系统"), time: formatBeijingTime(entry.occurredAt) })));
  }, commit);
  return { product, whitelist, attendance, lottery, logs };
}
