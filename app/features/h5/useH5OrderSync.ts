"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadH5Order, loadH5OrderChangeRequest, type OrderChangeRequest, type RuntimeOrder } from "../../api";

export type H5OrderSnapshot = { order: RuntimeOrder | null; request: OrderChangeRequest | null };
type Scope = { activityCode: string; customerId: number };
const COOLDOWN_MS = 15_000;

// Both reads must describe the same order version before they can be used for editing.
export async function readH5OrderSnapshot(activityCode: string, signal?: AbortSignal): Promise<H5OrderSnapshot> {
  const options = { activityCode, signal };
  const order = await loadH5Order(options);
  signal?.throwIfAborted();
  const request = order ? await loadH5OrderChangeRequest(options) : null;
  if (request && (!order || request.orderId !== order.id || request.currentVersion !== order.currentVersion
      || (request.status === "PENDING" && (request.baseVersion !== order.currentVersion
        || (request.originalOrder && request.originalOrder.lockVersion !== order.lockVersion))))) {
    throw new Error("订单正在更新，请重新刷新后再操作。");
  }
  // An old rejected application must not replace a newer effective order.
  const visibleRequest = request?.status === "APPROVED" || (request?.status === "REJECTED"
    && (request.baseVersion !== order?.currentVersion
      || (request.originalOrder && request.originalOrder.lockVersion !== order?.lockVersion))) ? null : request;
  return { order, request: visibleRequest };
}

export function sameH5Order(left: RuntimeOrder | null, right: RuntimeOrder | null) {
  return left?.id === right?.id && left?.currentVersion === right?.currentVersion
    && left?.lockVersion === right?.lockVersion && left?.status === right?.status;
}

export function useH5OrderSync() {
  const [busy, setBusy] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const deadline = useRef(0);
  const flight = useRef<{ key: string; controller: AbortController; promise: Promise<H5OrderSnapshot | null> } | null>(null);
  const mounted = useRef(true);

  const reset = useCallback(() => {
    flight.current?.controller.abort();
    flight.current = null;
    deadline.current = 0;
    setBusy(false); setLastSuccessAt(null);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; flight.current?.controller.abort(); flight.current = null; };
  }, []);
  const markSynced = useCallback(() => {
    const time = Date.now();
    deadline.current = time + COOLDOWN_MS;
    setLastSuccessAt(time);
  }, []);
  const readLatest = useCallback((scope: Scope, force = false): Promise<H5OrderSnapshot | null> => {
    const key = `${scope.activityCode}:${scope.customerId}`;
    if (flight.current?.key === key) return flight.current.promise;
    if (flight.current) flight.current.controller.abort();
    if (!force && Date.now() < deadline.current) return Promise.resolve(null);
    const time = Date.now();
    deadline.current = time + COOLDOWN_MS;
    setBusy(true);
    const controller = new AbortController();
    const promise = readH5OrderSnapshot(scope.activityCode, controller.signal).then(snapshot => {
      if (!mounted.current || controller.signal.aborted) return null;
      if (snapshot.order && snapshot.order.activityCustomerId !== scope.customerId) {
        throw new Error("客户身份已变化，请返回活动首页重新验证手机号。");
      }
      return snapshot;
    }).catch(error => {
      if (controller.signal.aborted || !mounted.current) return null;
      throw error;
    }).finally(() => {
      if (flight.current?.controller === controller) {
        flight.current = null;
        if (mounted.current) setBusy(false);
      }
    });
    flight.current = { key, controller, promise };
    return promise;
  }, []);
  const confirmSynced = useCallback(() => setLastSuccessAt(Date.now()), []);
  return { busy, lastSuccessAt, readLatest, markSynced, confirmSynced, reset };
}
