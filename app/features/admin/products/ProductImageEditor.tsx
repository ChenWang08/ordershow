"use client";
/* eslint-disable @next/next/no-img-element -- runtime product images and local previews. */

import { useState } from "react";
import { type ProductImageAsset, type ProductImageStatus } from "../../../domain/import-domain";
import { createManualProductImageAssets, productImageRelationStatus, productImageStatusForAssets } from "../../../domain/product-images";
import { ProductImageViewer } from "../../shared/components/ProductImageViewer";

const MAX_PRODUCT_IMAGES = 10;

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
      const remaining = MAX_PRODUCT_IMAGES - currentImages.length;
      if (remaining <= 0) {
        setError(`每个商品最多配置 ${MAX_PRODUCT_IMAGES} 张图片，请先删除后再添加。`);
        return;
      }
      if (files.length > remaining) {
        setError(`本次最多还能添加 ${remaining} 张图片。`);
        return;
      }
      const uploadedImages = await createManualProductImageAssets(files);
      const nextImages = [...currentImages, ...uploadedImages];
      onChange(nextImages, productImageStatusForAssets(nextImages));
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
    const confirmed = currentImages.filter((image) => productImageRelationStatus(image) === "CONFIRMED" && image.id !== id);
    const nextImages = [{ ...selected, matchStatus: "已匹配" as const, relationStatus: "CONFIRMED" as const }, ...confirmed];
    onChange(nextImages, productImageStatusForAssets(nextImages));
    setPreviewIndex(null);
  };

  const setPrimary = (id: string) => {
    const selected = currentImages.find((image) => image.id === id);
    if (!selected || productImageRelationStatus(selected) === "CANDIDATE") return;
    const nextImages = [selected, ...currentImages.filter((image) => image.id !== id)];
    onChange(nextImages, productImageStatusForAssets(nextImages));
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= currentImages.length) return;
    const nextImages = [...currentImages];
    [nextImages[index], nextImages[target]] = [nextImages[target], nextImages[index]];
    onChange(nextImages, productImageStatusForAssets(nextImages));
  };

  const confirmedCount = currentImages.filter((image) => productImageRelationStatus(image) === "CONFIRMED").length;
  const pendingCount = currentImages.length - confirmedCount;

  return (
    <div className="product-image-editor">
      {currentImages.length > 0 ? <div className="product-image-gallery">
        {currentImages.map((image, index) => {
          const pending = productImageRelationStatus(image) === "CANDIDATE";
          return <div className={`product-image-tile ${!pending && index === 0 ? "primary" : ""} ${pending ? "pending" : ""}`} key={`${image.id}-${index}`}>
            <button type="button" className="product-image-tile-preview" disabled={uploading} onClick={() => setPreviewIndex(index)}>
              <img src={image.url} alt={`${materialName} ${index + 1}`} />
              <span>{pending ? "候选图片" : index === 0 ? "主图" : `第 ${index + 1} 张`}</span>
            </button>
            <div className="product-image-tile-actions">
              {pending && <button type="button" disabled={uploading} onClick={() => confirmCandidate(image.id)}>选择此图</button>}
              {!pending && index !== 0 && <button type="button" disabled={uploading} onClick={() => setPrimary(image.id)}>设为主图</button>}
              {!pending && index > 0 && <button type="button" disabled={uploading} onClick={() => moveImage(index, -1)}>前移</button>}
              {!pending && index < currentImages.length - 1 && <button type="button" disabled={uploading} onClick={() => moveImage(index, 1)}>后移</button>}
              <button type="button" className="danger" disabled={uploading} onClick={() => removeImage(image.id)}>{pending ? "排除候选" : "删除"}</button>
            </div>
          </div>;
        })}
      </div> : <div className="product-image-editor-empty"><i>暂无图片</i><span>可以添加多张商品图片</span></div>}
      <div className="product-image-editor-actions">
        <label className="product-image-upload-button"><input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" disabled={uploading || currentImages.length >= MAX_PRODUCT_IMAGES} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void handleFiles(files); }} />{uploading ? "读取中…" : "添加图片"}</label>
      </div>
      <small className="product-image-editor-hint">{currentImages.length ? `已配置 ${currentImages.length} 张 · 主图 ${confirmedCount > 0 ? "1" : "待选择"}${pendingCount > 0 ? ` · 待确认 ${pendingCount} 张` : ""}` : "未匹配"} · 最多 {MAX_PRODUCT_IMAGES} 张 · 单张不超过 10MB</small>
      {error && <small className="product-image-editor-error">{error}</small>}
      {previewIndex !== null && currentImages.length > 0 && <ProductImageViewer productName={materialName} images={currentImages} initialIndex={previewIndex} status={`${currentImages.length} 张`} onClose={() => setPreviewIndex(null)} />}
    </div>
  );
}
