"use client";
import { useState } from "react";

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
  & { changeRequests: ReturnType<typeof useOrderChangeRequests> };

export function OrderManagement(props: OrderManagementProps) {
  const [tab,setTab]=useState<"orders"|"review">("orders");
  const list = useOrderList(props.activityId, props.activityName);
  const editor = useOrderEditor({ activityId: props.activityId, selected: list.selected, setOrders: list.setOrders,
    setLoadError: list.setLoadError, setSelectedNo: list.setSelectedNo, setReloadKey: list.setReloadKey });
  const changeRequests = useOrderChangeRequests(props.activityId, () => list.setReloadKey((value) => value + 1));
  const model = { ...props, ...list, ...editor, changeRequests };
  return <div className="admin-panel order-management-panel">
    <nav className="order-workbench-tabs"><button className={tab==="orders"?"active":""} onClick={()=>setTab("orders")}>订单列表</button><button className={tab==="review"?"active":""} onClick={()=>setTab("review")}>变更审核 <b>{changeRequests.pending.length}</b></button></nav>
    {tab==="orders" ? <><OrderFilterBar model={model} /><OrderListTable model={model} /></> : <OrderChangeRequestPanel model={model} />}
    {tab==="orders" && changeRequests.selected && <OrderChangeRequestPanel model={model} detailOnly />}
    <OrderDetailDrawer model={model} />
    <OrderEditorDrawer model={model} />
  </div>;
}
