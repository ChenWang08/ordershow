"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, deleteH5OrderDraft, saveH5OrderDraft, type RuntimeIdentity, type RuntimeOrder } from "../../api";
import { h5QuantitySignature, h5OrderItems, type Product, type H5DraftSnapshot } from "./h5-domain";

type DraftOptions = { activityClosed: boolean; catalog: Product[]; quantities: Record<string, number>; runtimeIdentity: RuntimeIdentity | null; runtimeOrder: RuntimeOrder | null };

export function useH5Draft({ activityClosed, catalog, quantities, runtimeIdentity, runtimeOrder }: DraftOptions) {
  const [draftReady, setDraftReady] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const draftOwnerIdRef = useRef<number | null>(null);
  const lastSavedDraftSignatureRef = useRef("");
  const latestDraftSnapshotRef = useRef<H5DraftSnapshot | null>(null);
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const queueDraftSync = (snapshot: H5DraftSnapshot, showStatus = true) => {
    draftSaveChainRef.current = draftSaveChainRef.current.catch(() => undefined).then(async () => {
      if (draftOwnerIdRef.current !== snapshot.customerId || lastSavedDraftSignatureRef.current === snapshot.signature) return;
      if (showStatus) setDraftMessage("正在自动保存草稿…");
      if (snapshot.signature === snapshot.baseSignature) {
        await deleteH5OrderDraft(snapshot.customerId);
      } else {
        await saveH5OrderDraft(snapshot.customerId, snapshot.baseOrderVersion, snapshot.items);
      }
      if (draftOwnerIdRef.current === snapshot.customerId) {
        lastSavedDraftSignatureRef.current = snapshot.signature;
        if (showStatus) setDraftMessage(snapshot.signature === snapshot.baseSignature ? "未提交修改已清除" : "草稿已自动保存");
      }
    }).catch((error) => {
      if (draftOwnerIdRef.current === snapshot.customerId && showStatus) {
        setDraftMessage(error instanceof ApiError ? `草稿保存失败：${error.message}` : "草稿保存失败，请检查网络");
      }
    });
    return draftSaveChainRef.current;
  };

  useEffect(() => {
    if (!draftReady || !runtimeIdentity || activityClosed) return;
    const items = catalog.filter((product) => product.isOrderable && (quantities[product.id] || 0) > 0)
      .map((product) => ({ productId: Number(product.id), quantity: quantities[product.id] }));
    const snapshot = {
      customerId: runtimeIdentity.customerId,
      baseOrderVersion: runtimeOrder?.currentVersion || 0,
      baseSignature: h5QuantitySignature(h5OrderItems(runtimeOrder)),
      signature: h5QuantitySignature(items),
      items,
    };
    latestDraftSnapshotRef.current = snapshot;
    if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
    if (snapshot.signature !== lastSavedDraftSignatureRef.current) {
      draftSaveTimerRef.current = window.setTimeout(() => void queueDraftSync(snapshot), 800);
    }
    return () => {
      if (draftSaveTimerRef.current != null) window.clearTimeout(draftSaveTimerRef.current);
    };
  }, [activityClosed, catalog, draftReady, quantities, runtimeIdentity, runtimeOrder]);

  useEffect(() => {
    const flushOnPageHide = () => {
      const snapshot = latestDraftSnapshotRef.current;
      if (!snapshot || snapshot.signature === lastSavedDraftSignatureRef.current) return;
      if (snapshot.signature === snapshot.baseSignature) void deleteH5OrderDraft(snapshot.customerId, true);
      else void saveH5OrderDraft(snapshot.customerId, snapshot.baseOrderVersion, snapshot.items, true);
    };
    window.addEventListener("pagehide", flushOnPageHide);
    return () => window.removeEventListener("pagehide", flushOnPageHide);
  }, []);

  return { draftReady, setDraftReady, draftMessage, setDraftMessage, draftOwnerIdRef, lastSavedDraftSignatureRef, latestDraftSnapshotRef, draftSaveTimerRef, draftSaveChainRef, queueDraftSync };
}
