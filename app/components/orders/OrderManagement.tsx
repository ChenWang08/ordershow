"use client";
import { useEffect, useState } from "react";

import type { OrderManagementProps } from "./order-domain";
import { useOrderList } from "./useOrderList";
import { useOrderEditor } from "./useOrderEditor";
import { OrderFilterBar } from "./OrderFilterBar";
import { OrderListTable } from "./OrderListTable";
import { OrderDetailDrawer } from "./OrderDetailDrawer";
import { OrderEditorDrawer } from "./OrderEditorDrawer";
import { OrderChangeRequestPanel } from "./OrderChangeRequestPanel";
import { useOrderChangeRequests } from "./useOrderChangeRequests";
import { useAdminIdentity } from "../../admin-context";
import { useOrderExports } from "./useOrderExports";
import { OrderExportPanel } from "./OrderExportPanel";
import { useOrderSummary } from "./useOrderSummary";
import { useManualRefresh } from "../../features/shared/useManualRefresh";

export type OrderManagementModel = OrderManagementProps & ReturnType<typeof useOrderList> & ReturnType<typeof useOrderEditor>
  & { changeRequests: ReturnType<typeof useOrderChangeRequests>; refreshOrders: () => void;
    summary: ReturnType<typeof useOrderSummary>; orderCounts: ReturnType<typeof useOrderSummary>["data"]; refreshReview: () => void;
    ordersCoolingDown: boolean; reviewCoolingDown: boolean;
    canExport: boolean; exports: ReturnType<typeof useOrderExports> };

type Props = OrderManagementProps & { active?: boolean; revision?: number; onChanged?: () => void; onDirtyChange?: (dirty: boolean) => void };

export function OrderManagement(props: Props) {
  return <OrderWorkbench key={props.activityId} {...props} />;
}

function OrderWorkbench(props: Props) {
  const [tab,setTab]=useState<"orders"|"review">("orders");
  const list = useOrderList(props.activityId, props.activityName, (props.active ?? true) && tab === "orders", props.revision);
  const summary = useOrderSummary(props.activityId, props.active ?? true, tab, props.revision, list.reloadKey);
  const identity = useAdminIdentity();
  const canExport = identity?.roleCode === "SUPER_ADMIN";
  const exports = useOrderExports(props.activityId, identity?.id, canExport && Boolean(props.activityFinished), (props.active ?? true) && tab === "orders", {
    status: list.orderFilter === "已提交" ? "SUBMITTED" : list.orderFilter === "已撤回" ? "WITHDRAWN" : list.orderFilter === "已作废" ? "VOIDED" : null,
    customerType: list.customerType === "综合" ? "GENERAL" : list.customerType === "特渠" ? "SPECIAL" : list.customerType === "不区分客户类型" ? "ALL" : null,
    keyword: list.search,
  });
  const changed: typeof list.setReloadKey = value => { list.setReloadKey(value); props.onChanged?.(); };
  const editor = useOrderEditor({ activityId: props.activityId, selected: list.selected, setOrders: list.setOrders,
    setLoadError: list.setLoadError, setSelectedNo: list.setSelectedNo, setReloadKey: changed });
  const changeRequests = useOrderChangeRequests(props.activityId, () => changed((value) => value + 1), (props.active ?? true) && tab === "review", props.revision);
  const dirty = Boolean(editor.editorMode || changeRequests.reason.trim());
  const onDirtyChange = props.onDirtyChange;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const ordersRefresh = useManualRefresh(`${props.activityId}:orders`, list.loading || summary.loading,
    () => list.setReloadKey(value => value + 1));
  const reviewRefresh = useManualRefresh(`${props.activityId}:review`, changeRequests.loading || summary.loading,
    () => Promise.all([changeRequests.reload(), summary.refresh()]));
  const model = { ...props, ...list, setReloadKey: changed, ...editor, changeRequests, canExport, exports, summary, orderCounts: summary.data,
    ordersCoolingDown: ordersRefresh.coolingDown, reviewCoolingDown: reviewRefresh.coolingDown,
    refreshOrders: () => { void ordersRefresh.refresh(); },
    refreshReview: () => { void reviewRefresh.refresh(); } };
  return <div className="admin-panel order-management-panel">
    <nav className="order-workbench-tabs"><button className={tab==="orders"?"active":""} onClick={()=>setTab("orders")}>订单列表</button><button className={tab==="review"?"active":""} onClick={()=>setTab("review")}>变更审核 <b title="进入页面、手动刷新或操作完成后更新">{summary.data?.pending ?? "—"}</b></button></nav>
    {summary.loading && <p role="status">正在更新数量…</p>}
    {summary.error && <div className="warning-box" role="alert"><span>数量更新失败{summary.data ? "，当前显示上次读取的数量" : ""}：{summary.error}</span><button disabled={summary.loading} onClick={() => void summary.refresh()}>重试数量</button></div>}
    {tab==="orders" ? <><OrderFilterBar model={model} /><OrderExportPanel model={model} /><OrderListTable model={model} /></> : <OrderChangeRequestPanel model={model} />}
    {tab==="orders" && changeRequests.selected && <OrderChangeRequestPanel model={model} detailOnly />}
    <OrderDetailDrawer model={model} />
    {!props.readOnly && <OrderEditorDrawer model={model} />}
  </div>;
}
