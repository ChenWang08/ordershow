type Preview = { read: () => Promise<Blob>; original?: Promise<string>; thumbnail?: Promise<string>; urls: Set<string>; disposed: boolean };
const previews = new Map<string, Preview>();
let sequence = 0;
let running = 0;
const queue: Array<() => void> = [];

async function limited<T>(work: () => Promise<T>) {
  if (running >= 2) await new Promise<void>(resolve => queue.push(resolve));
  else running++;
  try { return await work(); }
  finally { const next = queue.shift(); if (next) next(); else running--; }
}

export function registerLocalImage(read: () => Promise<Blob>) {
  const url = `local-image:${Date.now()}-${++sequence}`;
  previews.set(url, { read, urls: new Set(), disposed: false });
  return url;
}

export function releaseLocalImage(url: string) {
  const preview = previews.get(url);
  if (!preview) return;
  preview.disposed = true;
  preview.urls.forEach(value => URL.revokeObjectURL(value));
  preview.urls.clear();
  previews.delete(url);
}

function objectUrl(preview: Preview, blob: Blob) {
  if (preview.disposed) throw new Error("图片预览已关闭");
  const url = URL.createObjectURL(blob);
  preview.urls.add(url);
  return url;
}

export function localOriginalUrl(url: string): Promise<string> {
  if (!url.startsWith("local-image:")) return Promise.resolve(url);
  const preview = previews.get(url);
  if (!preview) return Promise.reject(new Error("图片预览已关闭"));
  return preview.original ??= limited(async () => objectUrl(preview, await preview.read()));
}

export function localThumbnailUrl(url: string): Promise<string> {
  const preview = previews.get(url);
  if (!preview) return Promise.reject(new Error("图片预览已关闭"));
  return preview.thumbnail ??= limited(async () => {
    if (preview.disposed) throw new Error("图片预览已关闭");
    const source = await preview.read();
    const bitmap = await createImageBitmap(source, { imageOrientation: "from-image" });
    try {
      const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法生成图片预览");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("无法生成图片预览")), "image/webp", .8));
      return objectUrl(preview, blob);
    } finally { bitmap.close(); }
  });
}
