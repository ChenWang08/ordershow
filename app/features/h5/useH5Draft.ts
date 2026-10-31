"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OrderChangeRequest, RuntimeActivity, RuntimeIdentity, RuntimeOrder } from "../../api";
import { formatBeijingTime } from "../shared/time";
import { h5QuantitySignature, type Product } from "./h5-domain";
import { createH5LocalDraftStore, h5DraftBaseline, h5DraftBaseItems, h5LocalDraftKey, type H5DraftContext, type H5DraftItems } from "./h5-local-draft";

type DraftOptions = {
  activityClosed: boolean;
  editing: boolean;
  paused: boolean;
  catalog: Product[];
  quantities: Record<string, number>;
  runtimeActivity: RuntimeActivity | null;
  runtimeIdentity: RuntimeIdentity | null;
  runtimeOrder: RuntimeOrder | null;
  request: OrderChangeRequest | null;
};
type Snapshot = { context: H5DraftContext; items: H5DraftItems; signature: string; baseSignature: string };
const STORAGE_WARNING = "当前浏览器无法保存草稿，仍可继续订货；刷新或关闭页面后，未提交修改可能丢失。";

export function useH5Draft({ activityClosed, editing, paused, catalog, quantities, runtimeActivity, runtimeIdentity, runtimeOrder, request }: DraftOptions) {
  const [draftMessage, setDraftMessage] = useState("");
  const [store] = useState(() => createH5LocalDraftStore({ storage: () => typeof window === "undefined" ? undefined : window.localStorage }));
  const owner = useRef<H5DraftContext | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const savedSignature = useRef("");
  const timer = useRef<number | null>(null);
  const cancelTimer = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const flushDraft = useCallback((showStatus = true) => {
    cancelTimer();
    const snapshot = latest.current;
    if (!snapshot || snapshot.signature === savedSignature.current) return true;
    const saved = snapshot.signature === snapshot.baseSignature ? store.remove(snapshot.context) : store.save(snapshot.context, snapshot.items);
    if (saved) savedSignature.current = snapshot.signature;
    if (showStatus) setDraftMessage(saved ? snapshot.signature === snapshot.baseSignature ? "未提交修改已清除" : "草稿已保存在本机浏览器" : STORAGE_WARNING);
    return saved;
  }, [cancelTimer, store]);
  const discardDraft = useCallback((nextContext = owner.current) => {
    cancelTimer();
    const saved = nextContext ? store.remove(nextContext) : true;
    owner.current = nextContext;
    latest.current = null;
    savedSignature.current = nextContext ? h5QuantitySignature(h5DraftBaseItems(nextContext.order, nextContext.request)) : "";
    if (!saved) setDraftMessage(STORAGE_WARNING);
    return saved;
  }, [cancelTimer, store]);
  const resetDraft = useCallback(() => {
    const saved = flushDraft(false);
    owner.current = null; latest.current = null; savedSignature.current = "";
    return saved;
  }, [flushDraft]);
  const hasDraftChanges = useCallback(() => Boolean(latest.current && latest.current.signature !== latest.current.baseSignature), []);
  const restoreDraft = useCallback((context: H5DraftContext, liveCatalog: Product[], canRestore: boolean) => {
    cancelTimer();
    owner.current = context; latest.current = null;
    savedSignature.current = h5QuantitySignature(h5DraftBaseItems(context.order, context.request));
    // Uncertain submissions must be resolved before any saved cart can become editable.
    if (!canRestore) { setDraftMessage(""); return null; }
    const { draft, reason, persistent } = store.read(context);
    if (!draft) {
      setDraftMessage(!persistent ? STORAGE_WARNING : reason === "stale" ? "订单或申请已更新，旧草稿未恢复，已加载最新内容。"
        : reason === "expired" ? "本机草稿已过期，未恢复。" : reason === "invalid" ? "本机草稿不可用，已加载最新内容。" : "");
      return null;
    }
    const available = new Set(liveCatalog.filter(product => product.isOrderable).map(product => Number(product.id)));
    const items = draft.items.filter(item => available.has(item.productId));
    latest.current = { context, items, signature: h5QuantitySignature(items), baseSignature: savedSignature.current };
    savedSignature.current = persistent ? h5QuantitySignature(draft.items) : "";
    setDraftMessage(!persistent ? STORAGE_WARNING : `已恢复 ${formatBeijingTime(new Date(draft.updatedAt).toISOString())} 保存的本机草稿${items.length < draft.items.length ? "；部分商品已不可订购，已移除，请核对。" : ""}`);
    return Object.fromEntries(items.map(item => [String(item.productId), item.quantity]));
  }, [cancelTimer, store]);

  useEffect(() => {
    cancelTimer();
    if (!runtimeIdentity || !runtimeActivity || !owner.current
      || h5LocalDraftKey(owner.current) !== h5LocalDraftKey({ ...runtimeIdentity, activityCode: runtimeActivity.code })) return;
    if (activityClosed || Date.parse(runtimeActivity.endsAt) <= Date.now()) {
      discardDraft();
      return;
    }
    if (!editing || paused || h5DraftBaseline(owner.current.order, owner.current.request) !== h5DraftBaseline(runtimeOrder, request)) return;
    const context: H5DraftContext = { ...runtimeIdentity, activityCode: runtimeActivity.code, endsAt: runtimeActivity.endsAt, order: runtimeOrder, request };
    const items = catalog.filter(product => product.isOrderable && (quantities[product.id] || 0) > 0)
      .map(product => ({ productId: Number(product.id), quantity: quantities[product.id] }));
    latest.current = { context, items, signature: h5QuantitySignature(items), baseSignature: h5QuantitySignature(h5DraftBaseItems(runtimeOrder, request)) };
    if (latest.current.signature !== savedSignature.current) timer.current = window.setTimeout(() => flushDraft(), 800);
    return cancelTimer;
  }, [activityClosed, editing, paused, catalog, quantities, runtimeActivity, runtimeIdentity, runtimeOrder, request, cancelTimer, discardDraft, flushDraft]);

  useEffect(() => {
    const flush = () => { flushDraft(); };
    const hide = () => { if (document.hidden) flushDraft(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hide);
      flushDraft(false);
    };
  }, [flushDraft]);
  return { draftMessage, setDraftMessage, restoreDraft, flushDraft, discardDraft, resetDraft, hasDraftChanges };
}
