"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { apiAssetUrl } from "../../api";

export function backgroundFileError(file: Pick<File, "name" | "size">, kind: "h5" | "desktop") {
  if (!/\.(jpe?g|png|webp)$/i.test(file.name)) return "仅支持 JPG、PNG、WebP 图片。";
  const limit = kind === "h5" ? 5 : 10;
  if (!file.size) return "不能上传空文件。";
  return file.size > limit * 1024 * 1024 ? `图片不能超过 ${limit} MB。` : "";
}

// Keep the default visible until the replacement has loaded; failed assets never hide it.
export function useBackgroundImage(path?: string | null) {
  const url = apiAssetUrl(path || undefined);
  const [loaded, setLoaded] = useState("");
  useEffect(() => {
    if (!url) return;
    let active = true;
    const image = new Image();
    image.onload = () => { if (active) setLoaded(url); };
    image.onerror = () => { if (active) setLoaded(""); };
    image.src = url;
    return () => { active = false; image.onload = null; image.onerror = null; };
  }, [url]);
  return url && loaded === url ? `url(${JSON.stringify(url)})` : undefined;
}

export type BackgroundStyle = CSSProperties & {
  "--activity-h5-background"?: string;
  "--activity-desktop-background"?: string;
};
