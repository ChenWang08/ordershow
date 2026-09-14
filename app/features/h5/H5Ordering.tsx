"use client";

import { useState } from "react";
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

export function H5Ordering(props: H5Props) {
  const model = useH5OrderFlow(props);
  const { previewProduct, setPreviewProduct } = model;
  const [imagePreviewProduct, setImagePreviewProduct] = useState<Product | null>(null);
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
          {previewProduct && <H5ProductDetailSheet product={previewProduct} onClose={() => setPreviewProduct(null)} onViewImages={previewProduct.imageUrls?.length ? () => { setImagePreviewProduct(previewProduct); setPreviewProduct(null); } : undefined} />}
          {imagePreviewProduct && <ProductImageViewer contained allowZoom={false} productName={imagePreviewProduct.name} images={(imagePreviewProduct.imageUrls ?? []).map((url, index) => ({ url, fileName: `${imagePreviewProduct.name} · 第 ${index + 1} 张` }))} onClose={() => setImagePreviewProduct(null)} />}
        </div>
      </div>
    </div>
  );
}
