import JSZip from "jszip";
import { registerLocalImage, releaseLocalImage } from "./local-image-preview";
import {
  createImportRowId,
  type ProductImageAsset,
  type ProductImageRelationStatus,
  type ProductImageStats,
  type ProductImportRow,
} from "./import-domain";

export const productImageExtensions = /\.(jpg|jpeg|png|webp|gif|bmp)$/i;

export function productImageBaseName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function productImagePathCandidates(path: string) {
  const safeSegments = path.replace(/\\/g, "/").split("/")
    .map((segment) => segment.trim()).filter((segment) => segment && segment !== "." && segment !== "..");
  if (safeSegments.length === 0) return [];
  safeSegments[safeSegments.length - 1] = safeSegments[safeSegments.length - 1].replace(productImageExtensions, "");
  return [...new Set(safeSegments.map((_, index) => safeSegments.slice(index).join("")))]
    .filter((candidate) => normalizeProductImageName(candidate).length >= 6);
}

export function normalizeProductImageName(value: string) {
  // 商品名称本身可能包含 `/`（例如“品牌/规格”），不能按图片路径取 basename，
  // 否则会丢掉 `/` 前的品牌和品种，导致同规格的不同商品被归成同一个名称。
  return String(value ?? "")
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
  const variants = [
    normalized,
    normalized.replace(/×/g, ""),
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

type ProductSignature = {
  volumes: Set<string>;
  packCounts: Set<string>;
  brand: string;
  category: string;
  variety: string;
  grade: string;
  containerMaterial: Set<string>;
  containerShape: Set<string>;
  outerPackaging: Set<string>;
};

const varietyTerms = [
  "清香米醋", "香甜米醋", "精酿陈醋", "山西陈醋", "镇江香醋", "酿造白醋", "零添加米醋",
  "零添加特级味极鲜", "零添加金标生抽", "蒸鱼豉油酱油", "蒸鱼豉油", "味极鲜酱油", "金标生抽", "薄盐生抽", "红烧老抽", "草菇老抽", "生抽", "老抽",
  "藤椒油", "花椒油", "小磨香油", "芝麻油", "调和油", "菜籽油", "玉米油", "葵花籽油",
  "白醋", "陈醋", "香醋", "米醋",
].sort((a, b) => b.length - a.length);

const brandTerms = ["金龙鱼", "梁汾", "丸庄", "香满园", "胡姬花", "口福"].sort((a, b) => b.length - a.length);
const categoryTerms = ["酱油", "陈醋", "香醋", "米醋", "白醋", "醋", "料酒", "蚝油", "调味油", "食用油"].sort((a, b) => b.length - a.length);
const gradeTerms = ["特级", "一级", "二级", "三级"];

function productSignature(value: string): ProductSignature {
  const normalized = normalizeProductImageName(value);
  const volumes = new Set<string>();
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)(ml|l|kg|g)/g)) {
    const amount = Number(match[1]);
    const unit = match[2];
    const converted = unit === "l" ? amount * 1000 : unit === "kg" ? amount * 1000 : amount;
    volumes.add(`${converted}${unit === "l" || unit === "ml" ? "ml" : "g"}`);
  }
  const packCounts = new Set<string>();
  for (const match of normalized.matchAll(/×(\d+)/g)) packCounts.add(match[1]);
  for (const match of normalized.matchAll(/(?:ml|kg|g|l)(\d+)(?!\d)/g)) packCounts.add(match[1]);
  const tokens = (terms: Array<[RegExp, string]>) => new Set(terms.filter(([pattern]) => pattern.test(normalized)).map(([, token]) => token));
  return {
    volumes,
    packCounts,
    brand: brandTerms.find((term) => normalized.includes(term)) ?? "",
    category: categoryTerms.find((term) => normalized.includes(term))?.replace(/(?:陈|香|米|白)醋/, "醋") ?? "",
    variety: varietyTerms.find((term) => normalized.includes(term)) ?? "",
    grade: gradeTerms.find((term) => normalized.includes(term)) ?? "",
    containerMaterial: tokens([[/玻璃瓶/, "glass"], [/(?:塑料瓶|pet瓶|pet)/, "pet"], [/(?:pe瓶|pe壶)/, "pe"], [/铁罐/, "metal"]]),
    containerShape: tokens([[/葫芦瓶/, "gourd"]]),
    outerPackaging: tokens([[/纸箱/, "carton"], [/(?:礼盒|礼盒随货)/, "gift"], [/(?:塑料袋|袋装)/, "bag"], [/散装/, "bulk"]]),
  };
}

