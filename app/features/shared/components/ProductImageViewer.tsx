"use client";

/* eslint-disable @next/next/no-img-element -- images are supplied by runtime APIs and local previews. */

import { useEffect, useRef, useState } from "react";

type PreviewImage = { url: string; fileName?: string };

export function ProductImageViewer({ productName, images, initialIndex = 0, status, contained = false, allowZoom = true, onClose }: { productName: string; images: PreviewImage[]; initialIndex?: number; status?: string; contained?: boolean; allowZoom?: boolean; onClose: () => void }) {
  const [activeIndex, setActiveIndex] = useState(Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
  const [zoomed, setZoomed] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const currentImage = images[activeIndex];
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (images.length > 1 && event.key === "ArrowLeft") setActiveIndex((index) => (index - 1 + images.length) % images.length);
      if (images.length > 1 && event.key === "ArrowRight") setActiveIndex((index) => (index + 1) % images.length);
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [images.length, onClose]);
  if (!currentImage) return null;
  const goTo = (index: number) => {
    setActiveIndex((index + images.length) % images.length);
    setZoomed(false);
  };
  const handleTouchEnd = (event: React.TouchEvent) => {
    if (touchStartX.current === null || images.length < 2) return;
    const distance = event.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(distance) > 45) goTo(activeIndex + (distance < 0 ? 1 : -1));
    touchStartX.current = null;
  };
  return (
    <div className={`product-image-viewer${contained ? " h5-contained-image-viewer" : ""}`} role="dialog" aria-modal="true" aria-label={`${productName}图片预览`} onClick={onClose}>
      <div className="product-image-viewer-panel" onClick={(event) => event.stopPropagation()}>
        <header><div><b>{productName}</b><small>{images.length > 1 ? `${activeIndex + 1} / ${images.length}` : "商品图片"}{status ? ` · ${status}` : ""}</small></div><button type="button" aria-label="关闭图片预览" onClick={onClose}>×</button></header>
        <div className={`product-image-viewer-stage ${zoomed ? "zoomed" : ""}`} onTouchStart={(event) => { touchStartX.current = event.touches[0].clientX; }} onTouchEnd={handleTouchEnd}>
          {images.length > 1 && <button type="button" className="product-image-viewer-arrow prev" aria-label="上一张图片" onClick={() => goTo(activeIndex - 1)}>‹</button>}
          <img src={currentImage.url} alt={`${productName} ${activeIndex + 1}`} onClick={() => allowZoom && setZoomed((value) => !value)} />
          {images.length > 1 && <button type="button" className="product-image-viewer-arrow next" aria-label="下一张图片" onClick={() => goTo(activeIndex + 1)}>›</button>}
        </div>
        <footer><span>{currentImage.fileName || `${activeIndex + 1} / ${images.length}`}</span>{allowZoom && <button type="button" className="product-image-viewer-zoom" onClick={() => setZoomed((value) => !value)}>{zoomed ? "还原大小" : "放大图片"}</button>}</footer>
        {images.length > 1 && <div className="product-image-viewer-thumbs" aria-label="图片缩略图列表">{images.map((image, index) => <button type="button" key={`${image.url}-${index}`} className={index === activeIndex ? "active" : ""} aria-label={`查看第 ${index + 1} 张图片`} onClick={() => goTo(index)}><img src={image.url} alt="" /></button>)}</div>}
      </div>
    </div>
  );
}
