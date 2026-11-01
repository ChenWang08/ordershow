"use client";
/* eslint-disable @next/next/no-img-element -- public derivatives and browser-local previews. */

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { imageVariantUrl } from "../../../domain/image-variants";
import { localThumbnailUrl } from "../../../domain/local-image-preview";

const blank = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function Thumbnail({ src, thumbnailUrl, variant = "thumbnail", alt = "", ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src?: string; thumbnailUrl?: string; variant?: "thumbnail" | "display";
}) {
  const element = useRef<HTMLImageElement>(null);
  const source = thumbnailUrl || (src?.startsWith("local-image:") ? src : imageVariantUrl(src, variant));
  const [active, setActive] = useState("");
  const [local, setLocal] = useState({ source: "", url: "" });
  const [failed, setFailed] = useState("");
  useEffect(() => {
    const image = element.current;
    if (!image || !source) return;
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setActive(source), 0);
      return () => window.clearTimeout(timer);
    }
    let root = image.parentElement;
    while (root && !/(auto|scroll)/.test(`${getComputedStyle(root).overflowX} ${getComputedStyle(root).overflowY}`)) root = root.parentElement;
    let nearRoot = !root, nearViewport = false;
    const activate = () => {
      if (nearRoot && nearViewport) { setActive(source); observer.disconnect(); viewport.disconnect(); }
    };
    const observer = new IntersectionObserver(entries => {
      nearRoot = entries.some(entry => entry.isIntersecting); activate();
    }, { root, rootMargin: "300px" });
    const viewport = new IntersectionObserver(entries => {
      nearViewport = entries.some(entry => entry.isIntersecting); activate();
    }, { rootMargin: "300px", scrollMargin: "300px" } as IntersectionObserverInit);
    observer.observe(image);
    viewport.observe(image);
    return () => { observer.disconnect(); viewport.disconnect(); };
  }, [source]);
  useEffect(() => {
    if (!source?.startsWith("local-image:") || active !== source) return;
    let current = true;
    localThumbnailUrl(source).then(url => { if (current) setLocal({ source, url }); })
      .catch(() => { if (current) setFailed(source); });
    return () => { current = false; };
  }, [active, source]);
  const resolved = source?.startsWith("local-image:") ? local.source === source ? local.url : "" : source;
  const ready = active === source && failed !== source && Boolean(resolved);
  return <img {...props} ref={element} src={ready ? resolved : blank} alt={alt} decoding="async" data-thumbnail={variant}
    onError={event => { setFailed(source); props.onError?.(event); }} />;
}