function setsConflict(first: Set<string>, second: Set<string>) {
  return first.size > 0 && second.size > 0 && ![...first].some((item) => second.has(item));
}

function signaturesConflict(first: ProductSignature, second: ProductSignature) {
  return setsConflict(first.volumes, second.volumes)
    || setsConflict(first.packCounts, second.packCounts)
    || (first.brand !== "" && second.brand !== "" && first.brand !== second.brand)
    || (first.category !== "" && second.category !== "" && first.category !== second.category)
    || (first.variety !== "" && second.variety !== "" && first.variety !== second.variety)
    || (first.grade !== "" && second.grade !== "" && first.grade !== second.grade)
    || setsConflict(first.containerMaterial, second.containerMaterial)
    || setsConflict(first.containerShape, second.containerShape)
    || setsConflict(first.outerPackaging, second.outerPackaging);
}

function withoutPackaging(value: string) {
  return normalizeProductImageName(value).replace(/玻璃瓶|塑料瓶|塑料袋|纸箱|pe瓶|pe壶|pet瓶|pet|葫芦瓶|铁罐|礼盒随货发|礼盒随货|礼盒|袋装|散装/g, "");
}

export function scoreProductImageMatch(materialName: string, fileName: string) {
  if (signaturesConflict(productSignature(materialName), productSignature(fileName))) return 0;
  const productVariants = productImageNameVariants(materialName);
  const imageVariants = productImageNameVariants(fileName);
  const strictMatch = productVariants.some((productVariant) => imageVariants.some((imageVariant) => imageVariant.includes(productVariant)));
  if (strictMatch) return 1;
  const productCore = withoutPackaging(materialName).replace(/×/g, "");
  const imageCore = withoutPackaging(fileName).replace(/×/g, "");
  if (productCore === imageCore) return 0.98;
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
  if (assets.length === 0) {
    const nextRows = rows.map((row) => ({ ...row, images: undefined, imageStatus: "未匹配" as const }));
    return { rows: nextRows, assets, stats: {
      totalProducts: nextRows.length, matchedProducts: 0, pendingProducts: 0, unmatchedProducts: nextRows.length,
    } satisfies ProductImageStats };
  }

  const groupsByName = new Map<string, ProductImportRow[]>();
  rows.forEach((row) => {
    const name = normalizeProductImageName(row.materialName);
    if (name) groupsByName.set(name, [...(groupsByName.get(name) ?? []), row]);
  });
  const groups = [...groupsByName.values()];
  const proposedByRow = new Map<string, Array<{ asset: ProductImageAsset; autoConfirmed: boolean }>>();
  const baseAssets = assets.map((asset) => {
    const names = asset.matchingNames?.length ? asset.matchingNames : [asset.fileName];
    const scored = groups.map((group) => ({
      group,
      score: Math.max(...names.map((name) => scoreProductImageMatch(group[0].materialName, name))),
    })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1];
    const status: ProductImageAsset["matchStatus"] = !best || best.score < 0.55 ? "未匹配"
      : best.score >= 0.9 && (!second || best.score - second.score >= 0.08) ? "已匹配" : "待确认";
    const nextAsset = { ...asset, matchStatus: status };
    const candidateGroups = status === "已匹配" && best ? [best.group]
      : status === "待确认" && best ? scored.filter((item) => best.score - item.score <= 0.08).map((item) => item.group) : [];
    candidateGroups.flat().forEach((row) => proposedByRow.set(row.id, [
      ...(proposedByRow.get(row.id) ?? []),
      { asset: nextAsset, autoConfirmed: status === "已匹配" },
    ]));
    return nextAsset;
  });

  const nextRows = rows.map((row) => {
    const manualImage = row.images?.find((asset) => asset.source === "manual");
    const proposed = [...new Map((proposedByRow.get(row.id) ?? []).map((item) => [item.asset.id, item])).values()];
    // 一个商品名称只能有一张图；同一名称命中多图时全部降级为候选，必须人工选择一张。
    const images = manualImage ? [{ ...manualImage, relationStatus: "CONFIRMED" as const }]
      : proposed.map(({ asset, autoConfirmed }) => ({
        ...asset,
        matchStatus: proposed.length === 1 && autoConfirmed ? "已匹配" as const : "待确认" as const,
        relationStatus: proposed.length === 1 && autoConfirmed ? "CONFIRMED" as const : "CANDIDATE" as const,
      }));
    const imageStatus = productImageStatusForAssets(images);
    return { ...row, images: images.length ? images : undefined, imageStatus };
  });
  const matchedAssets = synchronizeProductImageAssetStatuses(baseAssets, nextRows);
  return {
    rows: nextRows,
    assets: matchedAssets,
    stats: {
      totalProducts: nextRows.length,
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
  const assets = entries.map((entry, index) => {
    const matchingNames = productImagePathCandidates(entry.name);
    return { id: `product-image-${Date.now()}-${index}`, fileName: productImageBaseName(entry.name), archivePath: entry.name.replace(/\\/g, "/"), url: registerLocalImage(() => entry.async("blob")), normalizedName: normalizeProductImageName(matchingNames[0] ?? productImageBaseName(entry.name)), matchingNames, source: "zip" } satisfies ProductImageAsset;
  });
  return assets;
}

export function revokeProductImageAssets(assets: ProductImageAsset[]) {
  assets.forEach((asset) => {
    if (asset.url.startsWith("local-image:")) releaseLocalImage(asset.url);
    else if (asset.source !== "manual" && asset.url.startsWith("blob:")) URL.revokeObjectURL(asset.url);
  });
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
      resolve({
        id: createImportRowId("product-image-manual"),
        fileName: file.name,
        file,
        url: registerLocalImage(() => Promise.resolve(file)),
        normalizedName: normalizeProductImageName(file.name),
        relationStatus: "CONFIRMED",
        source: "manual",
      });
  });
}

