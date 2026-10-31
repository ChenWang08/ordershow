"use client";

import { formatBeijingTime } from "../shared/time";


import { adminNavigation, canUse, isManager } from "./permissions";
import { MemberAdminPanel } from "./MemberAdminPanel";
import { useModuleContext } from "./useModuleContext";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadImportRows, loadAttendanceMatchPreview, loadImportTask, type AdminActivitySummary } from "../../api";
import { OrderManagement } from "../../components/orders/OrderManagement";
import {
  bindAttendanceStaging, bindProductStaging, bindWhitelistStaging,
  createImportRowId,
  whitelistCustomerTypeMode,
} from "../../domain/import-domain";
import { LotterySettings } from "../lottery/Lottery";
import { AttendanceFormDrawer } from "./attendance/AttendanceFormDrawer";
import { AttendancePage } from "./attendance/AttendancePage";
import { ProductFormDrawer } from "./products/ProductFormDrawer";
import { WhitelistFormDrawer } from "./whitelist/WhitelistFormDrawer";
import { mergeAttendanceMatchPreview } from "./attendance-utils";
import { WhitelistPage } from "./WhitelistPage";
import { useWhitelistImport } from "./useWhitelistImport";
import { useWhitelistEditor } from "./useWhitelistEditor";
import { useAttendanceManagement } from "./useAttendanceManagement";
import { ProductImportPage } from "./ProductImportPage";
import { useProductImport } from "./useProductImport";
import { useProductEditor } from "./useProductEditor";
import { ActivityOverview } from "./ActivityOverview";
import { useActivitySettings } from "./useActivitySettings";
import { useActivityOverview } from "./useActivityOverview";
import { useAdminIdentity } from "../../admin-context";
import { AdminHeader } from "./AdminHeader";
import { NewActivityDrawer } from "./NewActivityDrawer";
import { useAdminActivities } from "./useAdminActivities";
import { useAdminInitialization } from "./useAdminInitialization";
import type { OperationLogEntry } from "./admin-types";
import { useAdminWorkspaceProps } from "../workspace/useAdminWorkspaceProps";
import { DepartmentAdminPanel } from "./DepartmentAdminPanel";
import { AdminLayout } from "./AdminLayout";
import { useActivityWorkspace } from "../workspace/ActivityWorkspace";

