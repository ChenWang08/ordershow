"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, loadAdminOrders, loadAdminOrder, exportAdminOrders } from "../../api";
import { toOrderRecord, type OrderRecord, type OrderStatus, type CustomerType } from "./order-domain";

export function useOrderList(activityId: number, activityName: string, enabled = true, revision = 0) {
  const detailController = useRef<AbortController | null>(null);
  useEffect(() => () => { detailController.current?.abort(); }, [activityId, enabled]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [orderCounts, setOrderCounts] = useState({ all: 0, submitted: 0, withdrawn: 0, voided: 0 });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [orderFilter, setOrderFilter] = useState<"全部" | OrderStatus>("全部");
  const [customerType, setCustomerType] = useState<"全部" | CustomerType>("全部");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedNo, setSelectedNo] = useState<string | null>(null);
  const [linkedOrder, setLinkedOrder] = useState<OrderRecord | null>(null);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
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
        const [current, all, submitted, withdrawn, voided] = await Promise.all([
          loadAdminOrders(activityId, { status, customerType: runtimeCustomerType, keyword: search, page, size: 50 }, controller.signal),
          loadAdminOrders(activityId, { page: 1, size: 1 }, controller.signal),
          loadAdminOrders(activityId, { status: "SUBMITTED", page: 1, size: 1 }, controller.signal),
          loadAdminOrders(activityId, { status: "WITHDRAWN", page: 1, size: 1 }, controller.signal),
          loadAdminOrders(activityId, { status: "VOIDED", page: 1, size: 1 }, controller.signal),
        ]);
        if (!active) return;
        setOrders(current.data.map(toOrderRecord));
        setTotalPages(Math.max(1, current.page.totalPages));
        setOrderCounts({ all: all.page.totalElements, submitted: submitted.page.totalElements, withdrawn: withdrawn.page.totalElements, voided: voided.page.totalElements });
        setLoadError("");
      } catch (reason) {
        if (active) setLoadError(reason instanceof ApiError ? reason.message : "订单数据加载失败");
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activityId, customerType, orderFilter, page, reloadKey, search, enabled, revision]);

  const filteredOrders = useMemo(() => orders.filter((order) => {
    const keyword = search.trim();
    const digits = keyword.replace(/\D/g, "");
    const matchesPhone = Boolean(keyword) && (order.dealerPhone.includes(keyword) || (digits.length > 0 && order.dealerPhone.includes(digits)));
    return (orderFilter === "全部" || order.status === orderFilter)
      && (customerType === "全部" || order.type === customerType)
      && (!keyword || order.no.includes(keyword) || order.dealer.includes(keyword) || matchesPhone);
  }), [customerType, orderFilter, orders, search]);

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
      setOrders((current) => current.map((item) => item.no === order.no ? detail : item));
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

  const exportOrders = () => exportAdminOrders(activityId, {
    status: orderFilter === "已提交" ? "SUBMITTED" : orderFilter === "已撤回" ? "WITHDRAWN" : orderFilter === "已作废" ? "VOIDED" : undefined,
    customerType: customerType === "综合" ? "GENERAL" : customerType === "特渠" ? "SPECIAL" : customerType === "不区分客户类型" ? "ALL" : undefined,
    keyword: search,
  }, activityName);


  const operationRecords = selected?.operationRecords ?? [];
  return { selected, setSelectedNo, expandedVersion, setExpandedVersion, orderCounts, loading, loadError, setLoadError, orderFilter, setOrderFilter, customerType, setCustomerType, search, setSearch, page, setPage, totalPages, filteredOrders, openOrder, openOrderById, exportOrders, operationRecords, setOrders, setReloadKey };
}
