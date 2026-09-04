"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError, getPreferredAdminActivityCode, setPreferredAdminActivityCode,
  type RuntimeActivity, type DashboardData, type ImportTask, type ImportStagingRow, type AttendanceMatchPreview,
  createAdminAttendee, createAdminCustomer, createAdminProduct, createActivity, loadActivity, loadAdminActivities,
  confirmImport, deleteAdminAttendee, deleteImportRows, loadAdminAttendees, loadAdminCustomers, loadAdminProducts,
  loadProductImageReviews, loadAuditLogs, loadDashboard, loadImportRows, loadAttendanceMatchPreview, loadImportTask,
  loadImportTasks, loadLotteryRules, publishActivity, withdrawActivityPublication, closeActivityNow, finishActivityNow,
  updateActivity, updateAdminAttendee, updateAdminCustomer, updateAdminProduct, addAdminProductImage,
  updateAdminProductImage, deleteAdminProductImage, selectProductImageReview, excludeProductImageReview,
  updateImportRow, uploadImport, cancelImport, waitForImport, deleteAdminCustomer, deleteAdminProduct,
  loadAdminDepartments, type AdminDepartment,
} from "../../api";
import { OrderManagement } from "../../components/orders/OrderManagement";
import {
  bindAttendanceStaging, bindProductStaging, bindWhitelistStaging, cloneProductRows, cloneWhitelistRows,
  createImportRowId, productMaterialNameKey,
  parseAttendanceWorkbook, prepareWhitelistImportRows, summarizeWhitelistRows, summarizeProductImportRows,
  whitelistCustomerTypeCode, whitelistCustomerTypeMode, whitelistIdentityKey, type AttendanceImportDraft, type AttendanceRow,
  type ProductImageAsset, type ProductImageStats, type ProductImportRow, type WhitelistRow,
} from "../../domain/import-domain";
import {
  matchProductImages, buildProductImageDecisions, parseProductImageZip, productImageRelationStatus,
  productImageStatusForAssets, revokeProductImageAssets, synchronizeProductImageAssetStatuses,
} from "../../domain/product-images";
import { LotterySettings, mapLotteryRule, type LotteryRound } from "../lottery/Lottery";
import type { ActivityStatus } from "../shared/types";
import { money, nextMinuteDateTimeLocal, runtimeActivityStatus, toDateTimeLocal } from "../shared/utils";
import {
  mergeProductImageReviews, parseProductWorkbook, parseWhitelistWorkbook,
  restoreAttendancePreview, restoreProductPreview, restoredSheetCounts, restoreWhitelistPreview, runtimeProductToImportRow,
} from "./admin-utils";
import {
  AttendanceFormDrawer, AttendancePage, cloneAttendanceRows, CustomerWhitelistTable, mapAdminAttendanceRows,
  mergeAttendanceMatchPreview, ProductFormDrawer, ProductImageUploadCard, ProductImportTable, WhitelistFormDrawer,
} from "./AdminComponents";
import { ActivityEntryLinksCard } from "./ActivityEntryLinksCard";
import { useAdminIdentity, useAdminSession } from "../../admin-context";
import { DepartmentAdminPanel } from "./DepartmentAdminPanel";

type ProductRowsSetter = (value: ProductImportRow[] | ((current: ProductImportRow[]) => ProductImportRow[])) => void;
type WhitelistRowsSetter = (value: WhitelistRow[] | ((current: WhitelistRow[]) => WhitelistRow[])) => void;
type AttendanceRowsSetter = (value: AttendanceRow[] | ((current: AttendanceRow[]) => AttendanceRow[])) => void;
type OperationLogEntry = { id: string; action: string; target: string; detail: string; operator: string; time: string };

