"use client";
import { Thumbnail } from "../shared/components/Thumbnail";

export function ProductArt({ imageUrl, alt = "商品图片" }: { atlas?: number; imageUrl?: string; alt?: string }) {
  if (imageUrl) return <Thumbnail className="product-art product-photo" src={imageUrl} alt={alt} />;
  return (
    <span className="product-art product-image-placeholder" role="img" aria-label="图片未匹配">
      <svg className="product-image-placeholder-icon" viewBox="0 0 32 28" aria-hidden="true">
        <rect x="2" y="2" width="28" height="24" rx="3" />
        <circle cx="10" cy="9" r="2.5" />
        <path d="m5 22 7-7 4 4 3-3 8 6" />
      </svg>
      <b>图片未匹配</b>
    </span>
  );
}