export function AdminWorkspace({ activities }: { activities?: AdminActivitySummary[] } = {}) {
  const activityRuntime = useActivityWorkspace();
  const {
  lotteryRounds, onLotteryChange, activityCode,
    activityName, onActivityNameChange, activityId,
    activityStatus, onActivityStatusChange, activityStartAt,
    onActivityStartAtChange, activityEndAt, onActivityEndAtChange,
    activityEventEndAt, onActivityEventEndAtChange, productRows,
    onProductRowsChange, productImportCompleted, onProductImportCompleted,
    onProductImportCommitted, productImportHasRun, whitelistRows,
    onWhitelistRowsChange, whitelistImportCompleted, onWhitelistImportCompleted,
    onWhitelistImportCommitted, whitelistImportHasRun, attendanceRows,
    onAttendanceRowsChange, attendanceFileName, onAttendanceFileNameChange,
    attendanceWarnings, onAttendanceWarningsChange, attendanceSheetCounts,
    onAttendanceSheetCountsChange, attendanceImportError, onAttendanceImportErrorChange,
} = useAdminWorkspaceProps();
  const adminIdentity = useAdminIdentity();
  const activityStarted = activityStatus === "running" || activityStatus === "closed" || activityStatus === "finished";
  const activityClosed = activityStatus === "closed" || activityStatus === "finished";
  const activityFinished = activityStatus === "finished";
  const navigation = adminNavigation(adminIdentity);
  const [selectedTab, setTab] = useState(navigation[0] || "");
  const tab = navigation.includes(selectedTab) ? selectedTab : navigation[0] || "";
  const importVisibility = useRef({ tab, controller: new AbortController() });
  useEffect(() => { importVisibility.current.tab = tab; }, [tab]);
  useEffect(() => {
    const controller = new AbortController(); importVisibility.current.controller = controller;
    return () => controller.abort();
  }, []);
  const importWaitOptions = useCallback((scope: string) => ({ signal: importVisibility.current.controller.signal,
    isVisible: () => importVisibility.current.tab === scope && document.visibilityState !== "hidden" }), []);
  const [visitedTabs, setVisitedTabs] = useState([navigation[0] || ""]);
  const selectTab = (next: string) => { setVisitedTabs(previous => previous.includes(next) ? previous : [...previous, next]); setTab(next); };
  const [orderRevision, setOrderRevision] = useState(0);
  const [statisticsStale, setStatisticsStale] = useState(false);
  const [lotteryDirty, setLotteryDirty] = useState(false);
  const [orderDirty, setOrderDirty] = useState(false);
  const [membersDirty, setMembersDirty] = useState(false);
  const [departmentsDirty, setDepartmentsDirty] = useState(false);
  const [liveRoomDirty, setLiveRoomDirty] = useState(false);
  const [moduleRevision, setModuleRevision] = useState(0);
  const moduleScope = ["商品导入", "白名单", "现场到场", "抽奖规则"].includes(tab) ? tab : null;
  const moduleQuery = useModuleContext(activityId, moduleScope, moduleRevision);
  const moduleContext = moduleQuery.data;
  const setProductRows = onProductRowsChange;
  const setWhitelistRows = onWhitelistRowsChange;
  const setProductImportCompleted = onProductImportCompleted;
  const setWhitelistImportCompleted = onWhitelistImportCompleted;
  const [actionNotice, setActionNotice] = useState("");
  const adminActivities = useAdminActivities({ activityId, activityCode, setActionNotice, initialActivities: activities, activeActivity: activityRuntime.runtimeActivity });
  const { currentActivity, minimumFutureAt } = adminActivities;
  const [operationLogs, setOperationLogs] = useState<OperationLogEntry[]>([]);
  const [operationLogOpen, setOperationLogOpen] = useState(false);
  const whitelistMode = useMemo(() => whitelistRows.length ? whitelistCustomerTypeMode(whitelistRows)
    : moduleContext?.customerTypeMode || activityRuntime.runtimeActivity?.whitelistCustomerTypeMode || "TYPED", [whitelistRows, moduleContext, activityRuntime.runtimeActivity]);
  const setAttendanceRows = onAttendanceRowsChange;
  const [serverImportTasks, setServerImportTasks] = useState<Partial<Record<"PRODUCT" | "WHITELIST" | "ATTENDANCE", number>>>({});
  const [serverImportBlocking, setServerImportBlocking] = useState<Partial<Record<"PRODUCT" | "WHITELIST" | "ATTENDANCE", number>>>({});
  const regionCodesByName = useMemo(() => Object.fromEntries((activityRuntime.runtimeActivity?.regions ?? []).map(region => [region.name, region.code])), [activityRuntime.runtimeActivity]);
  const recordOperation = (action: string, target: string, detail: string) => {
    setOperationLogs((current) => [{ id: createImportRowId("operation"), action, target, detail, operator: adminIdentity?.displayName || adminIdentity?.username || "运营管理员", time: formatBeijingTime(new Date()) }, ...current]);
    moduleLoads.logs.invalidate();
    setStatisticsStale(true);
    if (/商品|价格|白名单|活动|订货/.test(action)) setOrderRevision(value => value + 1);
    if (/白名单/.test(action)) { moduleLoads.product.invalidate(); moduleLoads.attendance.invalidate(); moduleLoads.lottery.invalidate(); }
    if (/到场|商品|价格/.test(action)) moduleLoads.lottery.invalidate();
  };
  const recordModuleOperation = (action: string, target: string, detail: string) => {
    recordOperation(action, target, detail);
    setModuleRevision(value => value + 1);
  };
  const refreshServerImportPreview = async (type: "PRODUCT" | "WHITELIST" | "ATTENDANCE") => {
    const taskId = serverImportTasks[type];
    if (!taskId || !Number.isFinite(Number(activityId))) return;
    if (type === "ATTENDANCE") {
      setAttendancePreviewLoading(true);
      setAttendanceMatchPreview(null);
    }
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
        onAttendanceImportErrorChange("");
        setPendingAttendanceImport((current) => current ? { ...current,
          rows: attendancePreview
            ? mergeAttendanceMatchPreview(bindAttendanceStaging(current.rows, staging), attendancePreview)
            : bindAttendanceStaging(current.rows, staging) } : current);
      }
    } catch (error) {
      if (type === "ATTENDANCE") onAttendanceImportErrorChange(`导入预览或白名单关联试算失败：${error instanceof Error ? error.message : "请稍后重试。"}`);
      throw error;
    } finally {
      if (type === "ATTENDANCE") setAttendancePreviewLoading(false);
    }
  };
  const attendanceManagement = useAttendanceManagement({
    importWaitOptions: () => importWaitOptions("现场到场"),
    activityId, activityStatus, setAttendanceRows, attendanceImportError,
    onAttendanceFileNameChange, onAttendanceWarningsChange, onAttendanceSheetCountsChange, onAttendanceImportErrorChange,
    serverImportTasks, serverImportBlocking, setServerImportTasks, setServerImportBlocking,
    setActionNotice, recordOperation: recordModuleOperation, refreshServerImportPreview,
  });
  const {
    attendanceFormOpen, setAttendanceFormOpen, editingAttendanceRow, setEditingAttendanceRow, pendingAttendanceImport, setPendingAttendanceImport, setAttendanceMatchPreview, attendancePreviewReady, attendancePreviewLoading, setAttendancePreviewLoading, attendancePublishing, attendanceImportAttemptName, setAttendanceImportAttemptName, handleAttendanceFile, retryAttendancePreview, cancelAttendanceImport, confirmAttendanceImport, saveAttendanceRow, deleteAttendanceRows,
  } = attendanceManagement;
  const whitelistImport = useWhitelistImport({
    importWaitOptions: () => importWaitOptions("白名单"),
    activityId, activityStatus, whitelistRows, setWhitelistRows, whitelistImportHasRun,
    setWhitelistImportCompleted, onWhitelistImportCommitted, attendanceRows, setAttendanceRows,
    pendingAttendanceImport, serverImportTasks, serverImportBlocking, setServerImportTasks,
    setServerImportBlocking, setActionNotice, recordOperation: recordModuleOperation, refreshServerImportPreview,
  });
  const { setWhitelistFileName, setWhitelistImportInputCount, setWhitelistSheetCounts, setPendingWhitelistRollbackRows } = whitelistImport;
  const whitelistEditor = useWhitelistEditor({
    activityId, activityStatus, whitelistRows, setWhitelistRows, whitelistImportCompleted,
    regionCodesByName, serverImportTasks, setActionNotice, recordOperation: recordModuleOperation, refreshServerImportPreview, whitelistImport,
  });
  const { editingWhitelistRow, setEditingWhitelistRow, whitelistFormOpen, setWhitelistFormOpen, saveWhitelistRow } = whitelistEditor;
  const productImport = useProductImport({
    importWaitOptions: () => importWaitOptions("商品导入"),
    activityId, activityStatus, productRows, setProductRows, productImportCompleted,
    productImportHasRun, setProductImportCompleted, onProductImportCommitted,
    serverImportTasks, setServerImportTasks, serverImportBlocking, setServerImportBlocking,
    setActionNotice, recordOperation,
  });
  const { setProductFileName, setProductImportInputCount, setProductSheetCounts, setPendingProductRollbackRows } = productImport;
  const productEditor = useProductEditor({
    activityId, activityStatus, productRows, setProductRows, productImportCompleted,
    serverImportTasks, setActionNotice, recordOperation, productImport, refreshServerImportPreview,
  });
  const { productFormOpen, editingProductRow, setProductFormOpen, setEditingProductRow, saveProductRow } = productEditor;
  const moduleLoads = useAdminInitialization({
    tab, logsOpen: operationLogOpen, activity: activityRuntime.runtimeActivity,
    preservePreviews: { product: Boolean(productImport.productFileName && !productImportCompleted) || productFormOpen || Boolean(editingProductRow),
      whitelist: Boolean(whitelistImport.whitelistFileName && !whitelistImportCompleted) || whitelistFormOpen || Boolean(editingWhitelistRow),
      attendance: Boolean(pendingAttendanceImport) || attendanceFormOpen || Boolean(editingAttendanceRow), lottery: lotteryDirty },
    activityId, onAttendanceFileNameChange, onLotteryChange,
    onProductImportCommitted, onProductImportCompleted, onWhitelistImportCommitted,
    onWhitelistImportCompleted, setAttendanceRows, setProductRows,
    setWhitelistRows, setPendingProductRollbackRows, setProductFileName,
    setProductImportInputCount, setProductSheetCounts, setPendingWhitelistRollbackRows,
    setWhitelistFileName, setWhitelistImportInputCount, setWhitelistSheetCounts,
    setAttendanceImportAttemptName, setAttendanceMatchPreview, setPendingAttendanceImport,
    setOperationLogs, setServerImportTasks,
    setServerImportBlocking, setActionNotice,
  });
  const activitySettings = useActivitySettings({
    onActivityLoaded: activityRuntime.setRuntimeActivity,
    activityId, activityCode, activityName, activityStatus, activityStartAt, activityEndAt, activityEventEndAt, productImportCompleted, whitelistImportCompleted, onActivityNameChange, onActivityStatusChange, onActivityStartAtChange, onActivityEndAtChange, onActivityEventEndAtChange, setActionNotice, recordOperation,
  });
  const activityOverview = useActivityOverview(activityId, canUse(adminIdentity, "OVERVIEW"));
  const moduleLoad = tab === "商品导入" ? moduleLoads.product : tab === "白名单" ? moduleLoads.whitelist
    : tab === "现场到场" ? moduleLoads.attendance : tab === "抽奖规则" ? moduleLoads.lottery : null;
  const hasPendingPreview = Boolean((productImport.productFileName && !productImportCompleted)
    || (whitelistImport.whitelistFileName && !whitelistImportCompleted) || pendingAttendanceImport);
  const unsaved = activitySettings.dirty || Boolean(activitySettings.reopenDraft) || adminActivities.newActivityOpen || hasPendingPreview || lotteryDirty || orderDirty || membersDirty || departmentsDirty || liveRoomDirty || productFormOpen || Boolean(editingProductRow)
    || whitelistFormOpen || Boolean(editingWhitelistRow) || attendanceFormOpen || Boolean(editingAttendanceRow);
  const unsavedRef = useRef(unsaved);
  useEffect(() => { unsavedRef.current = unsaved; }, [unsaved]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (unsavedRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const refreshModule = async () => {
    if (unsaved && !window.confirm("有未保存的编辑或导入预览，重新读取可能替换这些内容，是否继续？")) return;
    await Promise.all([moduleLoad?.refresh(), moduleQuery.refresh()]);
  };
  return (
    <>
      <AdminLayout tab={tab} onTabChange={selectTab} header={
        <AdminHeader activityCode={activityCode} activityName={activityName} activityStatus={activityStatus}
          tab={tab} activities={adminActivities} operationLogs={operationLogs}
          operationLogOpen={operationLogOpen} setOperationLogOpen={setOperationLogOpen}
          logQuery={moduleLoads.logs} confirmActivitySwitch={() => {
            if (unsaved && !window.confirm("当前活动有未保存的编辑或导入预览，切换活动将离开当前页面，是否继续？")) return false;
            unsavedRef.current = false; return true;
          }}
        />}>
        <div className="admin-refresh-bar">
          <span>活动状态与配置按需更新，不自动刷新统计</span>
          <button type="button" disabled={activitySettings.activityRefreshing} onClick={() => void activitySettings.refreshActivity()}>{activitySettings.activityRefreshing ? "更新活动信息中…" : "刷新活动信息"}</button>
          {activitySettings.activityRefreshError && <span role="alert">活动信息刷新失败：{activitySettings.activityRefreshError}；保留当前信息，请重试。</span>}
        </div>
        {moduleScope && <div className="admin-refresh-bar"><span>{moduleLoad?.loading || moduleQuery.loading ? "正在加载当前模块…" : moduleLoad?.updatedAt ? `最近读取：${formatBeijingTime(moduleLoad.updatedAt)}${moduleLoad.stale ? " · 相关数据有变化" : ""}` : "打开当前模块后读取"}</span><button type="button" disabled={moduleLoad?.loading || moduleQuery.loading} onClick={() => void refreshModule()}>刷新当前模块</button><button type="button" disabled={moduleQuery.loading} onClick={() => void moduleQuery.refresh()}>刷新基础信息</button>{(moduleLoad?.error || moduleQuery.error) && <span role="alert">加载失败：{moduleLoad?.error || moduleQuery.error}；请点击刷新重试。</span>}</div>}
        {!tab && <section className="admin-panel"><div className="empty-state">暂无功能权限，请联系部门管理员。</div></section>}
        {visitedTabs.includes("成员管理") && isManager(adminIdentity) && <div hidden={tab !== "成员管理"}><MemberAdminPanel active={tab === "成员管理"} onDirtyChange={setMembersDirty} /></div>}
        {visitedTabs.includes("部门与账号") && adminIdentity?.roleCode === "SUPER_ADMIN" && <div hidden={tab !== "部门与账号"}><DepartmentAdminPanel active={tab === "部门与账号"} onDirtyChange={setDepartmentsDirty} /></div>}
        {moduleLoad && !moduleLoad.loaded && <section className="admin-panel" aria-busy={moduleLoad.loading}><p>{moduleLoad.error ? "当前模块尚未加载，请重试。" : "正在读取当前模块资料…"}</p></section>}
        {visitedTabs.includes("活动概览") && <div hidden={tab !== "活动概览"}><ActivityOverview
          activityId={Number(activityId)}
          activityCode={activityCode} activityName={activityName} activityStatus={activityStatus}
          activityEndAt={activityEndAt} activityEventEndAt={activityEventEndAt}
          minimumFutureAt={minimumFutureAt}
          departmentName={currentActivity?.departmentName || adminIdentity?.departmentName || ""}
          settings={activitySettings} activity={activityRuntime.runtimeActivity} onLiveRoomDirtyChange={setLiveRoomDirty}
          overview={{ ...activityOverview, refresh: async () => { const result = await activityOverview.refresh(); if (result) setStatisticsStale(false); return result; } }}
          statisticsStale={statisticsStale} onViewOrders={() => selectTab("订单管理")}
        /></div>}
        {visitedTabs.includes("商品导入") && moduleLoads.product.loaded && <div hidden={tab !== "商品导入"}><ProductImportPage
          activityStatus={activityStatus} productRows={productRows} productImportCompleted={productImportCompleted}
          serverImportBlocking={serverImportBlocking} productImport={productImport} productEditor={productEditor}
        /></div>}
        {visitedTabs.includes("白名单") && moduleLoads.whitelist.loaded && <div hidden={tab !== "白名单"}><WhitelistPage
          activityStatus={activityStatus} whitelistRows={whitelistRows} whitelistImportCompleted={whitelistImportCompleted}
          serverImportBlocking={serverImportBlocking} whitelistImport={whitelistImport} whitelistEditor={whitelistEditor}
        /></div>}
        {visitedTabs.includes("现场到场") && moduleLoads.attendance.loaded && <div hidden={tab !== "现场到场"}><AttendancePage rows={pendingAttendanceImport?.rows ?? attendanceRows} fileName={attendanceFileName} warnings={attendanceWarnings} sheetCounts={attendanceSheetCounts} error={attendanceImportError} activityStarted={activityStarted} activityClosed={activityClosed} pendingImport={pendingAttendanceImport} importAttemptName={attendanceImportAttemptName} blockingCount={serverImportBlocking.ATTENDANCE ?? 0} previewLoading={attendancePreviewLoading} previewReady={attendancePreviewReady} onRetryPreview={retryAttendancePreview} publishing={attendancePublishing} onFile={handleAttendanceFile} onAdd={() => { setEditingAttendanceRow(null); setAttendanceFormOpen(true); }} onEdit={setEditingAttendanceRow} onDelete={deleteAttendanceRows} onConfirmImport={confirmAttendanceImport} onCancelImport={cancelAttendanceImport} customerTypeMode={whitelistMode} /></div>}
        {visitedTabs.includes("订单管理") && <div hidden={tab !== "订单管理"}><OrderManagement active={tab === "订单管理"} onDirtyChange={setOrderDirty} revision={orderRevision} onChanged={() => { setStatisticsStale(true); moduleLoads.lottery.invalidate(); moduleLoads.logs.invalidate(); }} activityClosed={activityClosed} activityStarted={activityStarted} activityId={Number(activityId)} activityName={activityName} /></div>}
        {visitedTabs.includes("抽奖规则") && moduleLoads.lottery.loaded && <div hidden={tab !== "抽奖规则"}><LotterySettings revision={moduleLoads.lottery.updatedAt ?? ""} active={tab === "抽奖规则"} rounds={lotteryRounds} attendanceRows={attendanceRows} activityId={Number(activityId)} attendeeCount={moduleContext?.attendeeCount ?? 0} customerCount={moduleContext?.customerCount ?? 0} customerTypeMode={whitelistMode} readOnly={activityFinished} onChange={rounds => { onLotteryChange(rounds); setLotteryDirty(true); }} onSaved={() => { setLotteryDirty(false); moduleLoads.logs.invalidate(); }} /></div>}
      </AdminLayout>
      {(productFormOpen || editingProductRow) && <ProductFormDrawer key={editingProductRow?.id ?? "new-product"} rows={productRows} initialRow={editingProductRow ?? undefined} activityStarted={activityStarted} activityId={Number(activityId)} scopeEnabled={productImportCompleted && (whitelistImportCompleted || Boolean(moduleContext?.whitelistPublished))} onClose={() => { setProductFormOpen(false); setEditingProductRow(null); }} onSave={saveProductRow} />}
      {(whitelistFormOpen || editingWhitelistRow) && <WhitelistFormDrawer key={editingWhitelistRow?.id ?? "new-whitelist"} rows={whitelistRows} initialRow={editingWhitelistRow ?? undefined} customerTypeMode={whitelistMode} activityStarted={activityStarted} onClose={() => { setWhitelistFormOpen(false); setEditingWhitelistRow(null); }} onSave={saveWhitelistRow} />}
      {(attendanceFormOpen || editingAttendanceRow) && !activityClosed && <AttendanceFormDrawer key={editingAttendanceRow?.id ?? "new-attendance"} rows={pendingAttendanceImport?.rows ?? attendanceRows} initialRow={editingAttendanceRow ?? undefined} onClose={() => { setAttendanceFormOpen(false); setEditingAttendanceRow(null); }} onSave={saveAttendanceRow} />}
      {adminActivities.newActivityOpen && <NewActivityDrawer activities={adminActivities} />}
      {actionNotice && <div className="admin-toast" role="status"><span>✓</span>{actionNotice}<button aria-label="关闭提示" onClick={() => setActionNotice("")}>×</button></div>}
    </>
  );
}
