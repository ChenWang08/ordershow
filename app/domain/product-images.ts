import JSZip from "jszip";
import {
  createImportRowId,
  type ProductImageAsset,
  type ProductImageStats,
  type ProductImageStatus,
  type ProductImportRow,
} from "./import-domain";

export const productImageExtensions = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;

export function productImageBaseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function normalizeProductImageName(value: string) {
  return productImageBaseName(value)
    .replace(productImageExtensions, "")
    .replace(/^20\d{6,8}/, "")
    .replace(/[-_](?:o|ok)$/i, "")
    .replace(/(?:主图|正面|背面|侧面|清晰图|清)\d*$/g, "")
    .replace(/(?:主图|正面|背面|侧面|清晰图|清)\d*$/g, "")
    .replace(/毫升/g, "ml")
    .replace(/[＊xX*]/g, "×")
    .replace(/\s+/g, "")
    .replace(/[-_，,。·／/\\()[\]【】{}：:]/g, "")
    .toLocaleLowerCase("zh-CN");
}

export function productImageNameVariants(value: string) {
  const normalized = normalizeProductImageName(value);
  const withoutPackCount = normalized.replace(/×\d+$/, "");
  const withoutPackaging = normalized.replace(/玻璃瓶|纸箱|塑料袋|pe瓶|pet|葫芦瓶|礼盒随货|组装好发货|天津定制|河南定制|北京定制|武汉分特渠/g, "");
  const variants = [
    normalized,
    withoutPackCount,
    withoutPackaging,
    withoutPackaging.replace(/×\d+$/, ""),
    normalized.replace(/×/g, ""),
    withoutPackaging.replace(/×/g, ""),
  ];
  return [...new Set(variants)].filter((item) => item.length >= 6);
}

export function productImageTextKey(value: string) {
  return normalizeProductImageName(value).replace(/[0-9.×]/g, "");
}

export function productImageNumberTokens(value: string) {
  return new Set(normalizeProductImageName(value).match(/\d+(?:\.\d+)?/g) ?? []);
}

export function productImageSimilarity(a: string, b: string) {
  const first = [...new Set(Array.from(a).map((_, index) => a.slice(index, index + 2)).filter((item) => item.length === 2))];
  const second = new Set(Array.from(b).map((_, index) => b.slice(index, index + 2)).filter((item) => item.length === 2));
  if (first.length === 0 || second.size === 0) return a === b ? 1 : 0;
  const common = first.filter((item) => second.has(item)).length;
  return (2 * common) / (first.length + second.size);
}

export function scoreProductImageMatch(materialName: string, fileName: string) {
  const productVariants = productImageNameVariants(materialName);
  const imageVariants = productImageNameVariants(fileName);
  const strictMatch = productVariants.some((productVariant) => imageVariants.some((imageVariant) => imageVariant.includes(productVariant)));
  if (strictMatch) return 1;
  const productText = productImageTextKey(materialName);
  const imageText = productImageTextKey(fileName);
  const productNumbers = productImageNumberTokens(materialName);
  const imageNumbers = productImageNumberTokens(fileName);
  const commonNumbers = [...productNumbers].filter((item) => imageNumbers.has(item)).length;
  if (productText.length < 6 || commonNumbers === 0) return 0;
  const similarity = productImageSimilarity(productText, imageText);
  return similarity >= 0.5 && commonNumbers / productNumbers.size >= 0.5 ? similarity * 0.8 + commonNumbers / productNumbers.size * 0.2 : 0;
}

export function matchProductImages(rows: ProductImportRow[], assets: ProductImageAsset[]) {
  const nextRows = rows.map((row) => {
    const manualImages = row.images?.filter((asset) => asset.source === "manual") ?? [];
    if (manualImages.length > 0 && row.imageStatus === "手动维护") return { ...row, images: manualImages, imageStatus: "手动维护" as const };
    if (assets.length === 0) return { ...row, images: undefined, imageStatus: "未上传" as const };
    const scored = assets.map((asset) => ({ asset, score: scoreProductImageMatch(row.materialName, asset.fileName) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    if (scored.length === 0) return { ...row, images: undefined, imageStatus: "未匹配" as const };
    if (scored[0].score === 1) {
      const exactAssets = scored.filter((item) => item.score === 1).map((item) => item.asset);
      return { ...row, images: exactAssets, imageStatus: "已匹配" as const };
    }
    const best = scored[0];
    const nextBest = scored[1];
    const isUnique = best.score >= 0.6 && (!nextBest || best.score - nextBest.score >= 0.08);
    return isUnique
      ? { ...row, images: [best.asset], imageStatus: "已匹配" as const }
      : { ...row, images: scored.slice(0, 4).map((item) => item.asset), imageStatus: "待确认" as const };
  });
  return {
    rows: nextRows,
    stats: {
      totalImages: assets.length,
      matchedProducts: nextRows.filter((row) => row.imageStatus === "已匹配").length,
      pendingProducts: nextRows.filter((row) => row.imageStatus === "待确认").length,
      unmatchedProducts: nextRows.filter((row) => row.imageStatus === "未匹配").length,
    } satisfies ProductImageStats,
  };
}

export async function parseProductImageZip(file: File) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && productImageExtensions.test(entry.name));
  if (entries.length === 0) throw new Error("ZIP 中没有找到 JPG、PNG、WEBP、GIF 或 BMP 图片。");
  const assets = await Promise.all(entries.map(async (entry, index) => {
    const blob = await entry.async("blob");
    return { id: `product-image-${Date.now()}-${index}`, fileName: productImageBaseName(entry.name), url: URL.createObjectURL(blob), normalizedName: normalizeProductImageName(entry.name), source: "zip" } satisfies ProductImageAsset;
  }));
  return assets;
}

export function revokeProductImageAssets(assets: ProductImageAsset[]) {
  assets.filter((asset) => asset.source !== "manual").forEach((asset) => URL.revokeObjectURL(asset.url));
}

export const maxManualProductImageSize = 10 * 1024 * 1024;

export function readManualProductImage(file: File) {
  return new Promise<ProductImageAsset>((resolve, reject) => {
    if (!productImageExtensions.test(file.name)) {
      reject(new Error(`${file.name} 不是支持的图片格式，请选择 JPG、PNG、WEBP、GIF 或 BMP。`));
      return;
    }
    if (file.size > maxManualProductImageSize) {
      reject(new Error(`${file.name} 超过 10MB，请压缩图片后再上传。`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`${file.name} 读取失败，请重新选择。`));
        return;
      }
      resolve({
        id: createImportRowId("product-image-manual"),
        fileName: file.name,
        url: reader.result,
        normalizedName: normalizeProductImageName(file.name),
        source: "manual",
      });
    };
    reader.onerror = () => reject(new Error(`${file.name} 读取失败，请重新选择。`));
    reader.readAsDataURL(file);
  });
}

export async function createManualProductImageAssets(files: File[]) {
  return Promise.all(files.map((file) => readManualProductImage(file)));
}

export function productImageStatusForAssets(images: ProductImageAsset[] | undefined, previousStatus: ProductImageStatus = "未上传") {
  if (!images?.length) return "未上传" as const;
  if (images.some((asset) => asset.source === "manual")) return "手动维护" as const;
  return previousStatus === "待确认" ? "待确认" as const : "已匹配" as const;
}
