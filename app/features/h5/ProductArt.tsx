"use client";
/* eslint-disable @next/next/no-img-element -- product images are runtime API URLs. */

export function ProductArt({ atlas, imageUrl, alt = "商品图片" }: { atlas: number; imageUrl?: string; alt?: string }) {
  return imageUrl ? <img className="product-art product-photo" src={imageUrl} alt={alt} /> : <span className={`product-art atlas-${atlas}`} role="img" aria-label="临时商品图" />;
}
