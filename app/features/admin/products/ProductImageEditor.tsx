"use client";
/* eslint-disable @next/next/no-img-element -- runtime product images and local previews. */

import { useState } from "react";
import { type ProductImageAsset, type ProductImageStatus } from "../../../domain/import-domain";
import { createManualProductImageAssets, productImageRelationStatus, productImageStatusForAssets } from "../../../domain/product-images";
import { ProductImageViewer } from "../../shared/components/ProductImageViewer";

export function ProductImageEditor({ materialName, images, onChange }: { materialName: string; images?: ProductImageAsset[]; imageStatus?: ProductImageStatus; onChange: (images: ProductImageAsset[] | undefined, status: ProductImageStatus) => void }) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const currentImages = images ?? [];
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError("");
    setUploading(true);
    try {
      const uploadedImages = await createManualProductImageAssets(files.slice(0, 1));
      const nextImages = uploadedImages.slice(0, 1);
      onChange(nextImages, "已匹配");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "图片上传失败，请重新选择。" );
    } finally {
      setUploading(false);
    }
  };
  const removeImage = (id: string) => {
    const nextImages = currentImages.filter((image) => image.id !== id);
    onChange(nextImages.length > 0 ? nextImages : undefined, productImageStatusForAssets(nextImages));
    setPreviewIndex((current) => current === null ? null : Math.min(current, Math.max(0, nextImages.length - 1)));
  };
  const confirmCandidate = (id: string) => {
    const selected = currentImages.find((image) => image.id === id);
    if (!selected) return;
    onChange([{ ...selected, matchStatus: "已匹配", relationStatus: "CONFIRMED" }], "已匹配");
    setPreviewIndex(null);
  };
  return (
    <div className="product-image-editor">
      {currentImages.length > 0 ? <div className="product-image-gallery">
        {currentImages.map((image, index) => { const pending = productImageRelationStatus(image) === "CANDIDATE"; return <div className={`product-image-tile ${!pending && index === 0 ? "primary" : ""} ${pending ? "pending" : ""}`} key={`${image.id}-${index}`}>
          <button type="button" className="product-image-tile-preview" disabled={uploading} onClick={() => setPreviewIndex(index)}>
            <img src={image.url} alt={`${materialName} ${index + 1}`} />
            <span>{pending ? "候选图片" : index === 0 ? "主图" : `第 ${index + 1} 张`}</span>
          </button>
          <div className="product-image-tile-actions">
            {pending && <button type="button" disabled={uploading} onClick={() => confirmCandidate(image.id)}>选择此图</button>}
            <button type="button" className="danger" disabled={uploading} onClick={() => removeImage(image.id)}>{pending ? "排除候选" : "删除"}</button>
          </div>
        </div>; })}
      </div> : <div className="product-image-editor-empty"><i>暂无图片</i><span>可以上传一张商品图片</span></div>}
      <div className="product-image-editor-actions">
        <label className="product-image-upload-button"><input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" disabled={uploading} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void handleFiles(files); }} />{uploading ? "读取中…" : currentImages.length > 0 ? "替换图片" : "上传图片"}</label>
      </div>
      <small className="product-image-editor-hint">{currentImages.length > 1 ? `待确认 ${currentImages.length} 张候选，请选择一张` : currentImages.length === 1 ? (productImageRelationStatus(currentImages[0]) === "CONFIRMED" ? "已匹配 1 张" : "待确认 1 张") : "未匹配"} · 每个商品只保留一张图片 · 不超过 10MB</small>
      {error && <small className="product-image-editor-error">{error}</small>}
      {previewIndex !== null && currentImages.length > 0 && <ProductImageViewer productName={materialName} images={currentImages} initialIndex={previewIndex} status={`${currentImages.length} 张`} onClose={() => setPreviewIndex(null)} />}
    </div>
  );
}
