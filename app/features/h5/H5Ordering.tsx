"use client";

import { useEffect, useRef, useState } from "react";
import { FestivalDecor } from "../shared/components/FestivalDecor";
import { ProductImageViewer } from "../shared/components/ProductImageViewer";
import type { H5Props } from "./h5-domain";
import type { Product } from "./h5-domain";
import { useH5OrderFlow } from "./useH5OrderFlow";
import { H5EntryPages } from "./H5EntryPages";
import { H5CatalogPage } from "./H5CatalogPage";
import { H5ConfirmPage } from "./H5ConfirmPage";
import { H5SubmittedPage } from "./H5SubmittedPage";
import { H5ResultPages } from "./H5ResultPages";
import { H5ProductDetailSheet } from "./H5ProductDetailSheet";
import { H5LiveRoomExit } from "./H5LiveRoomExit";
import { trackH5Viewport } from "./h5-viewport";

export function H5Ordering(props: H5Props) {
  const model = useH5OrderFlow(props);
  const { previewProduct, setPreviewProduct } = model;
  const [imagePreviewProduct, setImagePreviewProduct] = useState<Product | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const stop = trackH5Viewport(shell);
    // The current renderer omits viewportFit/interactiveWidget metadata fields.
    const meta = shell.closest(".standalone-h5") ? document.querySelector<HTMLMetaElement>('meta[name="viewport"]') : null;
    const original = meta?.content;
    const scrollRoots = shell.closest(".standalone-h5") ? [document.documentElement, document.body] : [];
    const scrollStyles = scrollRoots.map(root => ({ root, overflow: root.style.overflow, overscroll: root.style.overscrollBehavior }));
    scrollRoots.forEach(root => { root.style.overflow = "hidden"; root.style.overscrollBehavior = "none"; });
    if (meta) meta.content = `${original || "width=device-width, initial-scale=1"}, viewport-fit=cover, interactive-widget=resizes-content`;
    return () => {
      stop();
      if (meta && original != null) meta.content = original;
      scrollStyles.forEach(({ root, overflow, overscroll }) => { root.style.overflow = overflow; root.style.overscrollBehavior = overscroll; });
    };
  }, []);
  return (
    <div className="h5-stage">
      <div className="device-caption">
        <span>客户订货 H5</span>
        <small>手机端 · 实时业务数据</small>
      </div>
      <div className="phone-shell" ref={shellRef}>
        <div className="phone-screen">
          <FestivalDecor />
          {props.activitySyncMessage && <div className="activity-sync-status" role="status">{props.activitySyncMessage}
            {props.activityLoadFailed && <button type="button" onClick={props.retryActivity}>重试活动资料</button>}</div>}
          <H5LiveRoomExit url={props.runtimeActivity?.liveRoomUrl} disabled={model.runtimeBusy}
            prepare={model.prepareLiveRoomExit} />
          {(model.pendingSubmission || model.orderNeedsRefresh) && <div className="h5-submit-recovery" role="alert">
            <p>{model.runtimeMessage || "上次提交结果待确认，请先确认后再修改订单。"}</p>
            {model.pendingSubmission && !model.orderNeedsRefresh && <button disabled={model.runtimeBusy} onClick={() => void model.recoverSubmission()}>
              {model.runtimeBusy ? "正在确认…" : "确认上次提交结果"}
            </button>}
            {model.orderNeedsRefresh && <button disabled={model.runtimeBusy} onClick={() => void model.reloadLatestOrder()}>加载最新订单并核对</button>}
          </div>}
          <H5EntryPages model={model} activityLoadFailed={props.activityLoadFailed} />
          <H5CatalogPage model={model} />
          <H5ConfirmPage model={model} />
          <H5SubmittedPage model={model} />
          <H5ResultPages model={model} />
          {previewProduct && <H5ProductDetailSheet product={previewProduct} onClose={() => setPreviewProduct(null)} onViewImages={previewProduct.imageUrls?.length ? () => { setImagePreviewProduct(previewProduct); setPreviewProduct(null); } : undefined} />}
          {imagePreviewProduct && <ProductImageViewer contained productName={imagePreviewProduct.name} images={(imagePreviewProduct.imageUrls ?? []).map((url, index) => ({ url, fileName: `${imagePreviewProduct.name} · 第 ${index + 1} 张` }))} onClose={() => setImagePreviewProduct(null)} />}
        </div>
      </div>
    </div>
  );
}
