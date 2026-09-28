"use client";

import { useEffect } from "react";
import { money } from "../shared/utils";
import { ProductArt } from "./ProductArt";
import type { Product } from "./h5-domain";

export function H5ProductDetailSheet({ product, onClose, onViewImages }: { product: Product; onClose: () => void; onViewImages?: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="h5-product-detail-layer" role="dialog" aria-modal="true" aria-label={`${product.name}商品详情`} onClick={onClose}>
      <section className="h5-product-detail-sheet" onClick={(event) => event.stopPropagation()}>
        <header>
          <div><span>商品详情</span><h2>{product.name}</h2></div>
          <button type="button" aria-label="关闭商品详情" onClick={onClose}>×</button>
        </header>
        <div className="h5-product-detail-body">
          <div className="h5-product-detail-art"><ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} /></div>
          <div className="h5-product-detail-meta">
            <p className="h5-product-detail-price">¥{money(product.price)}<small>/箱</small></p>
            <p><span>项目组</span><b>{product.line || "—"}</b></p>
            <p><span>规格</span><b>{product.spec || "—"}</b></p>
            <p><span>箱规</span><b>{product.casePack || "—"}</b></p>
            {product.materialCode && <p><span>物料编码</span><b>{product.materialCode}</b></p>}
          </div>
          {product.description && <div className="h5-product-detail-description"><span>产品说明</span><p>{product.description}</p></div>}
        </div>
        <footer className="h5-product-detail-actions">
          {onViewImages && <button type="button" className="ghost-btn" onClick={onViewImages}>查看图片</button>}
          <button type="button" className="primary-btn" onClick={onClose}>返回商品列表</button>
        </footer>
      </section>
    </div>
  );
}