export async function createManualProductImageAssets(files: File[]) {
  const results = await Promise.allSettled(files.map((file) => readManualProductImage(file)));
  const assets = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const failed = results.find(result => result.status === "rejected");
  if (failed?.status === "rejected") {
    revokeProductImageAssets(assets);
    throw failed.reason;
  }
  return assets;
}

export function productImageRelationStatus(image: ProductImageAsset): ProductImageRelationStatus {
  if (image.relationStatus) return image.relationStatus;
  if (image.source === "manual" || image.matchStatus === "已匹配") return "CONFIRMED";
  // 兼容热更新前或旧预览中的 ZIP 候选：缺少状态时必须待确认，不能静默升级为已匹配。
  return "CANDIDATE";
}

export function productImageStatusForAssets(images: ProductImageAsset[] | undefined) {
  if (!images?.length) return "未匹配" as const;
  return images.some((image) => productImageRelationStatus(image) === "CANDIDATE") ? "待确认" as const : "已匹配" as const;
}

export function synchronizeProductImageAssetStatuses(assets: ProductImageAsset[], rows: ProductImportRow[]) {
  return assets.map((asset) => {
    const relations = rows.flatMap((row) => row.images?.filter((image) => image.id === asset.id) ?? []);
    const matchStatus: ProductImageAsset["matchStatus"] = relations.some((image) => productImageRelationStatus(image) === "CONFIRMED")
      ? "已匹配"
      : relations.some((image) => productImageRelationStatus(image) === "CANDIDATE") ? "待确认" : "未匹配";
    return { ...asset, matchStatus };
  });
}

export type ProductImageDecisionPayload = { entryPath: string; status: "CONFIRMED" | "PENDING" | "UNMATCHED"; targetRowIds: number[] };

export function buildProductImageDecisions(rows: ProductImportRow[], assets: ProductImageAsset[]): ProductImageDecisionPayload[] {
  return assets.filter((asset) => asset.source === "zip" && asset.archivePath).map((asset) => {
    const confirmedRows = rows.filter((row) => row.images?.some((image) => image.id === asset.id && productImageRelationStatus(image) === "CONFIRMED"));
    const pendingRows = rows.filter((row) => row.images?.some((image) => image.id === asset.id && productImageRelationStatus(image) === "CANDIDATE"));
    const decisionRows = confirmedRows.length > 0 ? confirmedRows : pendingRows;
    const targetRowIds = [...new Set(decisionRows.map((row) => row.serverRowId).filter((id): id is number => id !== undefined))];
    return {
      entryPath: asset.archivePath!,
      status: confirmedRows.length > 0 ? "CONFIRMED" : pendingRows.length > 0 ? "PENDING" : "UNMATCHED",
      targetRowIds,
    };
  });
}
