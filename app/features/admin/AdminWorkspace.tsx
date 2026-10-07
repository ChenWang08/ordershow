"use client";

import { adminNavigation, canUse, isManager } from "./permissions";
import { MemberAdminPanel } from "./MemberAdminPanel";
import { useModuleContext } from "./useModuleContext";
import { useMemo, useState } from "react";
import { loadImportRows, loadAttendanceMatchPreview, loadImportTask, loadAdminProducts } from "../../api";
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

export function AdminWorkspace() {
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
  const moduleContext = useModuleContext(activityId, navigation.some(t => t !== "成员管理" && t !== "部门与账号"));
  const setProductRows = onProductRowsChange;
  const setWhitelistRows = onWhitelistRowsChange;
  const setProductImportCompleted = onProductImportCompleted;
  const setWhitelistImportCompleted = onWhitelistImportCompleted;
  const [actionNotice, setActionNotice] = useState("");
  const adminActivities = useAdminActivities({ activityId, activityCode, setActionNotice });
  const { currentActivity, minimumFutureAt } = adminActivities;
  const [operationLogs, setOperationLogs] = useState<OperationLogEntry[]>([]);
  const [operationLogOpen, setOperationLogOpen] = useState(false);
  const whitelistMode = useMemo(() => canUse(adminIdentity, "WHITELIST") ? whitelistCustomerTypeMode(whitelistRows) : moduleContext?.customerTypeMode || "TYPED", [whitelistRows, adminIdentity, moduleContext]);
  const setAttendanceRows = onAttendanceRowsChange;
  const [serverImportTasks, setServerImportTasks] = useState<Partial<Record<"PRODUCT" | "WHITELIST" | "ATTENDANCE", number>>>({});
  const [serverImportBlocking, setServerImportBlocking] = useState<Partial<Record<"PRODUCT" | "WHITELIST" | "ATTENDANCE", number>>>({});
  const [regionCodesByName, setRegionCodesByName] = useState<Record<string, string>>({});
  const recordOperation = (action: string, target: string, detail: string) => {
    setOperationLogs((current) => [{ id: createImportRowId("operation"), action, target, detail, operator: adminIdentity?.displayName || adminIdentity?.username || "运营管理员", time: new Date().toLocaleString("zh-CN", { hour12: false }) }, ...current]);
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
  const attendanceManagement = useAttendanceManagement({
    activityId, activityStatus, setAttendanceRows, attendanceImportError,
    onAttendanceFileNameChange, onAttendanceWarningsChange, onAttendanceSheetCountsChange, onAttendanceImportErrorChange,
    serverImportTasks, serverImportBlocking, setServerImportTasks, setServerImportBlocking,
    setActionNotice, recordOperation, refreshServerImportPreview,
  });
  const {
    attendanceFormOpen, setAttendanceFormOpen, editingAttendanceRow, setEditingAttendanceRow, pendingAttendanceImport, setPendingAttendanceImport, setAttendanceMatchPreview, attendancePreviewLoading, setAttendancePreviewLoading, attendancePublishing, attendanceImportAttemptName, setAttendanceImportAttemptName, handleAttendanceFile, cancelAttendanceImport, confirmAttendanceImport, saveAttendanceRow, deleteAttendanceRows,
  } = attendanceManagement;
  const whitelistImport = useWhitelistImport({
    refreshProductScopes: async () => {
      if (!productImportCompleted || !canUse(adminIdentity, "PRODUCT")) return;
      const products = await loadAdminProducts(Number(activityId));
      setProductRows(current => current.map(row => ({ ...row, dealerScope: products.find(p => String(p.id) === row.id)?.dealerScope ?? row.dealerScope })));
    },
    activityId, activityStatus, whitelistRows, setWhitelistRows, whitelistImportHasRun,
    setWhitelistImportCompleted, onWhitelistImportCommitted, attendanceRows, setAttendanceRows,
    pendingAttendanceImport, serverImportTasks, serverImportBlocking, setServerImportTasks,
    setServerImportBlocking, setActionNotice, recordOperation, refreshServerImportPreview,
  });
  const { setWhitelistFileName, setWhitelistImportInputCount, setWhitelistSheetCounts, setPendingWhitelistRollbackRows } = whitelistImport;
  const whitelistEditor = useWhitelistEditor({
    activityId, activityStatus, whitelistRows, setWhitelistRows, whitelistImportCompleted,
    regionCodesByName, serverImportTasks, setActionNotice, recordOperation, refreshServerImportPreview, whitelistImport,
  });
  const { editingWhitelistRow, setEditingWhitelistRow, whitelistFormOpen, setWhitelistFormOpen, saveWhitelistRow } = whitelistEditor;
  const productImport = useProductImport({
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
  useAdminInitialization({
    activityId, onAttendanceFileNameChange, onLotteryChange,
    onProductImportCommitted, onProductImportCompleted, onWhitelistImportCommitted,
    onWhitelistImportCompleted, setAttendanceRows, setProductRows,
    setWhitelistRows, setPendingProductRollbackRows, setProductFileName,
    setProductImportInputCount, setProductSheetCounts, setPendingWhitelistRollbackRows,
    setWhitelistFileName, setWhitelistImportInputCount, setWhitelistSheetCounts,
    setAttendanceImportAttemptName, setAttendanceMatchPreview, setPendingAttendanceImport,
    setRegionCodesByName, setOperationLogs, setServerImportTasks,
    setServerImportBlocking, setActionNotice,
  });
  const activitySettings = useActivitySettings({
    activityId, activityCode, activityName, activityStatus, activityStartAt, activityEndAt, activityEventEndAt, productImportCompleted, whitelistImportCompleted, onActivityNameChange, onActivityStatusChange, onActivityStartAtChange, onActivityEndAtChange, onActivityEventEndAtChange, setActionNotice, recordOperation,
  });
  const activityOverview = useActivityOverview(activityId, whitelistRows, canUse(adminIdentity, "OVERVIEW"), canUse(adminIdentity, "WHITELIST") ? null : moduleContext);
  return (
    <>
      <AdminLayout tab={tab} onTabChange={setTab} header={
        <AdminHeader activityCode={activityCode} activityName={activityName} activityStatus={activityStatus}
          tab={tab} activities={adminActivities} operationLogs={operationLogs}
          operationLogOpen={operationLogOpen} setOperationLogOpen={setOperationLogOpen}
        />}>
        {!tab && <section className="admin-panel"><div className="empty-state">暂无功能权限，请联系部门管理员。</div></section>}
        {tab === "成员管理" && isManager(adminIdentity) && <MemberAdminPanel />}
        {tab === "部门与账号" && adminIdentity?.roleCode === "SUPER_ADMIN" && <DepartmentAdminPanel />}
        {tab === "活动概览" && <ActivityOverview
          activityCode={activityCode} activityName={activityName} activityStatus={activityStatus}
          activityEndAt={activityEndAt} activityEventEndAt={activityEventEndAt}
          minimumFutureAt={minimumFutureAt}
          departmentName={currentActivity?.departmentName || adminIdentity?.departmentName || ""}
          settings={activitySettings} overview={activityOverview} onViewOrders={() => setTab("订单管理")}
        />}
        {tab === "商品导入" && <ProductImportPage
          activityStatus={activityStatus} productRows={productRows} productImportCompleted={productImportCompleted}
          serverImportBlocking={serverImportBlocking} productImport={productImport} productEditor={productEditor}
        />}
        {tab === "白名单" && <WhitelistPage
          activityStatus={activityStatus} whitelistRows={whitelistRows} whitelistImportCompleted={whitelistImportCompleted}
          serverImportBlocking={serverImportBlocking} whitelistImport={whitelistImport} whitelistEditor={whitelistEditor}
        />}
        {tab === "现场到场" && <AttendancePage rows={pendingAttendanceImport?.rows ?? attendanceRows} fileName={attendanceFileName} warnings={attendanceWarnings} sheetCounts={attendanceSheetCounts} error={attendanceImportError} activityStarted={activityStarted} activityClosed={activityClosed} pendingImport={pendingAttendanceImport} importAttemptName={attendanceImportAttemptName} blockingCount={serverImportBlocking.ATTENDANCE ?? 0} previewLoading={attendancePreviewLoading} publishing={attendancePublishing} onFile={handleAttendanceFile} onAdd={() => { setEditingAttendanceRow(null); setAttendanceFormOpen(true); }} onEdit={setEditingAttendanceRow} onDelete={deleteAttendanceRows} onConfirmImport={confirmAttendanceImport} onCancelImport={cancelAttendanceImport} customerTypeMode={whitelistMode} />}
        {tab === "订单管理" && <OrderManagement activityClosed={activityClosed} activityStarted={activityStarted} activityId={Number(activityId)} activityName={activityName} />}
        {tab === "抽奖规则" && <LotterySettings rounds={lotteryRounds} attendanceRows={attendanceRows} activityId={Number(activityId)} attendeeCount={canUse(adminIdentity, "ATTENDANCE") ? attendanceRows.length : moduleContext?.attendeeCount || 0} customerCount={canUse(adminIdentity, "WHITELIST") ? whitelistRows.filter((row) => row.status === "有效").length : moduleContext?.customerCount || 0} customerTypeMode={whitelistMode} readOnly={activityFinished} onChange={onLotteryChange} />}
      </AdminLayout>
      {(productFormOpen || editingProductRow) && <ProductFormDrawer key={editingProductRow?.id ?? "new-product"} rows={productRows} initialRow={editingProductRow ?? undefined} activityStarted={activityStarted} activityId={Number(activityId)} scopeEnabled={productImportCompleted && (whitelistImportCompleted || Boolean(moduleContext?.whitelistPublished))} onClose={() => { setProductFormOpen(false); setEditingProductRow(null); }} onSave={saveProductRow} />}
      {(whitelistFormOpen || editingWhitelistRow) && <WhitelistFormDrawer key={editingWhitelistRow?.id ?? "new-whitelist"} rows={whitelistRows} initialRow={editingWhitelistRow ?? undefined} customerTypeMode={whitelistMode} activityStarted={activityStarted} onClose={() => { setWhitelistFormOpen(false); setEditingWhitelistRow(null); }} onSave={saveWhitelistRow} />}
      {(attendanceFormOpen || editingAttendanceRow) && !activityClosed && <AttendanceFormDrawer key={editingAttendanceRow?.id ?? "new-attendance"} rows={pendingAttendanceImport?.rows ?? attendanceRows} initialRow={editingAttendanceRow ?? undefined} onClose={() => { setAttendanceFormOpen(false); setEditingAttendanceRow(null); }} onSave={saveAttendanceRow} />}
      {adminActivities.newActivityOpen && <NewActivityDrawer activities={adminActivities} />}
      {actionNotice && <div className="admin-toast" role="status"><span>✓</span>{actionNotice}<button aria-label="关闭提示" onClick={() => setActionNotice("")}>×</button></div>}
    </>
  );
}
