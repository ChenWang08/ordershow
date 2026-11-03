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

export type OrderManagementModel = OrderManagementProps & ReturnType<typeof useOrderList> & ReturnType<typeof useOrderEditor>
  & { changeRequests: ReturnType<typeof useOrderChangeRequests>; refreshOrders: () => void };

export function OrderManagement(props: OrderManagementProps & { readOnly?: boolean; active?: boolean; revision?: number; onChanged?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [tab,setTab]=useState<"orders"|"review">("orders");
  const list = useOrderList(props.activityId, props.activityName, (props.active ?? true) && tab === "orders", props.revision);
  const changed: typeof list.setReloadKey = value => { list.setReloadKey(value); props.onChanged?.(); };
  const editor = useOrderEditor({ activityId: props.activityId, selected: list.selected, setOrders: list.setOrders,
    setLoadError: list.setLoadError, setSelectedNo: list.setSelectedNo, setReloadKey: changed });
  const changeRequests = useOrderChangeRequests(props.activityId, () => changed((value) => value + 1), (props.active ?? true) && tab === "review", props.revision);
  const dirty = Boolean(editor.editorMode || changeRequests.reason.trim());
  const onDirtyChange = props.onDirtyChange;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const model = { ...props, ...list, setReloadKey: changed, ...editor, changeRequests,
    refreshOrders: () => list.setReloadKey(value => value + 1) };
  return <div className="admin-panel order-management-panel">
    <nav className="order-workbench-tabs"><button className={tab==="orders"?"active":""} onClick={()=>setTab("orders")}>订单列表</button><button className={tab==="review"?"active":""} onClick={()=>setTab("review")}>变更审核 <b title="进入审核页或刷新后更新">{changeRequests.loaded ? changeRequests.pending.length : "—"}</b></button></nav>
    {tab==="orders" ? <><OrderFilterBar model={model} /><OrderListTable model={model} /></> : <OrderChangeRequestPanel model={model} />}
    {tab==="orders" && changeRequests.selected && <OrderChangeRequestPanel model={model} detailOnly />}
    <OrderDetailDrawer model={model} />
    {!props.readOnly && <OrderEditorDrawer model={model} />}
  </div>;
}
