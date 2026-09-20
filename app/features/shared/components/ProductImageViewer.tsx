"use client";

/* eslint-disable @next/next/no-img-element -- images are supplied by runtime APIs and local previews. */

import { useCallback, useEffect, useRef, useState } from "react";

type PreviewImage = { url: string; fileName?: string };

export function ProductImageViewer({ productName, images, initialIndex = 0, status, contained = false, allowZoom = true, onClose }: { productName: string; images: PreviewImage[]; initialIndex?: number; status?: string; contained?: boolean; allowZoom?: boolean; onClose: () => void }) {
  const [activeIndex, setActiveIndex] = useState(Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
  const [zoomed, setZoomed] = useState(false);
  const [fittedImageSize, setFittedImageSize] = useState<{ width: number; height: number } | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const suppressImageClick = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const currentImage = images[activeIndex];
  const currentImageUrl = currentImage?.url;
  const fitImageToStage = useCallback(() => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!currentImageUrl || zoomed || !stage || !image || !image.naturalWidth || !image.naturalHeight || !stage.clientWidth || !stage.clientHeight) return;
    const sideGutter = images.length > 1 ? 72 : 32;
    const availableWidth = Math.max(1, stage.clientWidth - sideGutter);
    const availableHeight = Math.max(1, stage.clientHeight - 32);
    const scale = Math.min(availableWidth / image.naturalWidth, availableHeight / image.naturalHeight);
    setFittedImageSize({ width: image.naturalWidth * scale, height: image.naturalHeight * scale });
  }, [currentImageUrl, images.length, zoomed]);
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
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || zoomed) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fitImageToStage);
    observer?.observe(stage);
    fitImageToStage();
    if (!observer) window.addEventListener("resize", fitImageToStage);
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", fitImageToStage);
    };
  }, [fitImageToStage, zoomed]);
  if (!currentImage) return null;
  const goTo = (index: number) => {
    setActiveIndex((index + images.length) % images.length);
    setFittedImageSize(null);
    stageRef.current?.scrollTo({ top: 0, left: 0 });
    setZoomed(false);
  };
  const toggleZoom = () => {
    if (!allowZoom) return;
    stageRef.current?.scrollTo({ top: 0, left: 0 });
    setZoomed((value) => !value);
  };
  const handleTouchStart = (event: React.TouchEvent) => {
    suppressImageClick.current = false;
    if ((event.target as HTMLElement).closest("button")) {
      touchStart.current = null;
      return;
    }
    touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };
  const handleTouchEnd = (event: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (start === null) return;
    const distanceX = event.changedTouches[0].clientX - start.x;
    const distanceY = event.changedTouches[0].clientY - start.y;
    if (Math.hypot(distanceX, distanceY) > 8) suppressImageClick.current = true;
    if (zoomed || Math.abs(distanceX) <= 45 || Math.abs(distanceX) <= Math.abs(distanceY)) return;
    if (images.length > 1) goTo(activeIndex + (distanceX < 0 ? 1 : -1));
  };
  const handleImageClick = () => {
    if (!allowZoom) return;
    if (suppressImageClick.current) {
      suppressImageClick.current = false;
      return;
    }
    toggleZoom();
  };
  return (
    <div className={`product-image-viewer${contained ? " h5-contained-image-viewer" : ""}`} role="dialog" aria-modal="true" aria-label={`${productName}图片预览`} onClick={onClose}>
      <div className="product-image-viewer-panel" onClick={(event) => event.stopPropagation()}>
        <header><div><b>{productName}</b><small>{images.length > 1 ? `${activeIndex + 1} / ${images.length}` : "商品图片"}{status ? ` · ${status}` : ""}</small></div><button type="button" aria-label="关闭图片预览" onClick={onClose}>×</button></header>
        <div ref={stageRef} className={`product-image-viewer-stage ${zoomed ? "zoomed" : ""}`} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {images.length > 1 && <button type="button" className="product-image-viewer-arrow prev" aria-label="上一张图片" onClick={() => goTo(activeIndex - 1)}>‹</button>}
          <img ref={imageRef} src={currentImage.url} alt={`${productName} ${activeIndex + 1}`} style={!zoomed && fittedImageSize ? { width: fittedImageSize.width, height: fittedImageSize.height } : undefined} onLoad={fitImageToStage} onClick={handleImageClick} />
          {images.length > 1 && <button type="button" className="product-image-viewer-arrow next" aria-label="下一张图片" onClick={() => goTo(activeIndex + 1)}>›</button>}
        </div>
        <footer><span>{currentImage.fileName || `${activeIndex + 1} / ${images.length}`}</span>{allowZoom && <button type="button" className="product-image-viewer-zoom" onClick={toggleZoom}>{zoomed ? "还原大小" : "放大图片"}</button>}</footer>
        {images.length > 1 && <div className="product-image-viewer-thumbs" aria-label="图片缩略图列表">{images.map((image, index) => <button type="button" key={`${image.url}-${index}`} className={index === activeIndex ? "active" : ""} aria-label={`查看第 ${index + 1} 张图片`} onClick={() => goTo(index)}><img src={image.url} alt="" /></button>)}</div>}
      </div>
    </div>
  );
}