export function AdminPrototype({ lotteryRounds, onLotteryChange, activityCode, activityName, onActivityNameChange, activityId, activityStatus, onActivityStatusChange, activityStartAt, onActivityStartAtChange, activityEndAt, onActivityEndAtChange, activityEventEndAt, onActivityEventEndAtChange, productRows, onProductRowsChange, productImportCompleted, onProductImportCompleted, onProductImportCommitted, productImportHasRun, whitelistRows, onWhitelistRowsChange, whitelistImportCompleted, onWhitelistImportCompleted, onWhitelistImportCommitted, whitelistImportHasRun, attendanceRows, onAttendanceRowsChange, attendanceFileName, onAttendanceFileNameChange, attendanceWarnings, onAttendanceWarningsChange, attendanceSheetCounts, onAttendanceSheetCountsChange, attendanceImportError, onAttendanceImportErrorChange }: { lotteryRounds: LotteryRound[]; onLotteryChange: (rounds: LotteryRound[]) => void; activityCode: string; activityName: string; onActivityNameChange: (value: string) => void; activityId: string; activityStatus: ActivityStatus; onActivityStatusChange: (status: ActivityStatus) => void; activityStartAt: string; onActivityStartAtChange: (value: string) => void; activityEndAt: string; onActivityEndAtChange: (value: string) => void; activityEventEndAt: string; onActivityEventEndAtChange: (value: string) => void; productRows: ProductImportRow[]; onProductRowsChange: ProductRowsSetter; productImportCompleted: boolean; onProductImportCompleted: (completed: boolean) => void; onProductImportCommitted: () => void; productImportHasRun: boolean; whitelistRows: WhitelistRow[]; onWhitelistRowsChange: WhitelistRowsSetter; whitelistImportCompleted: boolean; onWhitelistImportCompleted: (completed: boolean) => void; onWhitelistImportCommitted: () => void; whitelistImportHasRun: boolean; attendanceRows: AttendanceRow[]; onAttendanceRowsChange: AttendanceRowsSetter; attendanceFileName: string; onAttendanceFileNameChange: (value: string) => void; attendanceWarnings: string[]; onAttendanceWarningsChange: (value: string[]) => void; attendanceSheetCounts: Array<{ name: string; count: number }>; onAttendanceSheetCountsChange: (value: Array<{ name: string; count: number }>) => void; attendanceImportError: string; onAttendanceImportErrorChange: (value: string) => void }) {
  const adminIdentity = useAdminIdentity();
  const adminSession = useAdminSession();
  const activityStarted = activityStatus === "running" || activityStatus === "closed" || activityStatus === "finished";
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityFinished = activityStatus === "finished";
  const activityPublished = activityStatus !== "draft";
  const baseDataReadOnly = activityStatus === "scheduled" || activityClosed;
  const [tab, setTab] = useState("活动概览");
  const [activities, setActivities] = useState<RuntimeActivity[]>([]);
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [activityDepartmentFilter, setActivityDepartmentFilter] = useState("");
  const [activityMenuOpen, setActivityMenuOpen] = useState(false);
  const [newActivityOpen, setNewActivityOpen] = useState(false);
  const [creatingActivity, setCreatingActivity] = useState(false);
  const [newActivity, setNewActivity] = useState<{ name: string; startsAt: string; endsAt: string; eventEndsAt: string; departmentId: string }>(
    { name: "", startsAt: nextMinuteDateTimeLocal(), endsAt: "", eventEndsAt: "", departmentId: "" },
  );
  const setProductRows = onProductRowsChange;
  const setWhitelistRows = onWhitelistRowsChange;
  const setProductImportCompleted = onProductImportCompleted;
  const setWhitelistImportCompleted = onWhitelistImportCompleted;
  const [editingProductRow, setEditingProductRow] = useState<ProductImportRow | null>(null);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [editingWhitelistRow, setEditingWhitelistRow] = useState<WhitelistRow | null>(null);
  const [whitelistFormOpen, setWhitelistFormOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [operationLogs, setOperationLogs] = useState<OperationLogEntry[]>([]);
  const [operationLogOpen, setOperationLogOpen] = useState(false);
  const [activityStartDraft, setActivityStartDraft] = useState(activityStartAt);
  const [activityEndDraft, setActivityEndDraft] = useState(activityEndAt);
  const [activityEventEndDraft, setActivityEventEndDraft] = useState(activityEventEndAt);
  const [activityNameDraft, setActivityNameDraft] = useState(activityName);
  const [minimumFutureAt, setMinimumFutureAt] = useState(nextMinuteDateTimeLocal);
  const [productFileName, setProductFileName] = useState("");
  const [productImportWarnings, setProductImportWarnings] = useState<string[]>([]);
  const [productImportError, setProductImportError] = useState("");
  const [productSheetCounts, setProductSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [productImportInputCount, setProductImportInputCount] = useState(0);
  const productImportStats = useMemo(() => summarizeProductImportRows(productRows), [productRows]);
  const [pendingProductRollbackRows, setPendingProductRollbackRows] = useState<ProductImportRow[] | null>(null);
  const [productImageAssets, setProductImageAssets] = useState<ProductImageAsset[]>([]);
  const [productImageFileName, setProductImageFileName] = useState("");
  const [productImageUploadFile, setProductImageUploadFile] = useState<File | null>(null);
  const productImageStats = useMemo<ProductImageStats>(() => ({
    totalProducts: productRows.length,
    matchedProducts: productRows.filter((row) => row.imageStatus === "已匹配").length,
    pendingProducts: productRows.filter((row) => row.imageStatus === "待确认").length,
    unmatchedProducts: productRows.filter((row) => row.imageStatus !== "已匹配" && row.imageStatus !== "待确认").length,
  }), [productRows]);
  const resolvedProductImageAssets = useMemo(
    () => synchronizeProductImageAssetStatuses(productImageAssets, productRows),
    [productImageAssets, productRows],
  );
  const [productImageError, setProductImageError] = useState("");
  const [whitelistFileName, setWhitelistFileName] = useState("");
  const [whitelistImportWarnings, setWhitelistImportWarnings] = useState<string[]>([]);
  const [whitelistImportError, setWhitelistImportError] = useState("");
  const [whitelistSheetCounts, setWhitelistSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [whitelistImportInputCount, setWhitelistImportInputCount] = useState(0);
  const whitelistImportStats = useMemo(() => summarizeWhitelistRows(whitelistRows), [whitelistRows]);
  const whitelistMode = useMemo(() => whitelistCustomerTypeMode(whitelistRows), [whitelistRows]);
  const [pendingWhitelistRollbackRows, setPendingWhitelistRollbackRows] = useState<WhitelistRow[] | null>(null);
  const setAttendanceRows = onAttendanceRowsChange;
  const [attendanceFormOpen, setAttendanceFormOpen] = useState(false);
  const [editingAttendanceRow, setEditingAttendanceRow] = useState<AttendanceRow | null>(null);
  const [pendingAttendanceImport, setPendingAttendanceImport] = useState<AttendanceImportDraft | null>(null);
  const [attendanceMatchPreview, setAttendanceMatchPreview] = useState<AttendanceMatchPreview | null>(null);
  const [attendancePreviewLoading, setAttendancePreviewLoading] = useState(false);
  const [attendancePublishing, setAttendancePublishing] = useState(false);
  const [attendanceImportAttemptName, setAttendanceImportAttemptName] = useState("");
  const [serverImportTasks, setServerImportTasks] = useState<Partial<Record<"PRODUCT" | "WHITELIST" | "ATTENDANCE", number>>>({});
  const [serverImportBlocking, setServerImportBlocking] = useState<Partial<Record<"PRODUCT" | "WHITELIST" | "ATTENDANCE", number>>>({});
  const [regionCodesByName, setRegionCodesByName] = useState<Record<string, string>>({});
  const [overviewDashboard, setOverviewDashboard] = useState<DashboardData | null>(null);
  const [overviewByType, setOverviewByType] = useState<{ GENERAL: DashboardData | null; SPECIAL: DashboardData | null }>({ GENERAL: null, SPECIAL: null });
  const nav = ["活动概览", "商品导入", "白名单", "现场到场", "订单管理", "抽奖规则", ...(adminIdentity?.roleCode === "SUPER_ADMIN" ? ["部门与账号"] : [])];
  const currentActivity = activities.find((item) => item.code === activityCode);
  const visibleActivities = useMemo(
    () => activityDepartmentFilter ? activities.filter((item) => String(item.departmentId) === activityDepartmentFilter) : activities,
    [activities, activityDepartmentFilter],
  );
  const parsedProductCount = productFileName ? productImportInputCount : 0;
  const parsedWhitelistCount = whitelistFileName ? whitelistImportInputCount : 0;
  const removedProductCount = Math.max(0, parsedProductCount - productImportStats.total);
  const removedWhitelistCount = Math.max(0, parsedWhitelistCount - whitelistImportStats.total);
  useEffect(() => {
    void loadAdminActivities().then((items) => {
      setActivities(items);
      const savedCode = getPreferredAdminActivityCode();
      const savedActivity = savedCode ? items.find((item) => item.code === savedCode) : undefined;
      if (!savedActivity && items.length > 0) {
        const preferred = items.find((item) => runtimeActivityStatus(item.status) === "running")
          ?? items.find((item) => runtimeActivityStatus(item.status) === "scheduled")
          ?? items[0];
        setPreferredAdminActivityCode(preferred.code);
        if (preferred.code !== activityCode) window.location.replace("/admin");
      } else if (savedActivity && savedActivity.code !== activityCode) {
        window.location.replace("/admin");
      }
    }).catch(() => setActivities([]));
  }, [activityCode, activityId]);
  useEffect(() => {
    if (adminIdentity?.roleCode !== "SUPER_ADMIN") {
      return;
    }
    let active = true;
    void loadAdminDepartments().then((items) => { if (active) setDepartments(items); }).catch(() => { if (active) setDepartments([]); });
    return () => { active = false; };
  }, [adminIdentity?.roleCode]);
  useEffect(() => {
    const refreshMinimum = () => setMinimumFutureAt(nextMinuteDateTimeLocal());
    const timer = window.setInterval(refreshMinimum, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const openNewActivity = () => {
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    startsAt.setSeconds(0, 0);
    const endsAt = new Date(startsAt.getTime() + 2 * 24 * 60 * 60 * 1000);
    const eventEndsAt = new Date(endsAt.getTime() + 4 * 60 * 60 * 1000);
    const currentDepartmentId = activities.find((item) => item.code === activityCode)?.departmentId
      ?? departments.find((item) => item.code === "DEFAULT")?.id;
    setNewActivity({ name: "", startsAt: toDateTimeLocal(startsAt.toISOString()), endsAt: toDateTimeLocal(endsAt.toISOString()), eventEndsAt: toDateTimeLocal(eventEndsAt.toISOString()), departmentId: currentDepartmentId == null ? "" : String(currentDepartmentId) });
    setActivityMenuOpen(false);
    setNewActivityOpen(true);
  };

  const submitNewActivity = async () => {
    if (!newActivity.name.trim() || !newActivity.startsAt || !newActivity.endsAt || !newActivity.eventEndsAt) {
      setActionNotice("请完整填写活动名称、订货时间和整场活动结束时间。");
      return;
    }
    if (adminIdentity?.roleCode === "SUPER_ADMIN" && !newActivity.departmentId) {
      setActionNotice("超级管理员创建活动时必须选择所属部门。");
      return;
    }
    if (new Date(newActivity.startsAt) >= new Date(newActivity.endsAt)) {
      setActionNotice("订货截止时间必须晚于开始时间。");
      return;
    }
    if (new Date(newActivity.eventEndsAt) < new Date(newActivity.endsAt)) {
      setActionNotice("整场活动结束时间不能早于订货截止时间。");
      return;
    }
    setCreatingActivity(true);
    try {
      const created = await createActivity({
        name: newActivity.name,
        startsAt: newActivity.startsAt,
        endsAt: newActivity.endsAt,
        eventEndsAt: newActivity.eventEndsAt,
        ...(adminIdentity?.roleCode === "SUPER_ADMIN" ? { departmentId: Number(newActivity.departmentId) } : {}),
      });
      setPreferredAdminActivityCode(created.code);
      window.location.assign("/admin");
    } catch (error) {
      setActionNotice(error instanceof ApiError ? error.message : "新建活动失败，请稍后重试。");
      setCreatingActivity(false);
    }
  };
  useEffect(() => {
    let active = true;
    const refreshOverview = async () => {
      try {
        const [all, general, special] = await Promise.all([
          loadDashboard(), loadDashboard({ customerType: "GENERAL" }), loadDashboard({ customerType: "SPECIAL" }),
        ]);
        if (active) {
          setOverviewDashboard(all);
          setOverviewByType({ GENERAL: general, SPECIAL: special });
        }
      } catch {
        // 其它后台数据仍可正常维护；概览保留最近一次成功结果。
      }
    };
    void refreshOverview();
    const timer = window.setInterval(refreshOverview, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activityId]);
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
    onWhitelistImportCommitted, onWhitelistImportCompleted, setAttendanceRows, setProductRows, setWhitelistRows]);
  const recordOperation = (action: string, target: string, detail: string) => {
    setOperationLogs((current) => [{ id: createImportRowId("operation"), action, target, detail, operator: adminIdentity?.displayName || adminIdentity?.username || "运营管理员", time: new Date().toLocaleString("zh-CN", { hour12: false }) }, ...current]);
  };
  const applyActivity = (activity: RuntimeActivity) => {
    const nextStatus = runtimeActivityStatus(activity.status);
    onActivityStatusChange(nextStatus);
    onActivityNameChange(activity.name);
    onActivityStartAtChange(toDateTimeLocal(activity.startsAt));
    onActivityEndAtChange(toDateTimeLocal(activity.endsAt));
    onActivityEventEndAtChange(toDateTimeLocal(activity.eventEndsAt || new Date(new Date(activity.endsAt).getTime() + 4 * 60 * 60 * 1000).toISOString()));
    setActivityNameDraft(activity.name);
    setActivityStartDraft(toDateTimeLocal(activity.startsAt));
    setActivityEndDraft(toDateTimeLocal(activity.endsAt));
    setActivityEventEndDraft(toDateTimeLocal(activity.eventEndsAt || new Date(new Date(activity.endsAt).getTime() + 4 * 60 * 60 * 1000).toISOString()));
  };
  const saveActivityConfig = async (): Promise<boolean> => {
    if (!activityNameDraft.trim()) {
      setActionNotice("请填写活动名称。" );
      return false;
    }
    if (!activityStartDraft || !activityEndDraft || !activityEventEndDraft) {
      setActionNotice("请填写订货开始、订货截止和整场活动结束时间。" );
      return false;
    }
    const startTime = new Date(activityStartDraft).getTime();
    const endTime = new Date(activityEndDraft).getTime();
    const eventEndTime = new Date(activityEventEndDraft).getTime();
    if (startTime >= endTime) {
      setActionNotice("活动开始时间必须早于截止时间。" );
      return false;
    }
    if (eventEndTime < endTime) {
      setActionNotice("整场活动结束时间不能早于订货截止时间。" );
      return false;
    }
    if ((activityStatus === "draft" || activityStatus === "scheduled") && startTime <= Date.now()) {
      setActionNotice("订货开始时间必须晚于当前时间，请重新选择。" );
      return false;
    }
    if (activityStatus === "running" && startTime !== new Date(activityStartAt).getTime()) {
      setActionNotice("活动进行中，订货开始时间不能修改。" );
      return false;
    }
    if (activityStatus === "running" && endTime < new Date(activityEndAt).getTime()) {
      setActionNotice("活动进行中只能延长截止时间；如需停止，请使用“立即截止订货”。" );
      return false;
    }
    if (Number.isFinite(Number(activityId))) {
      try {
        const updated = await updateActivity(await loadActivity(), { name: activityNameDraft.trim(), startsAt: activityStartDraft, endsAt: activityEndDraft, eventEndsAt: activityEventEndDraft });
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
    if (!productImportCompleted || !whitelistImportCompleted) {
      setActionNotice("发布活动前必须完成商品和白名单导入。" );
      return;
    }
    if (!window.confirm(`发布后活动将于 ${activityStartDraft.replace("T", " ")} 自动开始，商品和白名单将锁定。确定发布吗？`)) return;
    if (!await saveActivityConfig()) return;
    try {
      if (Number.isFinite(Number(activityId))) applyActivity(await publishActivity(await loadActivity()));
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
      if (Number.isFinite(Number(activityId))) applyActivity(await withdrawActivityPublication(await loadActivity()));
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
      if (Number.isFinite(Number(activityId))) applyActivity(await closeActivityNow(await loadActivity(), reason));
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
      if (Number.isFinite(Number(activityId))) applyActivity(await finishActivityNow(await loadActivity(), reason));
      else onActivityStatusChange("finished");
      recordOperation("结束整场活动", activityId, `原因：${reason}`);
      setActionNotice("整场活动已结束；抽奖已关闭，看板和战报可只读回看。" );
    } catch (error) {
      setActionNotice(error instanceof ApiError ? error.message : "结束整场活动失败，请稍后重试。" );
    }
  };
  const beginProductImport = () => {
    if (activityPublished) {
      setActionNotice("活动发布后商品 Excel 已锁定，请先撤回发布。");
      return;
    }
    setProductImportCompleted(false);
    setProductFileName("");
    setProductSheetCounts([]);
    setProductImportWarnings([]);
    setProductImportError("");
    setProductImportInputCount(0);
    setPendingProductRollbackRows(null);
    revokeProductImageAssets(productImageAssets);
    setProductImageAssets([]);
    setProductImageFileName("");
    setProductImageUploadFile(null);
  };
  const cancelProductImport = async () => {
    const taskId = serverImportTasks.PRODUCT;
    if (taskId && Number.isFinite(Number(activityId))) {
      try {
        await cancelImport(Number(activityId), taskId);
      } catch (error) {
        setActionNotice(error instanceof ApiError ? error.message : "取消商品导入失败，请稍后重试。");
        return;
      }
      setServerImportTasks((current) => ({ ...current, PRODUCT: undefined }));
      setServerImportBlocking((current) => ({ ...current, PRODUCT: 0 }));
    }
    const hadConfirmedImport = productImportHasRun;
    if (pendingProductRollbackRows) setProductRows(cloneProductRows(pendingProductRollbackRows));
    setPendingProductRollbackRows(null);
    revokeProductImageAssets(productImageAssets);
    setProductImageAssets([]);
    setProductImageFileName("");
    setProductImageUploadFile(null);
    setProductFileName("");
    setProductSheetCounts([]);
    setProductImportWarnings([]);
    setProductImportError("");
    setProductImportInputCount(0);
    setProductImportCompleted(hadConfirmedImport);
    setActionNotice("已取消本次商品替换，当前商品目录保持不变。" );
  };
  const confirmProductImport = async () => {
    if (activityPublished) {
      setActionNotice("活动发布后禁止确认商品 Excel 导入，请先撤回发布。");
      return;
    }
    if ((serverImportBlocking.PRODUCT ?? 0) > 0) {
      setActionNotice(`仍有 ${serverImportBlocking.PRODUCT} 条商品异常，请先编辑或删除后再发布。`);
      return;
    }
    const imageWarningCount = productImageStats.pendingProducts + productImageStats.unmatchedProducts;
    if (imageWarningCount > 0 && !window.confirm(`本批次有 ${productImageStats.pendingProducts} 个商品图片待确认、${productImageStats.unmatchedProducts} 个商品图片未匹配。发布后这些商品将使用默认图片，是否继续？`)) return;
    const taskId = serverImportTasks.PRODUCT;
    let publishedRows: ProductImportRow[] | null = null;
    if (taskId) {
      try {
        await confirmImport(Number(activityId), taskId, productImageUploadFile ?? undefined,
          buildProductImageDecisions(productRows, resolvedProductImageAssets));
        await waitForImport(Number(activityId), taskId);
        const [products, imageReviews] = await Promise.all([
          loadAdminProducts(Number(activityId)), loadProductImageReviews(Number(activityId)),
        ]);
        publishedRows = mergeProductImageReviews(products.map(runtimeProductToImportRow), imageReviews);
      } catch (error) {
        setActionNotice(error instanceof ApiError ? error.message : "商品导入发布失败，请检查后重试。");
        return;
      }
    }
    const cleanRows = publishedRows ?? productRows;
    setProductRows(cleanRows);
    setPendingProductRollbackRows(null);
    setProductImportCompleted(true);
    onProductImportCommitted();
    recordOperation("替换商品 Excel", productFileName || "商品信息 Excel", `共 ${productImportStats.total} 条；有效 ${productImportStats.valid} 条，待完善 ${productImportStats.incomplete} 条。`);
    setActionNotice(`商品目录已替换：共 ${productImportStats.total} 条，有效 ${productImportStats.valid} 条、待完善 ${productImportStats.incomplete} 条${productImageUploadFile ? "，本批次图片已同步" : "，未匹配商品使用默认图片"}。`);
  };
  const handleProductFile = async (file: File) => {
    if (activityPublished) {
      setProductImportError("活动发布后商品 Excel 已锁定，请先撤回发布。");
      setActionNotice("活动发布后商品 Excel 已锁定，请先撤回发布。");
      return;
    }
    setProductImportError("");
    try {
      const result = await parseProductWorkbook(file);
      let serverRows: ImportStagingRow[] = [];
      if (Number.isFinite(Number(activityId))) {
        const task = await uploadImport(Number(activityId), "PRODUCT", file);
        setServerImportTasks((current) => ({ ...current, PRODUCT: Number(task.id) }));
        setServerImportBlocking((current) => ({ ...current, PRODUCT: Number(task.errorCount || 0) }));
        serverRows = await loadImportRows(Number(activityId), Number(task.id));
      }
      revokeProductImageAssets(productImageAssets);
      const imageResult = matchProductImages(result.rows, []);
      const nextRows = bindProductStaging(imageResult.rows, serverRows);
      setProductImageAssets([]);
      setProductImageFileName("");
      setProductImageUploadFile(null);
      setPendingProductRollbackRows(pendingProductRollbackRows ? pendingProductRollbackRows : cloneProductRows(productRows));
      setProductRows(nextRows);
      setProductFileName(file.name);
      setProductSheetCounts(result.sheetCounts);
      setProductImportInputCount(result.rows.length);
      setProductImportWarnings(result.warnings);
      setProductImportCompleted(false);
      const stats = summarizeProductImportRows(nextRows);
      setActionNotice(`已解析 ${stats.total} 条商品：有效 ${stats.valid} 条、待完善 ${stats.incomplete} 条、待核对 ${stats.review} 条，请检查后确认替换。`);
    } catch (error) {
      setProductFileName(file.name);
      setProductSheetCounts([]);
      setProductImportInputCount(0);
      setProductImportWarnings([]);
      setProductImportError(error instanceof Error ? error.message : "文件解析失败，请检查 Excel 格式。");
      setProductImportCompleted(false);
    }
  };
  const handleProductImageFile = async (file: File) => {
    if (activityPublished) {
      setProductImageError("活动发布后禁止批量导入商品图片，请先撤回发布。");
      setActionNotice("活动发布后禁止批量导入商品图片，请先撤回发布。");
      return;
    }
    setProductImageError("");
    try {
      const assets = await parseProductImageZip(file);
      const imageResult = matchProductImages(productRows, assets);
      revokeProductImageAssets(productImageAssets);
      setProductImageAssets(imageResult.assets);
      setProductImageFileName(file.name);
      setProductImageUploadFile(file);
      setProductRows(imageResult.rows);
      setActionNotice(`已读取 ${assets.length} 张图片：已匹配 ${imageResult.stats.matchedProducts} 个商品、待确认 ${imageResult.stats.pendingProducts} 个商品、未匹配 ${imageResult.stats.unmatchedProducts} 个商品。`);
    } catch (error) {
      setProductImageError(error instanceof Error ? error.message : "图片 ZIP 解析失败，请检查文件。");
    }
  };
  const removeProductImages = () => {
    if (activityPublished) {
      setActionNotice("活动发布后禁止批量移除商品图片，请先撤回发布。");
      return;
    }
    revokeProductImageAssets(productImageAssets);
    setProductImageAssets([]);
    setProductImageFileName("");
    setProductImageUploadFile(null);
    setProductImageError("");
    setProductRows((current) => current.map((row) => ({ ...row, images: undefined, imageStatus: "未匹配" })));
    setActionNotice("已移除本批次 ZIP，全部商品恢复为未匹配；当前已发布目录不受影响。");
  };
  const refreshServerImportPreview = async (type: "PRODUCT" | "WHITELIST" | "ATTENDANCE") => {
    const taskId = serverImportTasks[type];
    if (!taskId || !Number.isFinite(Number(activityId))) return;
    if (type === "ATTENDANCE") setAttendancePreviewLoading(true);
    try {
      const [task, staging, attendancePreview] = await Promise.all([
        loadImportTask(Number(activityId), taskId), loadImportRows(Number(activityId), taskId),
        type === "ATTENDANCE" ? loadAttendanceMatchPreview(Number(activityId), taskId) : Promise.resolve(null),
      ]);
      setServerImportBlocking((current) => ({ ...current, [type]: task.errorCount }));
      if (type === "PRODUCT") {
        setProductRows((current) => bindProductStaging(current, staging));
      } else if (type === "WHITELIST") {
        setWhitelistRows((current) => bindWhitelistStaging(current, staging));
      } else {
        if (attendancePreview) setAttendanceMatchPreview(attendancePreview);
        setPendingAttendanceImport((current) => current ? { ...current,
          rows: attendancePreview
            ? mergeAttendanceMatchPreview(bindAttendanceStaging(current.rows, staging), attendancePreview)
            : bindAttendanceStaging(current.rows, staging) } : current);
      }
    } finally {
      if (type === "ATTENDANCE") setAttendancePreviewLoading(false);
    }
  };
  const openProductForm = () => {
    if (baseDataReadOnly) {
      setActionNotice(activityClosed ? "活动已截止，商品数据只读。" : "活动已发布，修改商品请先撤回发布。" );
      return;
    }
    if (!productImportCompleted && (!productFileName || productImportError)) {
      setActionNotice("请先完成一次商品 Excel 解析，再手动添加商品。" );
      return;
    }
    setEditingProductRow(null);
    setProductFormOpen(true);
  };
  const saveProductRow = async (row: ProductImportRow, reason = "") => {
    if (activityClosed) {
      setActionNotice("活动已截止，商品数据只读。" );
      return false;
    }
    const nextRow = { ...row, imageStatus: productImageStatusForAssets(row.images) };
    const numeric = (value: string) => value.trim() === "" ? null : Number(value);
    const productBody = {
      customerType: nextRow.customerType === "综合" ? "GENERAL" : nextRow.customerType === "特渠" ? "SPECIAL" : "ALL",
      rebateStatus: nextRow.rebate === "参与" ? "PARTICIPATING" : nextRow.rebate === "不参与" ? "NOT_PARTICIPATING" : "ALL",
      categoryName: nextRow.category, productLine: nextRow.line, materialCode: nextRow.materialCode,
      materialName: nextRow.materialName, description: nextRow.description ?? "", brandName: nextRow.brand, varietyName: nextRow.variety,
      specification: nextRow.spec, casePack: nextRow.casePack, bottlePrice: numeric(nextRow.unitPrice),
      casePrice: numeric(nextRow.casePrice), tonCaseFactor: numeric(nextRow.conversion), giftBox: nextRow.gift === "是",
      priceTierMinQuantity: numeric(nextRow.priceTierMinQuantity), priceTierCasePrice: numeric(nextRow.priceTierCasePrice),
      priceTierPricingMode: nextRow.priceTierPricingMode,
      visible: true, orderable: Number(nextRow.casePrice) > 0, branchScope: nextRow.branchScope, reason,
    };
    if (editingProductRow) {
      if (!productImportCompleted && editingProductRow.serverRowId && serverImportTasks.PRODUCT) {
        try {
          await updateImportRow(Number(activityId), serverImportTasks.PRODUCT, editingProductRow.serverRowId, {
            customerType: nextRow.customerType === "综合" ? "GENERAL" : nextRow.customerType === "特渠" ? "SPECIAL" : "ALL",
            rebateStatus: nextRow.rebate === "参与" ? "PARTICIPATING" : nextRow.rebate === "不参与" ? "NOT_PARTICIPATING" : "ALL",
            customerTypeInvalid: false, rebateStatusInvalid: false,
            categoryName: nextRow.category, productLine: nextRow.line, materialCode: nextRow.materialCode,
            materialName: nextRow.materialName, description: nextRow.description ?? "", brandName: nextRow.brand, varietyName: nextRow.variety,
            specification: nextRow.spec, casePack: nextRow.casePack, bottlePrice: nextRow.unitPrice,
            casePrice: nextRow.casePrice, tonCaseFactor: nextRow.conversion, giftBox: nextRow.gift === "是",
            priceTierMinQuantity: nextRow.priceTierMinQuantity, priceTierCasePrice: nextRow.priceTierCasePrice,
            priceTierPricingMode: nextRow.priceTierPricingMode,
            branchScope: nextRow.branchScope,
          });
        } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品预览修改失败"); return false; }
      }
      let savedRow: ProductImportRow = { ...nextRow, manuallyEdited: true };
      let refreshedCatalogRows: ProductImportRow[] | null = null;
      if (productImportCompleted && editingProductRow.serverVersion !== undefined) {
        try {
          const productId = Number(editingProductRow.id);
          const saved = await updateAdminProduct(Number(activityId), Number(editingProductRow.id), editingProductRow.serverVersion, {
            ...productBody, bottlePriceSet: true, casePriceSet: true, tonCaseFactorSet: true, priceTierSet: true,
          });
          savedRow = { ...savedRow, id: String(saved.id), serverVersion: saved.version,
            status: saved.dataStatus === "INCOMPLETE" ? "待完善" : "有效" };
          const desiredImages = savedRow.images ?? [];
          const selectedReview = desiredImages.find((image) => image.reviewCandidateId
            && productImageRelationStatus(image) === "CONFIRMED");
          const originalReviewIds = (editingProductRow.images ?? []).map((image) => image.reviewCandidateId)
            .filter((id): id is number => id !== undefined);
          if (selectedReview?.reviewCandidateId) {
            await selectProductImageReview(Number(activityId), selectedReview.reviewCandidateId);
          } else {
            const retainedReviewIds = new Set(desiredImages.map((image) => image.reviewCandidateId).filter((id): id is number => id !== undefined));
            for (const candidateId of originalReviewIds.filter((id) => !retainedReviewIds.has(id))) {
              await excludeProductImageReview(Number(activityId), candidateId);
            }
          }
          const desiredPersistedIds = new Set(desiredImages.map((image) => Number(image.id)).filter(Number.isSafeInteger));
          const originalPersistedIds = (editingProductRow.images ?? []).map((image) => Number(image.id)).filter(Number.isSafeInteger);
          for (const imageId of originalPersistedIds.filter((imageId) => !desiredPersistedIds.has(imageId))) {
            await deleteAdminProductImage(Number(activityId), productId, imageId);
          }
          const uploadedIds = new Map<string, number>();
          for (const image of desiredImages.filter((item) => !Number.isSafeInteger(Number(item.id)) && item.file)) {
            const uploaded = await addAdminProductImage(Number(activityId), productId, image.file!, false);
            uploadedIds.set(image.id, uploaded.id);
          }
          const orderedImageIds = desiredImages.map((image) => Number.isSafeInteger(Number(image.id)) ? Number(image.id) : uploadedIds.get(image.id))
            .filter((imageId): imageId is number => imageId !== undefined);
          for (let index = 0; index < orderedImageIds.length; index += 1) {
            await updateAdminProductImage(Number(activityId), productId, orderedImageIds[index], index === 0, index);
          }
          const [refreshedProducts, refreshedReviews] = await Promise.all([
            loadAdminProducts(Number(activityId)), loadProductImageReviews(Number(activityId)),
          ]);
          refreshedCatalogRows = mergeProductImageReviews(refreshedProducts.map(runtimeProductToImportRow), refreshedReviews);
          const refreshed = refreshedProducts.find((product) => product.id === productId);
          if (refreshed) savedRow = { ...runtimeProductToImportRow(refreshed), manuallyEdited: true };
        } catch (error) { setActionNotice(error instanceof ApiError ? `商品或图片保存失败：${error.message}` : "商品或图片保存失败，请刷新后重试"); return false; }
      }
      const sharedName = !productImportCompleted
        && productMaterialNameKey(editingProductRow.materialName) === productMaterialNameKey(savedRow.materialName)
        ? productMaterialNameKey(savedRow.materialName) : "";
      const confirmedImageIds = new Set((savedRow.images ?? [])
        .filter((image) => productImageRelationStatus(image) === "CONFIRMED").map((image) => image.id));
      const applySavedPreviewImage = (item: ProductImportRow) => {
        if (item.id === nextRow.id) return savedRow;
        if (sharedName && productMaterialNameKey(item.materialName) === sharedName) {
          const images = savedRow.images?.map((image) => ({ ...image }));
          return { ...item, images, imageStatus: productImageStatusForAssets(images) };
        }
        if (productImportCompleted || confirmedImageIds.size === 0) return item;
        const images = item.images?.filter((image) => !confirmedImageIds.has(image.id));
        return { ...item, images: images?.length ? images : undefined, imageStatus: productImageStatusForAssets(images) };
      };
      if (refreshedCatalogRows) {
        setProductRows(refreshedCatalogRows);
      } else {
        setProductRows((current) => current.map(applySavedPreviewImage));
        const previewRowsAfterSave = productRows.map(applySavedPreviewImage);
        setProductImageAssets((current) => synchronizeProductImageAssetStatuses(current, previewRowsAfterSave));
        await refreshServerImportPreview("PRODUCT");
      }
      if (activityStarted) recordOperation("活动开始后改单条商品", nextRow.materialName, `修改前：物料代码 ${editingProductRow.materialCode || "—"}、名称 ${editingProductRow.materialName || "—"}、元/箱 ${editingProductRow.casePrice || "—"}、分公司 ${editingProductRow.branchScope || "全部"}、状态 ${editingProductRow.status}；修改后：物料代码 ${nextRow.materialCode || "—"}、名称 ${nextRow.materialName || "—"}、元/箱 ${nextRow.casePrice || "—"}、分公司 ${nextRow.branchScope || "全部"}、状态 ${nextRow.status}；原因：${reason || "—"}。`);
      setActionNotice(`${activityStarted ? "已记录并保存" : "已保存"}商品修改：${nextRow.materialName}`);
      return true;
    }
    if (!productImportCompleted && productFileName) {
      setActionNotice("导入预览阶段不能新增商品；请先发布本次 Excel，再使用单条新增。");
      return false;
    }
    let manualRow: ProductImportRow = { ...nextRow, source: "manual", manuallyEdited: true };
    if (productImportCompleted) {
      try {
        const saved = await createAdminProduct(Number(activityId), productBody);
        manualRow = { ...manualRow, id: String(saved.id), serverVersion: saved.version, sequence: saved.sortNo,
          status: saved.dataStatus === "INCOMPLETE" ? "待完善" : "有效" };
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品新增失败"); return false; }
    }
    setProductRows((current) => [...current, manualRow]);
    if (!productImportCompleted && productFileName) {
      setProductImportInputCount((current) => current + 1);
    }
    recordOperation(activityStarted ? "活动开始后手动新增商品" : "手动添加商品", manualRow.materialName, `物料代码：${manualRow.materialCode || "—"}；客户类型：${manualRow.customerType}；返利：${manualRow.rebate}；${activityStarted ? `原因：${reason || "—"}。` : ""}`);
    setActionNotice(`${activityStarted ? "已记录并添加" : "已添加"}商品：${manualRow.materialName}`);
    return true;
  };
  const beginWhitelistImport = () => {
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
  };
  const confirmWhitelistImport = async () => {
    if (activityPublished) {
      setActionNotice("活动发布后禁止确认白名单 Excel 导入，请先撤回发布。");
      return;
    }
    if ((serverImportBlocking.WHITELIST ?? 0) > 0) {
      setActionNotice(`仍有 ${serverImportBlocking.WHITELIST} 条白名单异常，请先编辑或删除后再发布。`);
      return;
    }
    const taskId = serverImportTasks.WHITELIST;
    if (taskId) {
      try { await confirmImport(Number(activityId), taskId); await waitForImport(Number(activityId), taskId); }
      catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单导入发布失败，请处理异常数据后重试。"); return; }
    }
    setPendingWhitelistRollbackRows(null);
    setWhitelistImportCompleted(true);
    onWhitelistImportCommitted();
    let refreshedAttendance = attendanceRows;
    if (taskId && attendanceRows.length > 0) {
      refreshedAttendance = mapAdminAttendanceRows(await loadAdminAttendees(Number(activityId)));
      setAttendanceRows(refreshedAttendance);
    }
    if (pendingAttendanceImport && serverImportTasks.ATTENDANCE) await refreshServerImportPreview("ATTENDANCE");
    const linkedAttendance = refreshedAttendance.filter((row) => row.lotteryEligible).length;
    recordOperation("替换白名单 Excel", whitelistFileName || "客户白名单 Excel", `共 ${whitelistImportStats.total} 名；有效 ${whitelistImportStats.valid} 名，待处理 ${whitelistImportStats.pending} 名。`);
    setActionNotice(`白名单已替换：共 ${whitelistImportStats.total} 名，有效 ${whitelistImportStats.valid} 名；当前到场已重新关联 ${linkedAttendance} 名。`);
  };
  const handleWhitelistFile = async (file: File) => {
    if (activityPublished) {
      setWhitelistImportError("活动发布后白名单 Excel 已锁定，请先撤回发布。");
      setActionNotice("活动发布后白名单 Excel 已锁定，请先撤回发布。");
      return;
    }
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
    }
  };
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
  const handleAttendanceFile = async (file: File) => {
    if (activityClosed) {
      onAttendanceImportErrorChange("活动已截止，现场到场名单只读。" );
      setActionNotice("活动已截止，现场到场名单只读。" );
      return;
    }
    setAttendanceImportAttemptName(file.name);
    onAttendanceImportErrorChange("");
    try {
      const result = await parseAttendanceWorkbook(file);
      let serverRows: ImportStagingRow[] = [];
      let matchPreview: AttendanceMatchPreview | null = null;
      if (Number.isFinite(Number(activityId))) {
        const task = await uploadImport(Number(activityId), "ATTENDANCE", file);
        setServerImportTasks((current) => ({ ...current, ATTENDANCE: Number(task.id) }));
        setServerImportBlocking((current) => ({ ...current, ATTENDANCE: Number(task.errorCount || 0) }));
        serverRows = await loadImportRows(Number(activityId), Number(task.id));
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
      onAttendanceImportErrorChange(error instanceof Error ? error.message : "文件解析失败，请检查 Excel 内容。" );
      setPendingAttendanceImport(null);
      setAttendanceMatchPreview(null);
    }
  };
  const cancelAttendanceImport = async () => {
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
    if (attendancePublishing) return;
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
        await waitForImport(Number(activityId), taskId);
      }
      const imported = pendingAttendanceImport;
      const publishedRows = taskId ? mapAdminAttendanceRows(await loadAdminAttendees(Number(activityId))) : cloneAttendanceRows(imported.rows);
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
      setActionNotice(`现场到场 Excel 导入完成：${publishedRows.length} 名，已关联 ${linkedCount} 名。`);
    } catch (error) {
      setActionNotice(error instanceof ApiError ? error.message : "现场到场名单发布失败，请处理异常数据后重试。");
    } finally {
      setAttendancePublishing(false);
    }
  };
  const saveWhitelistRow = async (row: WhitelistRow, reason = "") => {
    if (activityClosed) {
      setActionNotice("活动已截止，白名单数据只读。" );
      return false;
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
          setActionNotice("当前白名单预览记录未绑定后端 staging，请重新选择 Excel 后再编辑。");
          return false;
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
        } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单预览修改失败"); return false; }
      }
      let savedRow = { ...nextRow, manuallyEdited: true };
      if (whitelistImportCompleted) {
        if (editingWhitelistRow.serverVersion === undefined) {
          setActionNotice("当前白名单记录缺少后端版本信息，请刷新页面后重试。");
          return false;
        }
        try {
          const saved = await updateAdminCustomer(Number(activityId), Number(editingWhitelistRow.id), customerBody);
          savedRow = { ...savedRow, id: String(saved.id), serverVersion: saved.lockVersion, dealerPhone: saved.phone || saved.phoneMasked,
            confirmerPhone: saved.confirmerPhone || saved.confirmerPhoneMasked || nextRow.confirmerPhone, status: saved.active ? "有效" : "待处理" };
        } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单保存失败"); return false; }
      }
      setWhitelistRows((current) => current.map((item) => item.id === nextRow.id ? savedRow : item));
      if (!whitelistImportCompleted) {
        try { await refreshServerImportPreview("WHITELIST"); }
        catch (error) { setActionNotice(error instanceof ApiError ? `修改已写入 staging，但刷新预览失败：${error.message}` : "修改已写入 staging，但刷新预览失败，请重试。"); return false; }
      }
      if (activityStarted) recordOperation("活动开始后改单条白名单", nextRow.dealerShort || nextRow.dealerFull, `修改前：客户类型 ${editingWhitelistRow.customerType}、全称 ${editingWhitelistRow.dealerFull || "—"}、姓名 ${editingWhitelistRow.dealerName || "—"}、电话 ${editingWhitelistRow.dealerPhone || "—"}、分公司 ${editingWhitelistRow.branch || "—"}、状态 ${editingWhitelistRow.status}；修改后：客户类型 ${nextRow.customerType}、全称 ${nextRow.dealerFull || "—"}、姓名 ${nextRow.dealerName || "—"}、电话 ${nextRow.dealerPhone || "—"}、分公司 ${nextRow.branch || "—"}、状态 ${nextRow.status}；原因：${reason || "—"}。`);
      setActionNotice(`${activityStarted ? "已记录并保存" : "已保存"}白名单修改：${nextRow.dealerShort}`);
      return true;
    }
    if (!whitelistImportCompleted && whitelistFileName) {
      setActionNotice("导入预览阶段不能新增白名单客户；请先发布本次 Excel，再使用单条新增。");
      return false;
    }
    let manualRow: WhitelistRow = { ...nextRow, source: "manual", status: "有效", manuallyEdited: true };
    if (whitelistImportCompleted) {
      try {
        const saved = await createAdminCustomer(Number(activityId), customerBody);
        manualRow = { ...manualRow, id: String(saved.id), serverVersion: saved.lockVersion, sequence: saved.excelSequence ?? nextRow.sequence,
          dealerPhone: saved.phone || saved.phoneMasked, confirmerPhone: saved.confirmerPhone || saved.confirmerPhoneMasked || nextRow.confirmerPhone,
          status: saved.active ? "有效" : "待处理" };
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单新增失败"); return false; }
    }
    setWhitelistRows((current) => [...current, manualRow]);
    if (!whitelistImportCompleted && whitelistFileName) {
      setWhitelistImportInputCount((current) => current + 1);
    }
    recordOperation(activityStarted ? "活动开始后手动新增白名单客户" : "手动添加白名单客户", manualRow.dealerShort || manualRow.dealerFull, `客户类型：${manualRow.customerType}；电话：${manualRow.dealerPhone || "—"}；${activityStarted ? `原因：${reason || "—"}。` : ""}`);
    setActionNotice(`${activityStarted ? "已记录并添加" : "已添加"}白名单客户：${manualRow.dealerShort || manualRow.dealerFull}`);
    return true;
  };
  const saveAttendanceRow = async (row: AttendanceRow) => {
    if (activityClosed) {
      setActionNotice("活动已截止，现场到场名单只读。" );
      return false;
    }
    if (pendingAttendanceImport) {
      if (editingAttendanceRow) {
        const taskId = serverImportTasks.ATTENDANCE;
        if (!taskId || !editingAttendanceRow.serverRowId) {
          setActionNotice("当前到场预览记录未绑定后端 staging，请重新选择 Excel 后再编辑。");
          return false;
        }
        try {
          await updateImportRow(Number(activityId), taskId, editingAttendanceRow.serverRowId, {
            participantName: row.dealerName, gender: row.gender, contactPhone: row.contactPhone,
            branchName: row.branch, dealerFullName: row.dealerCompany, participantType: row.participantType,
          });
        } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "到场名单预览修改失败"); return false; }
        setPendingAttendanceImport((current) => current ? { ...current, rows: current.rows.map((item) => item.id === row.id ? row : item) } : current);
        try { await refreshServerImportPreview("ATTENDANCE"); }
        catch (error) { setActionNotice(error instanceof ApiError ? `修改已写入 staging，但关联试算刷新失败：${error.message}` : "修改已写入 staging，但关联试算刷新失败，请重试。"); return false; }
        setActionNotice(`已修改待导入到场客户：${row.dealerCompany || row.dealerName || "未命名客户"}，确认导入后生效。`);
        return true;
      } else {
        setActionNotice("导入预览阶段不能新增到场客户；请先发布本次 Excel，再使用单条新增。");
        return false;
      }
    }
    const attendeeBody = { participantName: row.dealerName, gender: row.gender, participantType: row.participantType,
      dealerName: row.dealerCompany, branchName: row.branch, phone: row.contactPhone };
    if (editingAttendanceRow) {
      let savedRow = row;
      try {
        const saved = await updateAdminAttendee(Number(activityId), Number(editingAttendanceRow.id), attendeeBody);
        savedRow = { ...mapAdminAttendanceRows([saved])[0], sequence: row.sequence, manuallyEdited: true };
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "到场客户保存失败"); return false; }
      setAttendanceRows((current) => current.map((item) => item.id === row.id ? savedRow : item));
      if (activityStarted) recordOperation("活动开始后改单条现场到场客户", row.dealerCompany || row.dealerName, `修改现场到场信息；原因由表单记录。`);
      else recordOperation("编辑现场到场客户", row.dealerCompany || row.dealerName, "修改当前现场到场名单信息。" );
      setActionNotice(`${activityStarted ? "已记录并保存" : "已保存"}到场客户修改：${row.dealerCompany || row.dealerName || "未命名客户"}`);
      return true;
    } else {
      let savedRow = row;
      try {
        const saved = await createAdminAttendee(Number(activityId), attendeeBody);
        savedRow = { ...mapAdminAttendanceRows([saved])[0], sequence: row.sequence, manuallyEdited: true };
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "到场客户新增失败"); return false; }
      setAttendanceRows((current) => [...current, savedRow]);
      recordOperation(activityStarted ? "活动开始后手动新增现场到场客户" : "手动添加现场到场客户", row.dealerCompany || row.dealerName, activityStarted ? "活动开始后单条补录现场到场客户。" : "手动添加现场到场客户。" );
      setActionNotice(`已添加到场客户：${row.dealerCompany || row.dealerName || "未命名客户"}`);
      return true;
    }
  };
  const deleteProductRows = async (ids: string[]) => {
    if (activityPublished) {
      setActionNotice("活动发布后禁止删除商品；待开始状态请先撤回发布。");
      return;
    }
    if (!productImportCompleted && serverImportTasks.PRODUCT) {
      const targets = productRows.filter((row) => ids.includes(row.id) && row.serverRowId);
      try {
        if (targets.length > 0) await deleteImportRows(Number(activityId), serverImportTasks.PRODUCT, targets.map((row) => row.serverRowId!));
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品预览删除失败"); return; }
    } else if (productImportCompleted) {
      const targets = productRows.filter((row) => ids.includes(row.id) && row.serverVersion !== undefined);
      try {
        for (const row of targets) await deleteAdminProduct(Number(activityId), Number(row.id), row.serverVersion!);
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品移除失败"); return; }
    }
    setProductRows((current) => current.filter((row) => !ids.includes(row.id)));
    if (!productImportCompleted) await refreshServerImportPreview("PRODUCT");
    setEditingProductRow((current) => current && ids.includes(current.id) ? null : current);
    recordOperation("删除商品", `${ids.length} 条商品`, "从当前有效商品列表移除；已有订单明细和金额不受影响。" );
    setActionNotice(`${productImportCompleted ? "已删除" : "已从待导入结果移除"} ${ids.length} 条商品，已有订单明细和金额不受影响。`);
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
      const targets = whitelistRows.filter((row) => ids.includes(row.id) && row.serverVersion !== undefined);
      try {
        for (const row of targets) await deleteAdminCustomer(Number(activityId), Number(row.id), row.serverVersion!);
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单删除失败"); return; }
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
      await refreshServerImportPreview("ATTENDANCE");
      setActionNotice(`已从待导入结果移除 ${ids.length} 名到场客户，确认导入后生效。`);
      return;
    }
    try { for (const id of ids) await deleteAdminAttendee(Number(activityId), Number(id)); }
    catch (error) { setActionNotice(error instanceof ApiError ? error.message : "到场客户删除失败"); return; }
    setAttendanceRows((current) => current.filter((row) => !ids.includes(row.id)));
    setEditingAttendanceRow((current) => current && ids.includes(current.id) ? null : current);
    recordOperation("删除现场到场客户", `${ids.length} 名客户`, "从当前现场到场名单移除，并同步从抽奖候选池移除；原 Excel 文件不受影响。" );
    setActionNotice(`已删除 ${ids.length} 名现场到场客户，抽奖候选池已同步更新。`);
  };
  const overviewTotals = overviewDashboard?.totals;
  const submittedCustomers = Number(overviewTotals?.order_count ?? 0);
  const totalActiveCustomers = whitelistRows.filter((row) => row.status === "有效").length;
  const progressRows = ([
    ["综合客户", "GENERAL"], ["特渠专业客户", "SPECIAL"],
  ] as const).map(([label, type]) => {
    const total = whitelistRows.filter((row) => row.status === "有效" && (type === "GENERAL" ? row.customerType === "综合客户" : row.customerType === "特渠专业客户")).length;
    const submitted = Number(overviewByType[type]?.totals.order_count ?? 0);
    return { label, total, submitted, percentage: total > 0 ? Math.min(100, submitted / total * 100) : 0 };
  });
  const adminStats = [
    ["订单总金额", `¥${money(Number(overviewTotals?.total_amount ?? 0))}`, "当前有效已提交订单"],
    ["已提交客户", submittedCustomers.toLocaleString("zh-CN"), totalActiveCustomers > 0 ? `${(submittedCustomers / totalActiveCustomers * 100).toFixed(1)}% 白名单已提交` : "当前提交客户"],
    ["订货总箱数", Number(overviewTotals?.total_quantity ?? 0).toLocaleString("zh-CN"), "当前有效已提交订单"],
    ["订货总吨数", overviewTotals?.total_tons == null ? "—" : Number(overviewTotals.total_tons).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 3 }), overviewTotals?.total_tons == null ? "部分商品缺少吨箱系数" : "当前有效已提交订单"],
  ];
  return (
    <section className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-logo"><span>金</span><b>订购会管理平台</b></div>
        <nav>{nav.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><i>{item.slice(0, 1)}</i>{item}</button>)}</nav>
        <div className="admin-user"><span>{(adminIdentity?.displayName || "管").slice(0, 1)}</span><p><b>{adminIdentity?.displayName || "管理员"}</b><small>{adminIdentity?.roleCode === "SUPER_ADMIN" ? "超级管理员" : adminIdentity?.departmentName || "部门账号"}</small></p></div>
      </aside>
      <main className="admin-main">
        <header>
           <div className="admin-heading"><div className="activity-switcher"><button type="button" onClick={() => setActivityMenuOpen((value) => !value)}><span>当前活动</span><b>{activityName}</b><em>⌄</em></button>{activityMenuOpen && <div className="activity-switcher-menu"><div><b>切换活动</b><button type="button" onClick={openNewActivity}>＋ 新建活动</button></div>{adminIdentity?.roleCode === "SUPER_ADMIN" && <label className="activity-department-filter"><span>按部门筛选</span><select value={activityDepartmentFilter} onChange={(event) => setActivityDepartmentFilter(event.target.value)}><option value="">全部部门</option>{departments.filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}{visibleActivities.map((activity) => <button type="button" className={activity.code === activityCode ? "active" : ""} key={activity.id} onClick={() => { setPreferredAdminActivityCode(activity.code); window.location.assign("/admin"); }}><span><b>{activity.name}</b><small>{activity.code}{adminIdentity?.roleCode === "SUPER_ADMIN" && activity.departmentName ? ` · ${activity.departmentName}` : ""}</small></span><em className={runtimeActivityStatus(activity.status)}>{runtimeActivityStatus(activity.status) === "draft" ? "草稿" : runtimeActivityStatus(activity.status) === "scheduled" ? "待开始" : runtimeActivityStatus(activity.status) === "running" ? "订货中" : runtimeActivityStatus(activity.status) === "closed" ? "订货已截止" : "活动已结束"}</em></button>)}</div>}</div><strong>{tab}</strong></div>
          <div className="admin-actions"><button type="button" onClick={() => setOperationLogOpen((value) => !value)}>操作日志{operationLogs.length > 0 ? ` · ${operationLogs.length}` : ""}</button><span className={activityClosed ? "closed" : activityStarted ? "" : "pending"}>{activityStatus === "draft" ? "草稿" : activityStatus === "scheduled" ? "待开始" : activityStatus === "running" ? "订货中" : activityStatus === "closed" ? "订货已截止" : "活动已结束"}</span>{activityPublished && <span className="locked">商品和白名单已锁定</span>}<div className="admin-identity-summary"><div><b>{adminIdentity?.displayName || adminIdentity?.username || "管理员"}</b><small>{adminIdentity?.roleCode === "SUPER_ADMIN" ? "超级管理员" : "部门账号"} · {adminIdentity?.departmentName || "全部部门"}</small></div><button type="button" className="admin-logout-button" onClick={() => void adminSession?.logout()} disabled={!adminSession || adminSession.busy}>退出登录</button></div>{adminSession?.error && <span className="admin-logout-error" role="alert">{adminSession.error}</span>}{operationLogOpen && <div className="operation-log-popover"><div><b>操作日志</b><button type="button" onClick={() => setOperationLogOpen(false)}>×</button></div>{operationLogs.length === 0 ? <p>暂无操作记录</p> : operationLogs.slice(0, 8).map((entry) => <article key={entry.id}><b>{entry.action}</b><span>{entry.target}</span><small>{entry.detail}</small><em>{entry.operator} · {entry.time}</em></article>)}</div>}</div>
        </header>
        {tab === "部门与账号" && adminIdentity?.roleCode === "SUPER_ADMIN" && <DepartmentAdminPanel />}
        {tab === "活动概览" && (
          <>
            <div className="admin-stats">
              {adminStats.map((item) => <article key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]}</small></article>)}
            </div>
            <div className="admin-grid">
              <article className="progress-card"><h2>客户提交进度</h2>{progressRows.map((item) => <div key={item.label}><p><b>{item.label}</b><span>{item.submitted} / {item.total}</span></p><i><em style={{ width: `${item.percentage}%` }} /></i></div>)}</article>
              <article className="activity-card">
                <h2>活动设置</h2>
                <div className="activity-config-grid"><label><span>活动名称 *</span><input value={activityNameDraft} disabled={activityClosed} onChange={(event) => setActivityNameDraft(event.target.value)} placeholder="例如：2026 年中秋订货会" /></label><label><span>活动编号</span><input value={activityCode} readOnly aria-label="活动编号，只读" /></label><label><span>订货开始时间</span><input type="datetime-local" min={activityStatus === "draft" || activityStatus === "scheduled" ? minimumFutureAt : undefined} value={activityStartDraft} disabled={activityStarted} onChange={(event) => setActivityStartDraft(event.target.value)} /></label><label><span>订货截止时间</span><input type="datetime-local" min={activityStatus === "running" ? activityEndAt : activityStartDraft || minimumFutureAt} value={activityEndDraft} disabled={activityClosed} onChange={(event) => setActivityEndDraft(event.target.value)} /></label><label><span>整场活动结束时间</span><input type="datetime-local" min={activityStatus === "running" || activityStatus === "closed" ? activityEventEndAt : activityEndDraft || minimumFutureAt} value={activityEventEndDraft} disabled={activityFinished} onChange={(event) => setActivityEventEndDraft(event.target.value)} /></label><label><span>活动状态</span><div className={`activity-status-display ${activityStatus}`}>{activityStatus === "draft" ? "草稿" : activityStatus === "scheduled" ? "待开始" : activityStatus === "running" ? "订货中" : activityStatus === "closed" ? "订货已截止" : "活动已结束"}</div></label></div>
                <p><span>当前状态</span><b className={activityClosed ? "closed-text" : activityStarted ? "green" : "pending-text"}>{activityStatus === "draft" ? "草稿 · H5 未发布" : activityStatus === "scheduled" ? `待开始 · ${activityStartDraft.replace("T", " ")} 自动开放` : activityStatus === "running" ? "订货中 · H5 可下单" : activityStatus === "closed" ? "订货已截止 · 抽奖和实时看板可继续" : "活动已结束 · 历史看板和战报只读"}</b></p><p><span>基础数据</span><b className={activityPublished ? "closed-text" : "green"}>{activityPublished ? "商品和白名单已锁定" : "可导入和替换"}</b></p><p><span>运行规则</span><small>{activityFinished ? "抽奖和实时推送已关闭；最终看板与战报可回看" : activityStatus === "closed" ? "订单只读；可继续抽奖，也可延长或立即结束整场活动" : activityStatus === "running" ? "开始时间不可修改；两个结束时间只能延长" : activityStatus === "scheduled" ? "可调整未来时间；修改基础数据请先撤回发布" : "保存设置不会发布活动"}</small></p><div className="activity-card-actions">{!activityFinished && <button className="admin-primary" onClick={() => void saveActivityConfig()}>{activityStatus === "closed" ? "保存延长活动时间" : activityStatus === "running" ? "保存延长时间" : activityStatus === "scheduled" ? "保存时间调整" : "保存活动设置"}</button>}{activityStatus === "draft" && <button onClick={() => void publishCurrentActivity()}>发布活动</button>}{activityStatus === "scheduled" && <button onClick={() => void withdrawCurrentActivity()}>撤回发布</button>}{activityStatus === "running" && <button className="danger-action" onClick={() => void closeCurrentActivity()}>立即截止订货</button>}{activityStatus === "closed" && <button className="danger-action" onClick={() => void finishCurrentActivity()}>结束整场活动</button>}{activityFinished && <button type="button" onClick={() => setTab("订单管理")}>查看最终数据</button>}</div>
              </article>
             </div>
             <ActivityEntryLinksCard
               key={activityCode}
               activityCode={activityCode}
               activityName={activityName}
               activityStatus={activityStatus}
                departmentName={currentActivity?.departmentName || adminIdentity?.departmentName || ""}
             />
           </>
         )}
        {tab === "商品导入" && (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>{productImportCompleted ? "当前活动商品" : "活动商品导入"}</h2><p>{productImportCompleted ? "当前数据来自最近一次确认的完整 Excel；发布活动后锁定" : "上传完整商品 Excel，浏览器解析后替换当前商品目录"}</p></div><div className="panel-actions"><button className="secondary-button" disabled={baseDataReadOnly || (!productImportCompleted && (!productFileName || Boolean(productImportError)))} onClick={openProductForm}>＋ 手动添加商品</button>{productImportCompleted && <button className="admin-primary" disabled={activityPublished} onClick={beginProductImport}>重新导入 Excel</button>}</div></div>
            {!productImportCompleted && <div className="import-rule-hint"><b>全量替换规则</b><span>{activityPublished ? "活动已发布，商品 Excel 和批量图片导入已锁定；待开始状态可先撤回发布再修改。" : "每次 Excel 与本次 ZIP 构成一套独立批次，不比较上一版本，也不继承上一版本图片。上传只生成预览，点击确认且全部保存成功后，才会整体替换当前商品目录。"}</span></div>}
            {!productImportCompleted && <div className="dual-upload-grid product-import-upload-grid">
              <article className={`file-upload-card ${productFileName && !productImportError ? "ready" : ""}`}>
                <div className="file-card-heading"><span>XL</span><div><b>商品信息 Excel</b><small>统一文件 · 读取 1 个商品 Sheet</small></div><em>{productFileName ? (productImportError ? "解析失败" : "解析完成") : "待上传"}</em></div>
                {productFileName ? <p title={productFileName}>{productFileName}</p> : <p>请选择：调味产品信息表.xlsx</p>}
                <div className="sheet-tags"><span>Sheet 名称不限</span><span>客户类型：综合 / 特渠 / 空</span><span>是否返利：是 / 否 / 空</span><span>产品说明：可为空</span></div>
                <footer><small>{activityPublished ? "活动已发布，Excel 导入已锁定" : productFileName && !productImportError ? `识别 ${parsedProductCount} 条商品` : "必须包含 1 个非空商品 Sheet"}</small><div>{productFileName && <button type="button" disabled={activityPublished} onClick={cancelProductImport}>移除</button>}<label className={activityPublished ? "disabled" : ""}><input type="file" accept=".xlsx" disabled={activityPublished} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleProductFile(file); event.currentTarget.value = ""; }} />{productFileName ? "替换文件" : "选择文件"}</label></div></footer>
              </article>
              <ProductImageUploadCard fileName={productImageFileName} stats={productImageStats} assets={resolvedProductImageAssets} error={productImageError} disabled={activityPublished || (!productFileName && !productImportCompleted)} disabledMessage={activityPublished ? "活动已发布，批量图片导入已锁定" : undefined} onFile={handleProductImageFile} onRemove={removeProductImages} />
            </div>}
            {!productImportCompleted && productFileName && <div className="import-result"><div className="import-summary"><span className="success-icon">✓</span><p><b>{productImportError ? "文件解析失败" : "Excel 与图片预览完成 · 等待确认替换"}</b><small>{productImportError ? "请修正文件后重新选择" : `Excel 原始 ${parsedProductCount} 条、已移除 ${removedProductCount} 条、待发布 ${productImportStats.total} 条；有效 ${productImportStats.valid} 条、待完善 ${productImportStats.incomplete} 条、待核对 ${productImportStats.review} 条`}</small></p><strong>{productImportStats.total} 条待发布</strong></div>{productImportError && <div className="warning-box"><b>文件无法导入</b><span>{productImportError}</span></div>}{!productImportError && productImportWarnings.length > 0 && <div className="warning-box"><b>导入前检查提示</b>{productImportWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}{!productImportError && <><div className="sheet-counts">{productSheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>)}</div><div className="product-import-stats">{[["待发布商品", productImportStats.total], ["有效", productImportStats.valid], ["待核对", productImportStats.review], ["待完善", productImportStats.incomplete]].map(([label, count]) => <span key={label as string}><b>{count}</b><small>{label}</small></span>)}</div><ProductImportTable rows={productRows} onEdit={setEditingProductRow} readOnly={baseDataReadOnly} allowDelete={!activityPublished} onDelete={deleteProductRows} /><button className="admin-primary wide" disabled={!productImportStats.total || activityPublished || productImportStats.review > 0 || (serverImportBlocking.PRODUCT ?? 0) > 0} onClick={confirmProductImport}>{productImportStats.review > 0 || (serverImportBlocking.PRODUCT ?? 0) > 0 ? `请先处理 ${Math.max(productImportStats.review, serverImportBlocking.PRODUCT ?? 0)} 条待核对商品` : `确认替换当前商品 ${productImportStats.total} 条`}</button></>}</div>}
            {productImportCompleted && <><div className="import-completed-banner"><span className="success-icon">✓</span><p><b>本次商品目录替换完成</b><small>{activityClosed ? "活动已截止，商品数据只读。" : activityStatus === "scheduled" ? "活动已发布，商品已锁定；如需修改请先撤回发布。" : activityStarted ? "活动已开始，Excel 导入已锁定；待确认图片仍可逐个处理。" : "商品已发布；待确认图片保留在当前版本，可在下方逐个选择，确认前 H5 使用占位图。"}</small></p><div><strong>{productRows.length}</strong><small>商品总数</small></div><div><strong>{productRows.filter((row) => row.status === "有效").length}</strong><small>有效</small></div><div><strong>{productRows.filter((row) => row.imageStatus === "待确认").length}</strong><small>图片待确认</small></div><div><strong>{productRows.filter((row) => row.imageStatus === "未匹配").length}</strong><small>图片未匹配</small></div></div><div className="data-section-title"><div><b>当前活动商品</b><span>{productFileName} · 共 {productRows.length} 条 · {activityClosed ? "活动已截止，只读" : activityStatus === "scheduled" ? "活动已发布，只读" : activityStarted ? "活动已锁定，待确认图片可继续处理" : "可编辑、单条/批量删除"}</span></div></div><ProductImportTable rows={productRows} onEdit={setEditingProductRow} readOnly={baseDataReadOnly} allowDelete={!activityPublished} allowDeleteAll={!activityPublished} onDelete={deleteProductRows} /></>}
          </div>
        )}
        {tab === "白名单" && (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>{whitelistImportCompleted ? "当前客户白名单" : "客户白名单导入"}</h2><p>{whitelistImportCompleted ? "当前数据来自最近一次确认的完整 Excel；发布活动后锁定" : "上传完整白名单 Excel，浏览器解析后替换当前白名单"}</p></div><div className="panel-actions"><button className="secondary-button" disabled={baseDataReadOnly || (!whitelistImportCompleted && (!whitelistFileName || Boolean(whitelistImportError)))} onClick={openWhitelistForm}>＋ 手动添加客户</button>{whitelistImportCompleted && <button className="admin-primary" disabled={activityPublished} onClick={beginWhitelistImport}>重新导入 Excel</button>}</div></div>
            {!whitelistImportCompleted && <div className="import-rule-hint"><b>全量替换规则</b><span>{activityPublished ? "活动已发布，白名单 Excel 已锁定；待开始状态可先撤回发布再修改。" : "每次白名单 Excel 都是一套独立完整名单，不展示新增、更新或移除差异。上传只生成预览，点击确认且保存成功后才整体替换当前白名单；只读取一个非空 Sheet，客户类型列可全部填写或全部留空；同一客户类型下手机号必须唯一，不同客户类型可以使用相同手机号。"}</span></div>}
            {!whitelistImportCompleted && <div className="single-upload-grid">
              <article className={"file-upload-card " + (whitelistFileName && !whitelistImportError ? "ready" : "")}>
                <div className="file-card-heading"><span>XL</span><div><b>客户白名单 Excel</b><small>统一文件 · 读取 1 个非空 Sheet，名称不限</small></div><em>{whitelistFileName ? (whitelistImportError ? "解析失败" : "解析完成") : "待上传"}</em></div>
                {whitelistFileName ? <p title={whitelistFileName}>{whitelistFileName}</p> : <p>请选择：【白名单】26年中秋订货会经销商白名单7.2.xlsx</p>}
                <div className="sheet-tags"><span>任意 Sheet（仅允许 1 个非空）</span><span>客户类型列可全部填写或全部留空</span><span>不再要求经销商类型列</span></div>
                <footer><small>{activityPublished ? "活动已发布，Excel 导入已锁定" : whitelistFileName && !whitelistImportError ? `识别 ${parsedWhitelistCount} 名客户 · ${whitelistMode === "UNSPECIFIED" ? "不区分客户类型" : "按客户类型"}` : "必须包含客户类型、分公司、经销商全称和经销商电话等字段"}</small><div>{whitelistFileName && <button type="button" disabled={activityPublished} onClick={cancelWhitelistImport}>移除</button>}<label className={activityPublished ? "disabled" : ""}><input type="file" accept=".xlsx" disabled={activityPublished} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleWhitelistFile(file); event.currentTarget.value = ""; }} />{whitelistFileName ? "替换文件" : "选择文件"}</label></div></footer>
              </article>
            </div>}
            {!whitelistImportCompleted && whitelistFileName && <div className="import-result"><div className="import-summary"><span className="success-icon">✓</span><p><b>{whitelistImportError ? "文件解析失败" : "Excel 预览完成 · 等待确认替换"}</b><small>{whitelistImportError ? "请修正文件后重新选择" : `Excel 原始 ${parsedWhitelistCount} 名、已移除 ${removedWhitelistCount} 名、待发布 ${whitelistImportStats.total} 名；有效 ${whitelistImportStats.valid} 名、待处理 ${whitelistImportStats.pending} 名`}</small></p><strong>{whitelistImportStats.total} 名待发布</strong></div>{whitelistImportError && <div className="warning-box"><b>文件无法导入</b><span>{whitelistImportError}</span></div>}{!whitelistImportError && whitelistImportWarnings.length > 0 && <div className="warning-box"><b>导入前检查提示</b>{whitelistImportWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}{!whitelistImportError && <><div className="sheet-counts">{whitelistSheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>)}</div><div className="product-import-stats">{[["待发布客户", whitelistImportStats.total], ["有效", whitelistImportStats.valid], ["待处理", whitelistImportStats.pending]].map(([label, count]) => <span key={label as string}><b>{count}</b><small>{label}</small></span>)}</div><CustomerWhitelistTable rows={whitelistRows} onEdit={setEditingWhitelistRow} readOnly={baseDataReadOnly} allowDelete={!activityPublished} onDelete={deleteWhitelistRows} /><button className="admin-primary wide" disabled={!whitelistImportStats.total || activityPublished || whitelistImportStats.pending > 0 || (serverImportBlocking.WHITELIST ?? 0) > 0} onClick={confirmWhitelistImport}>{whitelistImportStats.pending > 0 || (serverImportBlocking.WHITELIST ?? 0) > 0 ? `请先处理 ${Math.max(whitelistImportStats.pending, serverImportBlocking.WHITELIST ?? 0)} 条待处理白名单` : `确认替换当前白名单 ${whitelistImportStats.total} 名`}</button></>}</div>}
            {whitelistImportCompleted && <><div className="import-completed-banner"><span className="success-icon">✓</span><p><b>本次白名单替换完成</b><small>{activityClosed ? "活动已截止，白名单数据只读。" : activityStatus === "scheduled" ? "活动已发布，白名单已锁定；如需修改请先撤回发布。" : activityStarted ? "活动已开始，白名单 Excel 导入已锁定；紧急修改单条客户会记录操作日志。" : "当前白名单来自最近一次确认的完整 Excel；重新导入后以新文件为准，历史订单不会被删除。"}</small></p><div><strong>{whitelistRows.length}</strong><small>客户总数</small></div><div><strong>{whitelistRows.filter((row) => row.status === "有效").length}</strong><small>有效</small></div><div><strong>{whitelistRows.filter((row) => row.status === "待处理").length}</strong><small>待处理</small></div></div><div className="data-section-title"><div><b>当前客户白名单</b><span>{whitelistFileName} · {whitelistMode === "UNSPECIFIED" ? "不区分客户类型" : "综合客户和特渠客户"}共 {whitelistRows.length} 名 · {activityClosed ? "活动已截止，只读" : activityStatus === "scheduled" ? "活动已发布，只读" : activityStarted ? "活动已锁定，仅可改单条" : "可编辑、单条/批量删除"}</span></div></div><CustomerWhitelistTable rows={whitelistRows} onEdit={setEditingWhitelistRow} readOnly={baseDataReadOnly} allowDelete={!activityPublished} allowDeleteAll={!activityPublished} onDelete={deleteWhitelistRows} /></>}
          </div>
        )}
        {tab === "现场到场" && <AttendancePage rows={pendingAttendanceImport?.rows ?? attendanceRows} fileName={attendanceFileName} warnings={attendanceWarnings} sheetCounts={attendanceSheetCounts} error={attendanceImportError} activityStarted={activityStarted} activityClosed={activityClosed} pendingImport={pendingAttendanceImport} importAttemptName={attendanceImportAttemptName} blockingCount={serverImportBlocking.ATTENDANCE ?? 0} previewLoading={attendancePreviewLoading} publishing={attendancePublishing} onFile={handleAttendanceFile} onAdd={() => { setEditingAttendanceRow(null); setAttendanceFormOpen(true); }} onEdit={setEditingAttendanceRow} onDelete={deleteAttendanceRows} onConfirmImport={confirmAttendanceImport} onCancelImport={cancelAttendanceImport} />}
        {tab === "订单管理" && <OrderManagement activityClosed={activityClosed} activityId={Number(activityId)} activityName={activityName} />}
        {tab === "抽奖规则" && <LotterySettings rounds={lotteryRounds} attendanceRows={attendanceRows} activityId={Number(activityId)} customerCount={whitelistRows.filter((row) => row.status === "有效").length} readOnly={activityFinished} onChange={onLotteryChange} />}
      </main>
      {(productFormOpen || editingProductRow) && <ProductFormDrawer key={editingProductRow?.id ?? "new-product"} rows={productRows} initialRow={editingProductRow ?? undefined} activityStarted={activityStarted} onClose={() => { setProductFormOpen(false); setEditingProductRow(null); }} onSave={saveProductRow} />}
      {(whitelistFormOpen || editingWhitelistRow) && <WhitelistFormDrawer key={editingWhitelistRow?.id ?? "new-whitelist"} rows={whitelistRows} initialRow={editingWhitelistRow ?? undefined} customerTypeMode={whitelistMode} activityStarted={activityStarted} onClose={() => { setWhitelistFormOpen(false); setEditingWhitelistRow(null); }} onSave={saveWhitelistRow} />}
      {(attendanceFormOpen || editingAttendanceRow) && !activityClosed && <AttendanceFormDrawer key={editingAttendanceRow?.id ?? "new-attendance"} rows={pendingAttendanceImport?.rows ?? attendanceRows} initialRow={editingAttendanceRow ?? undefined} onClose={() => { setAttendanceFormOpen(false); setEditingAttendanceRow(null); }} onSave={saveAttendanceRow} />}
      {newActivityOpen && <div className="drawer-backdrop" onClick={() => !creatingActivity && setNewActivityOpen(false)}><aside className="form-drawer compact-drawer" onClick={(event) => event.stopPropagation()}><header><div><span>多活动管理</span><h2>新建活动</h2></div><button type="button" disabled={creatingActivity} onClick={() => setNewActivityOpen(false)}>×</button></header><div className="drawer-body"><div className="new-activity-note"><b>创建后为草稿状态</b><span>订货截止后仍可现场抽奖；整场活动结束后冻结看板与战报。</span></div>{adminIdentity?.roleCode === "SUPER_ADMIN" && <label><span>所属部门 *</span><select value={newActivity.departmentId} onChange={(event) => setNewActivity((value) => ({ ...value, departmentId: event.target.value }))}><option value="">请选择部门</option>{departments.filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.name}（{item.code}）</option>)}</select></label>}<label><span>活动名称 *</span><input value={newActivity.name} onChange={(event) => setNewActivity((value) => ({ ...value, name: event.target.value }))} placeholder="例如：2027 年春节订货会" /></label><div className="generated-activity-no"><span>活动编号</span><b>创建后自动生成</b><small>用于后台识别、报表和数据关联，创建后不可修改</small></div><label><span>订货开始时间 *</span><input type="datetime-local" min={minimumFutureAt} value={newActivity.startsAt} onChange={(event) => setNewActivity((value) => ({ ...value, startsAt: event.target.value }))} /></label><label><span>订货截止时间 *</span><input type="datetime-local" min={newActivity.startsAt || minimumFutureAt} value={newActivity.endsAt} onChange={(event) => setNewActivity((value) => ({ ...value, endsAt: event.target.value }))} /></label><label><span>整场活动结束时间 *</span><input type="datetime-local" min={newActivity.endsAt || minimumFutureAt} value={newActivity.eventEndsAt} onChange={(event) => setNewActivity((value) => ({ ...value, eventEndsAt: event.target.value }))} /></label></div><footer><button type="button" disabled={creatingActivity} onClick={() => setNewActivityOpen(false)}>取消</button><button type="button" className="admin-primary" disabled={creatingActivity} onClick={() => void submitNewActivity()}>{creatingActivity ? "正在创建…" : "创建草稿活动"}</button></footer></aside></div>}
      {actionNotice && <div className="admin-toast" role="status"><span>✓</span>{actionNotice}<button aria-label="关闭提示" onClick={() => setActionNotice("")}>×</button></div>}
    </section>
  );
}
