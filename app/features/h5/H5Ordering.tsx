"use client";

import { FestivalDecor } from "../shared/components/FestivalDecor";
import { ProductImageViewer } from "../shared/components/ProductImageViewer";
import type { H5Props } from "./h5-domain";
import { useH5OrderFlow } from "./useH5OrderFlow";
import { H5EntryPages } from "./H5EntryPages";
import { H5CatalogPage } from "./H5CatalogPage";
import { H5ConfirmPage } from "./H5ConfirmPage";
import { H5SubmittedPage } from "./H5SubmittedPage";
import { H5ResultPages } from "./H5ResultPages";

export function H5Ordering(props: H5Props) {
  const model = useH5OrderFlow(props);
  const { previewProduct, setPreviewProduct } = model;
  return (
    <div className="h5-stage">
      <div className="device-caption">
        <span>客户订货 H5</span>
        <small>手机端 · 实时业务数据</small>
      </div>
      <div className="phone-shell">
        <div className="phone-screen">
          <FestivalDecor />
          <H5EntryPages model={model} />
          <H5CatalogPage model={model} />
          <H5ConfirmPage model={model} />
          <H5SubmittedPage model={model} />
          <H5ResultPages model={model} />
        </div>
      </div>
      {previewProduct && <ProductImageViewer productName={previewProduct.name} images={(previewProduct.imageUrls ?? []).map((url, index) => ({ url, fileName: `${previewProduct.name} · 第 ${index + 1} 张` }))} onClose={() => setPreviewProduct(null)} />}
    </div>
  );
}
