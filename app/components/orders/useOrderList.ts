"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, loadAdminOrders, loadAdminOrder } from "../../api";
import { toOrderRecord, type OrderRecord, type OrderStatus, type CustomerType } from "./order-domain";

export function useOrderList(activityId: number, _activityName: string, enabled = true, revision = 0) {
  const detailController = useRef<AbortController | null>(null);
  useEffect(() => () => { detailController.current?.abort(); }, [activityId, enabled]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [orderFilter, setOrderFilter] = useState<"全部" | OrderStatus>("全部");
  const [customerType, setCustomerType] = useState<"全部" | CustomerType>("全部");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ scope: "", totalPages: 1, total: 0 });
  const [loadedKey, setLoadedKey] = useState("");
  const [completedKey, setCompletedKey] = useState("");
  const [selectedNo, setSelectedNo] = useState<string | null>(null);
  const [linkedOrder, setLinkedOrder] = useState<OrderRecord | null>(null);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const scope = JSON.stringify([activityId, customerType, orderFilter, search.trim()]);
  const pageKey = JSON.stringify([scope, page]);
  const requestKey = JSON.stringify([pageKey, revision, reloadKey]);
  const totalPages = pagination.scope === scope ? pagination.totalPages : 1;
  const total = pagination.scope === scope ? pagination.total : 0;
  const listedOrder = orders.find((order) => order.no === selectedNo);
  const selected = linkedOrder?.no === selectedNo && (!listedOrder || linkedOrder.lockVersion >= listedOrder.lockVersion)
    ? linkedOrder : listedOrder ?? null;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const status = orderFilter === "已提交" ? "SUBMITTED" : orderFilter === "已撤回" ? "WITHDRAWN" : orderFilter === "已作废" ? "VOIDED" : undefined;
        const runtimeCustomerType = customerType === "综合" ? "GENERAL" : customerType === "特渠" ? "SPECIAL" : customerType === "不区分客户类型" ? "ALL" : undefined;
        const current = await loadAdminOrders(activityId, { status, customerType: runtimeCustomerType, keyword: search, page, size: 50 }, controller.signal);
        if (!active) return;
        const pages = Math.max(1, current.page.totalPages);
        setPagination({ scope, totalPages: pages, total: current.page.totalElements });
        if (page > pages) { setPage(pages); return; }
        setOrders(current.data.map(toOrderRecord));
        setLoadedKey(pageKey);
        setLoadError("");
      } catch (reason) {
        if (active) setLoadError(reason instanceof ApiError ? reason.message : "订单数据加载失败");
      } finally {
        if (active) { setLoading(false); setCompletedKey(requestKey); }
      }
    }, 250);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activityId, customerType, orderFilter, page, reloadKey, search, enabled, revision, scope, pageKey, requestKey]);

  const filteredOrders = loadedKey === pageKey ? orders : [];

  const openOrder = async (order: OrderRecord) => {
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    setLinkedOrder(null);
    setSelectedNo(order.no);
    setExpandedVersion(null);
    if (!order.id) return;
    try {
      const detail = toOrderRecord(await loadAdminOrder(activityId, order.id, controller.signal));
      if (controller.signal.aborted) return;
      setOrders((current) => current.map((item) => item.no === order.no ? { ...detail, pendingChangeRequestId: item.pendingChangeRequestId } : item));
    } catch (reason) {
      if (!controller.signal.aborted) setLoadError(reason instanceof ApiError ? reason.message : "订单详情加载失败");
    }
  };

  const openOrderById = async (id: number) => {
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    try {
      const detail = toOrderRecord(await loadAdminOrder(activityId,id,controller.signal));
      if (controller.signal.aborted) return false;
      setLinkedOrder(detail); setSelectedNo(detail.no); setExpandedVersion(null);
      return true;
    } catch (reason) {
      if (!controller.signal.aborted) setLoadError(reason instanceof ApiError ? reason.message : "订单详情加载失败");
      return false;
    }
  };

  const operationRecords = selected?.operationRecords ?? [];
  return { selected, setSelectedNo, expandedVersion, setExpandedVersion, loading: enabled && (loading || completedKey !== requestKey), loadError, setLoadError, orderFilter, setOrderFilter, customerType, setCustomerType, search, setSearch, page, setPage, totalPages, total, filteredOrders, openOrder, openOrderById, operationRecords, setOrders, reloadKey, setReloadKey };
}
