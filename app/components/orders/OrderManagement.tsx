"use client";

import type { OrderManagementProps } from "./order-domain";
import { useOrderList } from "./useOrderList";
import { useOrderEditor } from "./useOrderEditor";
import { OrderFilterBar } from "./OrderFilterBar";
import { OrderListTable } from "./OrderListTable";
import { OrderDetailDrawer } from "./OrderDetailDrawer";
import { OrderEditorDrawer } from "./OrderEditorDrawer";

export type OrderManagementModel = OrderManagementProps & ReturnType<typeof useOrderList> & ReturnType<typeof useOrderEditor>;

export function OrderManagement(props: OrderManagementProps) {
  const list = useOrderList(props.activityId, props.activityName);
  const editor = useOrderEditor({ activityId: props.activityId, selected: list.selected, setOrders: list.setOrders,
    setLoadError: list.setLoadError, setSelectedNo: list.setSelectedNo, setReloadKey: list.setReloadKey });
  const model = { ...props, ...list, ...editor };
  return <div className="admin-panel order-management-panel">
    <OrderFilterBar model={model} />
    <OrderListTable model={model} />
    <OrderDetailDrawer model={model} />
    <OrderEditorDrawer model={model} />
  </div>;
}
