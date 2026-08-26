"use client";

/* eslint-disable @next/next/no-img-element -- 商品图片来自运行时 API、ZIP object URL 或 data URL，无法使用静态图片优化器。 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import readXlsxFile, { readSheetNames } from "read-excel-file";
import {
  getActiveActivityCode,
  ApiError,
  apiAssetUrl,
  apiBase,
  type RuntimeActivity,
  type RuntimeIdentity,
  type RuntimeOrder,
  type RuntimeProduct,
  type DashboardData,
  type DashboardReport,
  type ImportStagingRow,
  type AdminAttendee,
  type LotteryCandidatePreview,
  type LotteryRuleApi,
  type LotteryWinnerStatistics,
  adminLogin,
  adminMe,
  changeAdminPassword,
  createAdminAttendee,
  createAdminCustomer,
  createAdminProduct,
  loadActivity,
  loadH5Order,
  loadH5Products,
  saveH5Order,
  confirmImport,
  completeLotteryRound,
  createLotteryRule,
  drawLotteryRound,
  deleteAdminAttendee,
  deleteImportRows,
  loadAdminAttendees,
  loadAdminCustomers,
  loadAdminProducts,
  loadAuditLogs,
  loadDashboard,
  loadDashboardReport,
  loadImportRows,
  loadImportTask,
  loadLotteryRules,
  loadLotteryStatistics,
  loadPublicLottery,
  previewLotteryCandidates,
  transitionActivity,
  updateActivity,
  updateAdminAttendee,
  updateAdminCustomer,
  updateAdminProduct,
  addAdminProductImage,
  updateAdminProductImage,
  deleteAdminProductImage,
  updateImportRow,
  updateLotteryRule,
  uploadImport,
  waitForImport,
  verifyPhone,
  withdrawH5Order,
  publishLotteryRule,
  deleteAdminCustomer,
  deleteAdminProduct,
} from "./api";
import { OrderManagement } from "./components/orders/OrderManagement";
import {
  attendanceCustomerType,
  bindAttendanceStaging,
  bindProductStaging,
  bindWhitelistStaging,
  cloneProductRows,
  cloneWhitelistRows,
  compareProductRows,
  compareWhitelistRows,
  createImportRowId,
  normalizeWhitelistName,
  parseAttendanceWorkbook,
  prepareWhitelistImportRows,
  summarizeWhitelistRows,
  summarizeProductImportRows,
  whitelistIdentityKey,
  whitelistPhoneIsValid,
  type AttendanceCustomerType,
  type AttendanceFieldKey,
  type AttendanceImportDraft,
  type AttendanceRow,
  type DeleteTarget,
  type ProductImageAsset,
  type ProductImageStats,
  type ProductImageStatus,
  type ProductImportRow,
  type WhitelistRow,
} from "./domain/import-domain";
import {
  createManualProductImageAssets,
  matchProductImages,
  buildProductImageDecisions,
  normalizeProductImageName,
  parseProductImageZip,
  productImageStatusForAssets,
  revokeProductImageAssets,
} from "./domain/product-images";

type Surface = "h5" | "ranking" | "report" | "lottery" | "admin";
type ActivityStatus = "draft" | "scheduled" | "running" | "ended";
type H5Step = "channel" | "region" | "verify" | "order" | "confirm" | "success" | "submitted";
type H5OrderStatus = "none" | "submitted" | "withdrawn";
type H5Channel = "综合客户" | "特渠专业客户" | "";
type CandidateScope = "all" | "attended" | "ordered";
type LotteryRoundStatus = "draft" | "published" | "completed";
type LotteryRound = {
  id: number;
  ruleId?: number;
  serverStatus?: string;
  name: string;
  prize: string;
  winnerCount: number;
  customerType: "全部客户" | "特渠专业客户" | "综合客户";
  scope: CandidateScope;
  minAmount: number;
  excludeWinners: boolean;
  status: LotteryRoundStatus;
  candidateCount: number;
};
type Product = {
  id: string;
  name: string;
  line: string;
  spec: string;
  price: number;
  rebate: boolean;
  gift: boolean;
  atlas: number;
  customerType: "综合" | "特渠" | "全部";
  branchScope: string[];
  status: "有效" | "待核对" | "待完善";
  isOrderable: boolean;
  materialCode?: string;
  casePack?: string;
  imageUrl?: string;
  imageUrls?: string[];
};

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function maskPhone(value: string) {
  return value.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

function normalizeMaterialCode(value: string) {
  return normalizeSearchText(value).replace(/[-_]/g, "");
}

function splitBranchScope(value: string) {
  return value.split(/[，,、]/).map((item) => item.trim()).filter(Boolean);
}

function productRowToProduct(row: ProductImportRow): Product {
  const lineAtlas = row.line === "酱油" ? 1 : row.line === "食醋" ? 2 : row.gift === "是" ? 3 : 0;
  const imageUrls = row.imageStatus === "待确认" || row.imageStatus === "未匹配"
    ? []
    : row.images?.map((image) => image.url) ?? [];
  return {
    id: row.id,
    name: row.materialName,
    line: row.line,
    spec: row.spec,
    price: Number(row.casePrice) || 0,
    rebate: row.rebate === "参与",
    gift: row.gift === "是",
    atlas: lineAtlas,
    customerType: row.customerType,
    branchScope: splitBranchScope(row.branchScope),
    status: row.status,
    isOrderable: Number(row.casePrice) > 0,
    materialCode: row.materialCode,
    casePack: row.casePack,
    imageUrl: imageUrls?.[0],
    imageUrls,
  };
}

function runtimeProductToProduct(row: RuntimeProduct): Product {
  const imageUrls = [...row.images].sort((a, b) => Number(b.primary) - Number(a.primary) || a.sortNo - b.sortNo).map((image) => apiAssetUrl(image.url));
  return {
    id: String(row.id),
    name: row.materialName,
    line: row.productLine || row.categoryName || "未分类",
    spec: row.specification || row.casePack || "",
    price: Number(row.casePrice || 0),
    rebate: row.rebateStatus === "PARTICIPATING",
    gift: row.giftBox,
    atlas: row.productLine === "酱油" ? 1 : row.productLine === "食醋" ? 2 : row.giftBox ? 3 : 0,
    customerType: row.customerType === "GENERAL" ? "综合" : "特渠",
    branchScope: row.branchScope ?? [],
    status: row.dataStatus === "INCOMPLETE" ? "待完善" : "有效",
    isOrderable: row.orderable,
    materialCode: row.materialCode,
    casePack: row.casePack,
    imageUrl: imageUrls[0],
    imageUrls,
  };
}

function runtimeProductToImportRow(product: RuntimeProduct): ProductImportRow {
  return {
    id: String(product.id), serverVersion: product.version, sequence: product.sortNo,
    customerType: product.customerType === "GENERAL" ? "综合" : "特渠",
    rebate: product.rebateStatus === "PARTICIPATING" ? "参与" : "不参与",
    category: product.categoryName || "", line: product.productLine || "", materialCode: product.materialCode || "",
    materialName: product.materialName, brand: product.brandName || "", variety: product.varietyName || "",
    spec: product.specification || "", casePack: product.casePack || "",
    unitPrice: product.bottlePrice == null ? "" : String(product.bottlePrice),
    casePrice: product.casePrice == null ? "" : String(product.casePrice),
    conversion: product.tonCaseFactor == null ? "" : String(product.tonCaseFactor),
    gift: product.giftBox ? "是" : "否", branchScope: (product.branchScope ?? []).join("，"),
    status: product.dataStatus === "INCOMPLETE" ? "待完善" : "有效", source: "excel",
    imageStatus: product.images.length ? "已匹配" : "未匹配",
    images: product.images.map((image, index) => ({
      id: String(image.id), fileName: `${product.materialName}-${index + 1}`, url: apiAssetUrl(image.url),
      normalizedName: normalizeProductImageName(product.materialName), source: image.sourceType === "MANUAL" ? "manual" : "zip",
    })),
  };
}

const productSheetConfig = [
  { name: "综合参与返利", customerType: "综合" as const, rebate: "参与" as const },
  { name: "综合不参与返利", customerType: "综合" as const, rebate: "不参与" as const },
  { name: "特渠参与返利", customerType: "特渠" as const, rebate: "参与" as const },
  { name: "特渠不参与返利", customerType: "特渠" as const, rebate: "不参与" as const },
];

const whitelistSheetConfig = [
  { name: "综合客户白名单", customerType: "综合客户" as const },
  { name: "特渠客户白名单", customerType: "特渠专业客户" as const },
];

type ProductImportParseResult = {
  rows: ProductImportRow[];
  warnings: string[];
  sheetCounts: Array<{ name: string; count: number }>;
};

function textCell(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

async function parseProductWorkbook(file: File): Promise<ProductImportParseResult> {
  const sheetNames = await readSheetNames(file);
  const warnings: string[] = [];
  const rows: ProductImportRow[] = [];
  const sheetCounts: Array<{ name: string; count: number }> = [];
  const expectedHeaders = ["产品大类", "产品线", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否为标品礼盒", "分公司定制品"];
  const unknownSheets = sheetNames.filter((name) => !productSheetConfig.some((item) => item.name === name));
  if (unknownSheets.length > 0) warnings.push(`已忽略未识别的 Sheet：${unknownSheets.join("、")}`);

  for (const config of productSheetConfig) {
    if (!sheetNames.includes(config.name)) throw new Error(`缺少必要的 Sheet：${config.name}`);
    const matrix = await readXlsxFile(file, { sheet: config.name });
    const header = (matrix[0] ?? []).map(textCell);
    const missingHeaders = expectedHeaders.filter((name) => !header.includes(name));
    if (missingHeaders.length > 0) throw new Error(`${config.name} 缺少字段：${missingHeaders.join("、")}`);
    const indexes = Object.fromEntries(expectedHeaders.map((name) => [name, header.indexOf(name)]));
    let sequence = 0;
    let blankCodeCount = 0;
    const codeRows = new Map<string, number[]>();
    for (let index = 1; index < matrix.length; index += 1) {
      const values = matrix[index] ?? [];
      if (values.every((value) => textCell(value) === "")) continue;
      const get = (name: string) => textCell(values[indexes[name]]);
      const materialCode = get("物料代码");
      const conversion = get("吨箱转换系数");
      const conversionNumber = Number(conversion);
      const casePrice = get("元/箱");
      sequence += 1;
      if (!materialCode) blankCodeCount += 1;
      if (materialCode) {
        const key = materialCode.replace(/\s+/g, "").toUpperCase();
        codeRows.set(key, [...(codeRows.get(key) ?? []), index + 1]);
      }
      rows.push({
        id: createImportRowId("product"),
        sequence,
        customerType: config.customerType,
        rebate: config.rebate,
        category: get("产品大类"),
        line: get("产品线"),
        materialCode,
        materialName: get("物料名称"),
        brand: get("品牌"),
        variety: get("品种"),
        spec: get("规格"),
        casePack: get("箱规"),
        unitPrice: get("元/瓶"),
        casePrice,
        conversion,
        gift: get("是否为标品礼盒") === "是" ? "是" : "否",
        branchScope: get("分公司定制品"),
        source: "excel",
        sourceSheet: config.name,
        sourceRowNumber: index + 1,
        status: !materialCode || !casePrice || !conversion || !Number.isFinite(conversionNumber) || conversionNumber <= 0 ? "待完善" : "有效",
      });
    }
    const duplicateGroups = [...codeRows.values()].filter((rowNumbers) => rowNumbers.length > 1);
    if (duplicateGroups.length > 0) warnings.push(`${config.name} 有 ${duplicateGroups.length} 组重复物料代码，请在确认导入前检查。`);
    if (blankCodeCount > 0) warnings.push(`${config.name} 有 ${blankCodeCount} 条商品没有物料代码，已标记为待完善。`);
    sheetCounts.push({ name: config.name, count: sequence });
  }
  return { rows, warnings, sheetCounts };
}

type WhitelistImportParseResult = {
  rows: WhitelistRow[];
  warnings: string[];
  sheetCounts: Array<{ name: string; count: number }>;
  crossSheetPhoneCount: number;
};

function normalizedHeader(value: unknown) {
  return textCell(value).replace(/\s+/g, "");
}

function findHeaderIndex(header: string[], aliases: readonly string[]) {
  const normalized = header.map(normalizedHeader);
  return aliases.map(normalizedHeader).map((alias) => normalized.findIndex((item) => item === alias || item.includes(alias))).find((index) => index >= 0) ?? -1;
}

async function parseWhitelistWorkbook(file: File): Promise<WhitelistImportParseResult> {
  const sheetNames = await readSheetNames(file);
  const warnings: string[] = [];
  const rows: WhitelistRow[] = [];
  const sheetCounts: Array<{ name: string; count: number }> = [];
  const unknownSheets = sheetNames.filter((name) => !whitelistSheetConfig.some((item) => item.name === name));
  if (unknownSheets.length > 0) warnings.push(`已忽略未识别的 Sheet：${unknownSheets.join("、")}`);

  const requiredColumns = [
    ["序号", ["序号"]],
    ["大区", ["大区"]],
    ["分公司名称", ["分公司名称", "分公司"]],
    ["经销商名称（简）", ["经销商名称（简）", "经销商简称"]],
    ["经销商名称（全）", ["经销商名称（全）", "经销商全称"]],
    ["经销商类型", ["经销商类型", "综合经销商特渠专业经销商"]],
    ["经销商姓名", ["经销商姓名"]],
    ["经销商电话", ["经销商电话"]],
    ["分公司确认人姓名", ["分公司确认人姓名"]],
    ["分公司确认人电话", ["分公司确认人电话"]],
  ] as const;

  for (const config of whitelistSheetConfig) {
    if (!sheetNames.includes(config.name)) throw new Error(`缺少必要的 Sheet：${config.name}`);
    const matrix = await readXlsxFile(file, { sheet: config.name });
    const headerIndex = matrix.findIndex((row) => row.some((value) => normalizedHeader(value).includes("经销商电话")));
    if (headerIndex < 0) throw new Error(`${config.name} 未找到包含“经销商电话”的表头行`);
    const header = (matrix[headerIndex] ?? []).map(textCell);
    const indexes = Object.fromEntries(requiredColumns.map(([label, aliases]) => [label, findHeaderIndex(header, aliases)]));
    const missingHeaders = requiredColumns.filter(([label]) => indexes[label] < 0).map(([label]) => label);
    if (missingHeaders.length > 0) throw new Error(`${config.name} 缺少字段：${missingHeaders.join("、")}`);
    const get = (values: unknown[], label: string) => textCell(values[indexes[label]]);
    const sourceRows = matrix.slice(headerIndex + 1).filter((values) => values.some((value) => textCell(value) !== ""));
    const phoneRows = new Map<string, number[]>();
    const parsedRows = sourceRows.map((values, offset) => {
      const dealerPhone = normalizePhone(get(values, "经销商电话"));
      const rowNumber = headerIndex + offset + 2;
      if (dealerPhone) phoneRows.set(dealerPhone, [...(phoneRows.get(dealerPhone) ?? []), rowNumber]);
      return { values, dealerPhone, rowNumber };
    });
    const duplicatePhones = new Set([...phoneRows.entries()].filter(([, rowNumbers]) => rowNumbers.length > 1).map(([phone]) => phone));
    if (duplicatePhones.size > 0) warnings.push(`${config.name} 有 ${duplicatePhones.size} 个手机号重复，已标记为待处理。`);

    for (const { values, dealerPhone, rowNumber } of parsedRows) {
      const phoneValid = /^1\d{10}$/.test(dealerPhone);
      const status: WhitelistRow["status"] = phoneValid && !duplicatePhones.has(dealerPhone) ? "有效" : "待处理";
      rows.push({
        id: createImportRowId("whitelist"),
        sequence: Number(get(values, "序号")) || rows.length + 1,
        customerType: config.customerType,
        region: get(values, "大区"),
        branch: get(values, "分公司名称"),
        dealerShort: get(values, "经销商名称（简）"),
        dealerFull: get(values, "经销商名称（全）"),
        dealerType: get(values, "经销商类型"),
        dealerName: get(values, "经销商姓名"),
        dealerPhone,
        confirmerName: get(values, "分公司确认人姓名"),
        confirmerPhone: normalizePhone(get(values, "分公司确认人电话")),
        status,
        source: "excel",
        sourceSheet: config.name,
        sourceRowNumber: rowNumber,
        identityKey: `${config.customerType}:${normalizeWhitelistName(get(values, "经销商名称（全）"))}`,
      });
    }
    const blankOrInvalidCount = parsedRows.filter(({ dealerPhone }) => !/^1\d{10}$/.test(dealerPhone)).length;
    if (blankOrInvalidCount > 0) warnings.push(`${config.name} 有 ${blankOrInvalidCount} 条手机号为空或格式异常，已标记为待处理。`);
    sheetCounts.push({ name: config.name, count: sourceRows.length });
  }

  const phonesByType = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.status !== "有效" || !row.dealerPhone) continue;
    const phones = phonesByType.get(row.dealerPhone) ?? new Set<string>();
    phones.add(row.customerType);
    phonesByType.set(row.dealerPhone, phones);
  }
  const crossSheetPhoneCount = [...phonesByType.values()].filter((types) => types.size > 1).length;
  if (crossSheetPhoneCount > 0) warnings.push(`检测到 ${crossSheetPhoneCount} 个手机号同时存在于综合和特渠白名单，已按客户类型分别保留。`);
  return { rows, warnings, sheetCounts, crossSheetPhoneCount };
}

const dealerNames = [
  "上海爱尚真", "江苏徐工电子公司", "江苏四合商贸发展", "北京智享云采经贸", "北京惠通达行商贸",
  "农膳坊健康公司", "北京谷力供应链管理", "湖北中合誉品", "上海高顿", "北京金箔永和贸易",
  "河北金源粮油", "上海迦新", "青岛奥德", "河北惊钰", "石家庄德众",
  "天津益食满城", "山东有机有缘", "山东鲸桥裕", "上海赞畅", "唐山红星",
  "青岛大优供应链", "青岛超祥", "汇德丰贸易", "上海安食记", "河南百企助农",
  "湖北省诚新物流", "北京金联创科贸", "深圳曹销分", "河南满粮商贸", "益丰万立",
];

const branchPageSize = 30;
const reports = [
  "特渠专业客户 TOP5",
  "综合客户 TOP5",
  "总战绩",
  "特渠专业客户金额、综合客户金额及合计",
  "综合客户东、南、北1、北2区金额及合计",
  "礼盒：特渠专业客户金额、综合客户金额及合计",
  "综合客户各产品线金额及合计",
  "特渠专业客户与综合客户各产品线金额及合计",
  "综合客户区域金额与产品线金额同屏展示",
];

const initialLotteryRounds: LotteryRound[] = [
  { id: -1, name: "第一轮", prize: "待配置奖品", winnerCount: 10, customerType: "全部客户", scope: "all", minAmount: 0, excludeWinners: false, status: "draft", candidateCount: 0 },
];

function mapLotteryRule(rule: LotteryRuleApi): LotteryRound[] {
  return rule.rounds.map((round) => ({ id: round.id, ruleId: rule.id, serverStatus: round.status, name: round.name,
    prize: round.prizeName, winnerCount: round.winnerCount,
    customerType: round.customerType === "GENERAL" ? "综合客户" : round.customerType === "SPECIAL" ? "特渠专业客户" : "全部客户",
    scope: round.candidateScope === "ATTENDEES" ? "attended" : round.candidateScope === "VALID_ORDERS" ? "ordered" : "all",
    minAmount: Number(round.minimumOrderAmount),
    excludeWinners: round.excludePreviousWinners, status: round.status === "COMPLETED" ? "completed" : round.status === "DRAFT" ? "draft" : "published",
    candidateCount: round.candidateCount ?? 0 }));
}

function money(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function FestivalDecor() {
  return (
    <>
      <div className="festival-moon" aria-hidden="true"><i /><i /><i /></div>
      <div className="festival-cloud cloud-a" aria-hidden="true" />
      <div className="festival-cloud cloud-b" aria-hidden="true" />
      <div className="festival-mountains" aria-hidden="true"><i /><i /><i /><i /></div>
    </>
  );
}

function ProductArt({ atlas, imageUrl, alt = "商品图片" }: { atlas: number; imageUrl?: string; alt?: string }) {
  return imageUrl ? <img className="product-art product-photo" src={imageUrl} alt={alt} /> : <span className={`product-art atlas-${atlas}`} role="img" aria-label="临时商品图" />;
}

type PreviewImage = { url: string; fileName?: string };

function ProductImageViewer({ productName, images, initialIndex = 0, status, onClose }: { productName: string; images: PreviewImage[]; initialIndex?: number; status?: string; onClose: () => void }) {
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
    <div className="product-image-viewer" role="dialog" aria-modal="true" aria-label={`${productName}图片预览`} onClick={onClose}>
      <div className="product-image-viewer-panel" onClick={(event) => event.stopPropagation()}>
        <header><div><b>{productName}</b><small>{images.length > 1 ? `${activeIndex + 1} / ${images.length}` : "商品图片"}{status ? ` · ${status}` : ""}</small></div><button type="button" aria-label="关闭图片预览" onClick={onClose}>×</button></header>
        <div className={`product-image-viewer-stage ${zoomed ? "zoomed" : ""}`} onTouchStart={(event) => { touchStartX.current = event.touches[0].clientX; }} onTouchEnd={handleTouchEnd}>
          {images.length > 1 && <button type="button" className="product-image-viewer-arrow prev" aria-label="上一张图片" onClick={() => goTo(activeIndex - 1)}>‹</button>}
          <img src={currentImage.url} alt={`${productName} ${activeIndex + 1}`} onClick={() => setZoomed((value) => !value)} />
          {images.length > 1 && <button type="button" className="product-image-viewer-arrow next" aria-label="下一张图片" onClick={() => goTo(activeIndex + 1)}>›</button>}
        </div>
        <footer><span>{currentImage.fileName || `${activeIndex + 1} / ${images.length}`}</span><button type="button" className="product-image-viewer-zoom" onClick={() => setZoomed((value) => !value)}>{zoomed ? "还原大小" : "放大图片"}</button></footer>
        {images.length > 1 && <div className="product-image-viewer-thumbs" aria-label="图片缩略图列表">{images.map((image, index) => <button type="button" key={`${image.url}-${index}`} className={index === activeIndex ? "active" : ""} aria-label={`查看第 ${index + 1} 张图片`} onClick={() => goTo(index)}><img src={image.url} alt="" /></button>)}</div>}
      </div>
    </div>
  );
}

type SubmittedOrderItem = { product: Product; quantity: number };

function H5Prototype({ activityClosed, importedRows, importedWhitelistRows, runtimeActivity }: { activityClosed: boolean; importedRows: ProductImportRow[] | null; importedWhitelistRows: WhitelistRow[] | null; runtimeActivity: RuntimeActivity | null }) {
  const [runtimeProducts, setRuntimeProducts] = useState<RuntimeProduct[] | null>(null);
  const [runtimeIdentity, setRuntimeIdentity] = useState<RuntimeIdentity | null>(null);
  const [runtimeOrder, setRuntimeOrder] = useState<RuntimeOrder | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeMessage, setRuntimeMessage] = useState("");
  const catalog = useMemo(() => runtimeProducts ? runtimeProducts.map(runtimeProductToProduct) : importedRows ? importedRows.map(productRowToProduct) : [], [runtimeProducts, importedRows]);
  const [step, setStep] = useState<H5Step>("channel");
  const [channel, setChannel] = useState<H5Channel>("");
  const [region, setRegion] = useState("");
  const [verifiedBranch, setVerifiedBranch] = useState("");
  const [verifiedIdentity, setVerifiedIdentity] = useState<WhitelistRow | null>(null);
  const [submittedIdentity, setSubmittedIdentity] = useState<WhitelistRow | null>(null);
  const [phone, setPhone] = useState("");
  const [verifyError, setVerifyError] = useState("");
  const [rebate, setRebate] = useState(true);
  const [line, setLine] = useState("全部");
  const [search, setSearch] = useState("");
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [orderStatus, setOrderStatus] = useState<H5OrderStatus>("none");
  const [submitMode, setSubmitMode] = useState<"first" | "update">("first");
  const [orderVersion, setOrderVersion] = useState(0);
  const [orderUpdatedAt, setOrderUpdatedAt] = useState("");
  const [orderWithdrawnAt, setOrderWithdrawnAt] = useState("");
  const [orderEvents, setOrderEvents] = useState<Array<{ time: string; title: string; detail: string }>>([]);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [submittedQuantities, setSubmittedQuantities] = useState<Record<string, number>>({});
  const [submittedItems, setSubmittedItems] = useState<SubmittedOrderItem[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const regionOptions = runtimeActivity?.regions?.length
    ? runtimeActivity.regions.map((item) => ({ value: item.code, name: item.name, detail: `${item.name}综合经销商` }))
    : [
        { value: "东区", name: "东区", detail: "华东区域综合经销商" },
        { value: "南区", name: "南区", detail: "华南区域综合经销商" },
        { value: "北1区", name: "北1区", detail: "华北一部综合经销商" },
        { value: "北2区", name: "北2区", detail: "华北二部综合经销商" },
      ];
  const selectedRegionName = regionOptions.find((item) => item.value === region)?.name || region;
  const lineOptions = useMemo(() => ["全部", ...Array.from(new Set(catalog.map((product) => product.line).filter(Boolean)))], [catalog]);
  const effectiveLine = lineOptions.includes(line) ? line : "全部";
  const h5CustomerType = channel === "综合客户" ? "综合" : "特渠";
  const visibleProducts = catalog.filter(
    (p) => p.status === "有效" || p.status === "待完善"
      && (p.customerType === "全部" || p.customerType === h5CustomerType)
      && p.rebate === rebate
      && (p.branchScope.length === 0 || p.branchScope.includes(verifiedBranch))
      && (effectiveLine === "全部" || p.line === effectiveLine)
      && p.name.includes(search),
  );
  const selected = catalog.filter((p) => (quantities[p.id] || 0) > 0);
  const totalBoxes = selected.reduce((sum, p) => sum + quantities[p.id], 0);
  const totalAmount = selected.reduce((sum, p) => sum + quantities[p.id] * p.price, 0);
  const orderViewQuantities = submittedQuantities;
  const orderViewSelected = submittedItems.map((item) => item.product);
  const orderViewBoxes = orderViewSelected.reduce((sum, p) => sum + orderViewQuantities[p.id], 0);
  const orderViewAmount = orderViewSelected.reduce((sum, p) => sum + orderViewQuantities[p.id] * p.price, 0);
  const importedIdentity = verifiedIdentity ?? submittedIdentity;
  const identityRegionCode = runtimeIdentity?.regionCode || importedIdentity?.region || region;
  const identityRegion = regionOptions.find((item) => item.value === identityRegionCode)?.name || identityRegionCode;
  const identityBranch = runtimeIdentity?.branchName || importedIdentity?.branch || verifiedBranch;
  const identityLabel = runtimeIdentity
    ? `${runtimeIdentity.customerType === "GENERAL" ? "综合客户" : "特渠专业客户"}${identityRegion ? ` · ${identityRegion}` : ""}`
    : importedIdentity ? `${importedIdentity.customerType}${identityRegion ? ` · ${identityRegion}` : ""}` : channel === "综合客户" ? `综合客户 · ${selectedRegionName}` : "特渠专业客户";
  const dealerName = runtimeIdentity?.dealerFullName || importedIdentity?.dealerFull || "—";
  const displayBranch = runtimeIdentity?.branchName || identityBranch;
  const displayPhone = runtimeIdentity?.phoneMasked || (importedIdentity ? maskPhone(importedIdentity.dealerPhone) : "—");

  const applyRuntimeOrder = (order: RuntimeOrder | null, liveCatalog: Product[]) => {
    setRuntimeOrder(order);
    if (!order) {
      setOrderStatus("none"); setOrderVersion(0); setSubmittedQuantities({}); setSubmittedItems([]); setOrderEvents([]);
      return;
    }
    const itemQuantities: Record<string, number> = {};
    const items = order.items.map((item) => {
      const id = String(item.productId);
      itemQuantities[id] = item.quantity;
      const found = liveCatalog.find((product) => product.id === id) || {
        id, name: item.materialName, line: item.productLine || "未分类", spec: item.specification || "", price: Number(item.casePrice),
        rebate: true, gift: false, atlas: 0, customerType: "全部" as const, branchScope: [], status: "有效" as const, isOrderable: true,
      };
      return { product: found, quantity: item.quantity };
    });
    setQuantities(itemQuantities); setSubmittedQuantities(itemQuantities); setSubmittedItems(items);
    setOrderStatus(order.status === "WITHDRAWN" ? "withdrawn" : "submitted");
    setOrderVersion(order.currentVersion);
    setOrderUpdatedAt(new Date(order.lastModifiedAt).toLocaleString("zh-CN", { hour12: false }));
    setOrderWithdrawnAt(order.withdrawnAt ? new Date(order.withdrawnAt).toLocaleString("zh-CN", { hour12: false }) : "");
    setOrderEvents(order.operations.map((event) => ({
      time: new Date(event.occurredAt).toLocaleString("zh-CN", { hour12: false }),
      title: event.type === "WITHDRAW" ? "客户撤回订单" : event.type === "SUBMIT" ? "客户首次提交" : "客户修改并重新提交",
      detail: `经销商手机端 · ${event.orderVersion ? `版本 V${event.orderVersion}` : "订单状态变更"}`,
    })));
  };

  const changeQty = (id: string, delta: number) => {
    setQuantities((old) => ({ ...old, [id]: Math.max(0, (old[id] || 0) + delta) }));
  };

  const startEditingOrder = () => {
    if (orderStatus === "withdrawn") setQuantities({ ...submittedQuantities });
    setStep("order");
  };

  const verifyIdentity = async () => {
    if (activityClosed && orderStatus === "none") return;
    const normalizedPhone = normalizePhone(phone);
    if (runtimeActivity) {
      setRuntimeBusy(true); setVerifyError(""); setRuntimeMessage("");
      try {
        const identity = await verifyPhone(channel === "综合客户" ? "GENERAL" : "SPECIAL", region, normalizedPhone);
        const liveRows = await loadH5Products();
        const liveCatalog = liveRows.map(runtimeProductToProduct);
        const order = await loadH5Order();
        setRuntimeIdentity(identity); setRuntimeProducts(liveRows); setVerifiedBranch(identity.branchName || "");
        applyRuntimeOrder(order, liveCatalog);
        setStep(order ? "submitted" : "order");
      } catch (error) {
        setVerifyError(error instanceof ApiError ? error.message : "连接服务失败，请稍后重试。");
      } finally { setRuntimeBusy(false); }
      return;
    }
    if (importedWhitelistRows) {
      const expectedType: WhitelistRow["customerType"] = channel === "综合客户" ? "综合客户" : "特渠专业客户";
      const identity = importedWhitelistRows.find((item) => item.status === "有效" && item.customerType === expectedType && normalizePhone(item.dealerPhone) === normalizedPhone);
      if (!identity) {
        const otherChannelIdentity = importedWhitelistRows.find((item) => item.status === "有效" && normalizePhone(item.dealerPhone) === normalizedPhone);
        setVerifyError(otherChannelIdentity ? `该手机号登记在${otherChannelIdentity.customerType}白名单中，请返回选择对应订货通道。` : "该手机号不在本次活动白名单中，请核对后重新输入。");
        return;
      }
      if (expectedType === "综合客户" && identity.region !== region) {
        setVerifyError(`该手机号登记为综合客户 · ${identity.region}，请重新选择订货大区。`);
        return;
      }
      setVerifyError("");
      setVerifiedIdentity(identity);
      setVerifiedBranch(identity.branch);
      setStep(orderStatus === "none" ? "order" : "submitted");
      return;
    }
    setVerifyError("订货服务暂不可用，请稍后刷新页面重试。");
  };

  const submitOrder = async () => {
    if (runtimeActivity) {
      setRuntimeBusy(true); setRuntimeMessage("");
      try {
        const isFirstSubmit = !runtimeOrder;
        const order = await saveH5Order(runtimeOrder?.currentVersion || 0,
          selected.map((product) => ({ productId: Number(product.id), quantity: quantities[product.id] })));
        setSubmitMode(isFirstSubmit ? "first" : "update");
        setSubmittedIdentity(verifiedIdentity ? { ...verifiedIdentity } : null);
        applyRuntimeOrder(order, catalog);
        setStep("success");
      } catch (error) {
        setRuntimeMessage(error instanceof ApiError ? error.message : "订单提交失败，请稍后重试。");
      } finally { setRuntimeBusy(false); }
      return;
    }
    setRuntimeMessage("订货服务暂不可用，订单未提交，请稍后重试。");
  };

  const withdrawOrder = async () => {
    if (runtimeActivity && runtimeOrder) {
      setRuntimeBusy(true); setRuntimeMessage("");
      try {
        const order = await withdrawH5Order(runtimeOrder.currentVersion);
        applyRuntimeOrder(order, catalog); setCancelConfirmOpen(false); setCartOpen(false); setStep("submitted");
      } catch (error) {
        setRuntimeMessage(error instanceof ApiError ? error.message : "订单撤回失败，请稍后重试。");
      } finally { setRuntimeBusy(false); }
      return;
    }
    setRuntimeMessage("订货服务暂不可用，订单未撤回，请稍后重试。");
  };

  return (
    <div className="h5-stage">
      <div className="device-caption">
        <span>客户订货 H5</span>
        <small>手机端 · 实时业务数据</small>
      </div>
      <div className="phone-shell">
        <div className="phone-screen">
          <FestivalDecor />
          {step === "channel" && (
            <section className="h5-page verify-page entry-page">
              <div className="mini-brand"><b>金龙鱼</b><span>调味品事业部</span></div>
              <div className="h5-hero-copy entry-hero">
                <span className="eyebrow">订货会</span>
                <h1>月满家圆<br /><em>味启新程</em></h1>
                <p>新品发布及旺季动员会</p>
              </div>
              <div className="verify-card entry-card">
                <span className="step-tag">订货通道</span>
                <h2>选择您的订货通道</h2>
                <p>请选择白名单中登记的客户类型，进入对应订货专区。</p>
                <div className="channel-options">
                  <button onClick={() => { setChannel("综合客户"); setRegion(""); setVerifiedBranch(""); setVerifiedIdentity(null); setStep("region"); }}>
                    <i className="channel-icon">综</i>
                    <span><b>综合客户订货</b><small>综合经销商 · 进入后选择所属大区</small></span>
                    <em>›</em>
                  </button>
                  <button onClick={() => { setChannel("特渠专业客户"); setRegion(""); setVerifiedBranch(""); setVerifiedIdentity(null); setStep("verify"); }}>
                    <i className="channel-icon special">特</i>
                    <span><b>特渠专业客户订货</b><small>专业渠道经销商 · 手机号验证身份</small></span>
                    <em>›</em>
                  </button>
                </div>
                <small>通道选择不会改变白名单中的客户身份</small>
              </div>
            </section>
          )}

          {step === "region" && (
            <section className="h5-page verify-page entry-page">
              <div className="entry-nav"><button onClick={() => setStep("channel")}>‹</button><span>综合客户订货</span></div>
              <div className="mini-brand"><b>金龙鱼</b><span>调味品事业部</span></div>
              <div className="h5-hero-copy region-hero">
                <span className="eyebrow">订货会</span>
                <h1>选择所属<br /><em>经营大区</em></h1>
                <p>请按白名单登记信息选择</p>
              </div>
              <div className="verify-card entry-card region-card">
                <span className="step-tag">综合客户</span>
                <h2>请选择所属大区</h2>
                <p>验证手机号时，系统会再次核对客户类型和经营区域。</p>
                <div className="region-options">
                {regionOptions.map((item) => (
                    <button key={item.value} onClick={() => { setRegion(item.value); setStep("verify"); }}>
                      <i>{item.name.slice(0, 1)}</i><b>{item.name}</b><small>{item.detail}</small>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {step === "verify" && (
            <section className="h5-page verify-page">
              <div className="entry-nav"><button onClick={() => setStep(channel === "综合客户" ? "region" : "channel")}>‹</button><span>{identityLabel}</span></div>
              <div className="mini-brand"><b>金龙鱼</b><span>调味品事业部</span></div>
              <div className="h5-hero-copy">
                <span className="eyebrow">订货会</span>
                <h1>月满家圆<br /><em>味启新程</em></h1>
                <p>新品发布及旺季动员会</p>
              </div>
              <div className="verify-card">
                <div className="verify-context"><span className="step-tag">{identityLabel}</span><button onClick={() => setStep("channel")}>重新选择</button></div>
                <h2>输入白名单手机号</h2>
                <p>验证通过后，将为您展示{channel === "综合客户" ? `${selectedRegionName}综合客户` : "特渠专业客户"}的订货商品。</p>
                <label>
                  <span>手机号</span>
                  <input value={phone} onChange={(e) => { setPhone(e.target.value); setVerifyError(""); }} inputMode="tel" />
                </label>
                {verifyError && <div className="verify-error" role="alert">{verifyError}</div>}
                <button className="primary-btn" disabled={runtimeBusy || !phone.trim() || (activityClosed && orderStatus === "none")} onClick={() => void verifyIdentity()}>{runtimeBusy ? "正在验证…" : activityClosed && orderStatus === "none" ? "活动已截止" : orderStatus === "none" ? "验证并进入订货" : "验证并查看订单"}</button>
                {runtimeMessage && <div className="verify-error" role="status">{runtimeMessage}</div>}
                <small>{activityClosed && orderStatus === "none" ? "订货活动已截止，暂不接受新订单" : "仅用于本次订货会身份识别"}</small>
              </div>
            </section>
          )}

          {step === "order" && (
            <section className="h5-page order-page">
              <header className="order-header">
                <button className="text-btn" onClick={() => setStep(orderStatus === "none" ? "verify" : "submitted")}>‹</button>
                <div><b>订货会</b><span>{identityLabel}</span></div>
                <button className="round-btn" aria-label="更多">•••</button>
              </header>
              <div className="dealer-card">
                <span>已识别经销商</span>
                <b>{dealerName}</b>
                <small>{identityLabel} · {displayBranch || "未标注分公司"} · {importedIdentity?.dealerName || "已验证客户"} · 手机 {displayPhone}</small>
              </div>
              <div className="policy-note"><b>订货提示</b><span>{activityClosed ? "活动已截止，当前订单仅可查看。" : "所有商品按箱订购，提交后可在截止时间前修改或取消本次订货。"}</span></div>
              <div className="product-toolbar">
                <div className="segment">
                  <button className={rebate ? "active" : ""} onClick={() => setRebate(true)}>返利产品</button>
                  <button className={!rebate ? "active" : ""} onClick={() => setRebate(false)}>非返利产品</button>
                </div>
                <label className="search-box">⌕<input placeholder="搜索商品" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
              </div>
              <div className="line-tabs">
                {lineOptions.map((item) => (
                  <button key={item} className={line === item ? "active" : ""} onClick={() => setLine(item)}>{item}</button>
                ))}
              </div>
              <div className="product-list">
                {visibleProducts.map((product) => (
                  <article className="product-card" key={product.id}>
                    <button type="button" className="product-image product-image-button" disabled={!product.imageUrls?.length} aria-label={`查看${product.name}商品图片`} onClick={() => product.imageUrls?.length && setPreviewProduct(product)}><ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} /></button>
                    <div className="product-info">
                      <h3>{product.name}</h3>
                      <div className="product-action">
                        <strong>{product.isOrderable ? <>¥{money(product.price)}<small>/箱</small></> : "价格待完善"}</strong>
                        <div className="stepper">
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)} disabled={activityClosed || !product.isOrderable || !quantities[product.id]}>−</button>
                          <input aria-label={`${product.name}订货箱数`} disabled={activityClosed} inputMode="numeric" type="number" min="0" max="9999" value={quantities[product.id] || 0} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQuantities({ ...quantities, [product.id]: Math.min(9999, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)} disabled={activityClosed || !product.isOrderable}>＋</button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {visibleProducts.length === 0 && <div className="empty-state">没有符合条件的商品</div>}
              </div>
              <div className="order-bar">
                <button className="cart-summary" disabled={activityClosed || !totalBoxes} onClick={() => setCartOpen(true)}>
                  <span>已选 {selected.length} 种 · {totalBoxes} 箱 <em>查看明细⌃</em></span><b>¥{money(totalAmount)}</b>
                </button>
                <button className="confirm-cart-btn" disabled={activityClosed || (!totalBoxes && orderStatus === "none")} onClick={() => totalBoxes ? setStep("confirm") : setCancelConfirmOpen(true)}>{totalBoxes ? "确认订单" : "取消本次订货"}</button>
              </div>
            </section>
          )}

          {step === "order" && cartOpen && (
            <div className="cart-sheet-layer">
              <button className="cart-sheet-backdrop" aria-label="关闭购物明细" onClick={() => setCartOpen(false)} />
              <section className="cart-sheet" aria-label="已选商品明细">
                <header><div><b>已选商品</b><span>{selected.length} 种 · {totalBoxes} 箱</span></div><button disabled={!selected.length} onClick={() => setQuantities({})}>清空</button></header>
                <div className="cart-sheet-list">
                  {selected.map((product) => (
                    <article key={product.id}>
                      <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
                      <div className="cart-item-info">
                        <b>{product.name}</b>
                        <span>¥{money(product.price)}/箱</span>
                        <strong>小计 ¥{money(product.price * quantities[product.id])}</strong>
                      </div>
                      <div className="cart-item-actions">
                        <button className="remove-item" disabled={activityClosed} onClick={() => setQuantities((old) => ({ ...old, [product.id]: 0 }))}>删除</button>
                        <div className="stepper">
                          <button aria-label={`${product.name}减少一箱`} onClick={() => changeQty(product.id, -1)} disabled={activityClosed}>−</button>
                          <input aria-label={`${product.name}订货箱数`} disabled={activityClosed} inputMode="numeric" type="number" min="0" max="9999" value={quantities[product.id]} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setQuantities({ ...quantities, [product.id]: Math.min(9999, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} />
                          <button aria-label={`${product.name}增加一箱`} onClick={() => changeQty(product.id, 1)} disabled={activityClosed}>＋</button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {!selected.length && <div className="cart-empty">还没有选择商品</div>}
                </div>
                <footer><div><span>合计</span><b>¥{money(totalAmount)}</b><small>共 {totalBoxes} 箱</small></div><button disabled={activityClosed || (!totalBoxes && orderStatus === "none")} onClick={() => { setCartOpen(false); if (totalBoxes) setStep("confirm"); else setCancelConfirmOpen(true); }}>{totalBoxes ? "去确认订单" : "取消本次订货"}</button></footer>
              </section>
            </div>
          )}

          {step === "confirm" && (
            <section className="h5-page confirm-page">
              <header className="simple-header"><button onClick={() => setStep("order")}>‹</button><b>确认订单</b><span /></header>
              <div className="confirm-hero"><span>请核对订货信息</span><h2>{dealerName}</h2><small>{identityLabel}{identityBranch ? ` · ${identityBranch}` : ""}</small></div>
              <div className="confirm-list">
                {selected.map((product) => (
                  <div key={product.id}>
                    <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
                    <p><b>{product.name}</b><span>¥{money(product.price)}/箱</span></p>
                    <strong>× {quantities[product.id]}</strong>
                  </div>
                ))}
              </div>
              <div className="summary-card">
                <p className="grand-total"><span>订单总金额</span><b>¥{money(totalAmount)}</b></p>
              </div>
              <label className="agreement"><input type="checkbox" defaultChecked /> 我已核对商品与订货数量</label>
              {runtimeMessage && <div className="verify-error" role="alert">{runtimeMessage}</div>}
              <button className="submit-order" disabled={activityClosed || runtimeBusy} onClick={() => void submitOrder()}>{runtimeBusy ? "正在提交…" : orderStatus === "none" ? "确认提交订单" : orderStatus === "withdrawn" ? "重新提交订单" : "确认修改并提交"}</button>
            </section>
          )}

          {step === "submitted" && (
            <section className="h5-page submitted-page">
              <header className="simple-header"><button onClick={() => setStep("verify")}>‹</button><b>我的订单</b><span /></header>
              <div className={`submitted-state-card ${orderStatus === "withdrawn" ? "withdrawn" : ""}`}>
                <span className="submitted-status">{orderStatus === "withdrawn" ? "已撤回" : "已提交"}</span>
                <h2>{orderStatus === "withdrawn" ? "当前订单已撤回" : "您的订货已成功提交"}</h2>
                <p>{orderStatus === "withdrawn" ? "商品明细和订单号已保留，截止前可继续订货并重新提交。" : "订单截止前可修改或取消本次订货，修改后将以最新提交内容为准。"}</p>
              </div>
              <div className="submitted-meta">
                <p><span>订单编号</span><b>{runtimeOrder?.orderNo || "ZYORDER280018"}</b></p>
                <p><span>最后提交时间</span><b>{orderUpdatedAt}</b></p>
                <p><span>当前版本</span><b>V{orderVersion}</b></p>
                <p><span>编辑权限</span><b className={activityClosed ? "muted" : ""}>{activityClosed ? "已截止" : orderStatus === "withdrawn" ? "可重新提交" : "可修改或取消"}</b></p>
                {orderStatus === "withdrawn" && orderWithdrawnAt && <p><span>取消时间</span><b>{orderWithdrawnAt}</b></p>}
                <p><span>经销商</span><b>{dealerName}</b></p>
              </div>
              <div className="confirm-list submitted-list">
                {orderViewSelected.map((product) => (
                  <div key={product.id}>
                    <ProductArt atlas={product.atlas} imageUrl={product.imageUrl} alt={product.name} />
                    <p><b>{product.name}</b><span>¥{money(product.price)}/箱</span></p>
                    <strong>× {orderViewQuantities[product.id]}</strong>
                  </div>
                ))}
              </div>
              <div className="summary-card">
                <p className="grand-total"><span>订单总金额</span><b>¥{money(orderViewAmount)}</b></p>
                <p><span>订货数量</span><b>{orderViewBoxes} 箱 · {orderViewSelected.length} 种商品</b></p>
              </div>
              <div className="submitted-note">{activityClosed ? "活动已截止，当前订单仅可查看，不能修改、取消或重新提交。" : orderStatus === "withdrawn" ? "该订单当前不计入有效订单、金额统计和抽奖资格；截止前可点击“继续订货”恢复提交。" : "订单状态会同步至管理后台和活动看板；如需调整商品或数量，请点击“修改订单”。"}</div>
              {orderEvents.length > 0 && <section className="submitted-events"><h3>操作记录</h3>{orderEvents.map((event, index) => <p key={`${event.time}-${index}`}><b>{event.time.slice(11)} {event.title}</b><span>{event.detail}</span></p>)}</section>}
              <div className="submitted-actions">
                {!activityClosed && (orderStatus === "withdrawn" ? <button className="primary-btn" onClick={startEditingOrder}>继续订货</button> : <button className="primary-btn" onClick={startEditingOrder}>修改订单</button>)}
                <button className="ghost-btn" onClick={() => setStep("channel")}>返回活动首页</button>
              </div>
            </section>
          )}

          {step === "success" && (
            <section className="h5-page success-page">
              <div className="success-mark">✓</div>
              <span>{submitMode === "first" ? "提交成功" : "修改成功"}</span>
              <h2>{submitMode === "first" ? "您的订货已成功提交" : "订单修改已重新提交"}</h2>
              <p>订单编号：{runtimeOrder?.orderNo || "ZYORDER280018"}</p>
              <div className="success-amount"><span>订单总金额</span><b>¥{money(totalAmount)}</b><small>{totalBoxes} 箱 · {selected.length} 种商品</small></div>
              <div className="success-note">订单号保持不变，截止前您可以再次进入并修改或取消本次订货。看板将在数秒内同步最新数据。</div>
              <button className="primary-btn" onClick={() => setStep("submitted")}>查看订单</button>
              <button className="ghost-btn" onClick={() => { setChannel(""); setRegion(""); setVerifiedBranch(""); setVerifiedIdentity(null); setStep("channel"); }}>返回活动首页</button>
            </section>
          )}
          {cancelConfirmOpen && (
            <div className="h5-modal-layer" role="dialog" aria-modal="true" aria-label="取消本次订货确认">
              <div className="h5-modal">
                <h3>确认取消本次订货？</h3>
                <p>取消后不会生成空订单，系统会保留最近一次非空提交的商品、金额和订单号，并将当前订单标记为已撤回。</p>
                {runtimeMessage && <div className="verify-error" role="alert">{runtimeMessage}</div>}
                <div><button className="ghost-btn" onClick={() => setCancelConfirmOpen(false)}>继续修改</button><button className="primary-btn" disabled={runtimeBusy} onClick={() => void withdrawOrder()}>{runtimeBusy ? "正在处理…" : "确认取消"}</button></div>
              </div>
            </div>
          )}
        </div>
      </div>
      {previewProduct && <ProductImageViewer productName={previewProduct.name} images={(previewProduct.imageUrls ?? []).map((url, index) => ({ url, fileName: `${previewProduct.name} · 第 ${index + 1} 张` }))} onClose={() => setPreviewProduct(null)} />}
    </div>
  );
}

function RankingBoard({ activity }: { activity: RuntimeActivity | null }) {
  const [channel, setChannel] = useState("SPECIAL");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const options = useMemo(() => [
    { value: "SPECIAL", label: "特渠专业客户" },
    ...(activity?.regions ?? []).map((region) => ({ value: `GENERAL:${region.code}`, label: `综合${region.name}` })),
  ], [activity]);
  const effectiveChannel = options.some((option) => option.value === channel) ? channel : options[0]?.value ?? "SPECIAL";
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [customerType, regionCode] = effectiveChannel.split(":");
      try {
        const data = await loadDashboard({ customerType, regionCode });
        if (active) { setDashboard(data); setError(""); }
      } catch (reason) { if (active) setError(reason instanceof ApiError ? reason.message : "看板数据加载失败"); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
      const events = new EventSource(`${apiBase()}/screen/activities/${encodeURIComponent(getActiveActivityCode())}/events`);
    events.addEventListener("invalidate", () => void refresh());
    return () => { active = false; window.clearInterval(timer); events.close(); };
  }, [effectiveChannel]);
  const ranking = dashboard?.companies ?? [];
  const branchRanking = dashboard?.branches ?? [];
  const chunkSize = Math.max(1, Math.ceil(ranking.length / 3));
  const isBranchOverflowing = branchRanking.length > branchPageSize;
  const selectedLabel = options.find((option) => option.value === effectiveChannel)?.label ?? "订货";
  const totalAmount = Number(dashboard?.totals.total_amount ?? 0);
  const totalTons = dashboard?.totals.total_tons;

  return (
    <section className="screen-board ranking-board">
      <FestivalDecor />
      <header className="screen-title">
        <div className="screen-metric"><span>订单金额</span><strong>{totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small>元</small></strong></div>
        <div className="ranking-heading">
          <h1>{selectedLabel}订货排行</h1>
          <label>当前看板
            <select value={effectiveChannel} onChange={(e) => setChannel(e.target.value)}>
              {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>
        <div className="screen-metric"><span>累计订货</span><strong>{totalTons == null ? "待完善" : Number(totalTons).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}<small>{totalTons == null ? "" : "吨"}</small></strong></div>
      </header>
      {error && <div className="warning-box"><b>实时数据连接异常</b><span>{error}</span></div>}
      <div className="ranking-layout">
        <div className="ranking-columns">
          {[0, chunkSize, chunkSize * 2].map((start) => (
            <div className="rank-column" key={start}>
              <h2>公司订单金额排行 {ranking.length ? start + 1 : 0}–{Math.min(start + chunkSize, ranking.length)}<small>单位：元</small></h2>
              {ranking.slice(start, start + chunkSize).map((item) => (
                <div className={`rank-row ${item.rank <= 3 ? "top-three" : ""}`} key={item.rank}>
                  <span className={item.rank <= 6 ? "crown" : ""}><i aria-hidden="true">{item.rank <= 6 ? "♛" : ""}</i> {item.rank}</span>
                  <b>{item.name}</b>
                  <strong>{Number(item.amount).toLocaleString()}元</strong>
                </div>
              ))}
              {ranking.length === 0 && start === 0 && <div className="order-empty-row">暂无有效订单</div>}
            </div>
          ))}
        </div>
        <aside className={`branch-rank${isBranchOverflowing ? " branch-rank-scrollable" : ""}`}>
          <h2>分公司订货榜</h2>
          {branchRanking.map((branch, index) => (
            <div className={index < 5 ? "branch-top-five" : ""} key={branch.name}><span className={index < 5 ? "crown" : ""}><i aria-hidden="true">{index < 5 ? "♛" : ""}</i> {index + 1}</span><b>{branch.name || "未分公司"}</b><strong>{Number(branch.amount).toLocaleString()}元</strong></div>
          ))}
          {branchRanking.length === 0 && <div className="order-empty-row">暂无分公司数据</div>}
        </aside>
      </div>
    </section>
  );
}

function MetricTable({ title, labels, values, kind = "category" }: { title: string; labels: string[]; values: number[]; kind?: "area" | "product" | "category" }) {
  return (
    <div className={`metric-table metric-table-${kind}`}>
      <i className="metric-frame-corner corner-tl" aria-hidden="true" /><i className="metric-frame-corner corner-tr" aria-hidden="true" /><i className="metric-frame-corner corner-bl" aria-hidden="true" /><i className="metric-frame-corner corner-br" aria-hidden="true" />
      <h2><span className="metric-table-title">{title}</span></h2>
      <div className="metric-head"><span><i className="metric-column-icon" aria-hidden="true" />分类</span><span><i className="metric-amount-icon" aria-hidden="true" />金额（元）</span></div>
      {labels.map((label, index) => <div key={label}><span>{label}</span><b>{values[index].toLocaleString()}</b></div>)}
      <div className="metric-total"><span>合计</span><b>{values.reduce((a, b) => a + b, 0).toLocaleString()}</b></div>
    </div>
  );
}

function ReportBoard({ activity }: { activity: RuntimeActivity | null }) {
  const [report, setReport] = useState(reports[2]);
  const [data, setData] = useState<DashboardReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try { const next = await loadDashboardReport(report); if (active) { setData(next); setError(""); } }
      catch (reason) { if (active) setError(reason instanceof ApiError ? reason.message : "战报数据加载失败"); }
    };
    void refresh();
    const timer = window.setInterval(refresh, 15000);
      const events = new EventSource(`${apiBase()}/screen/activities/${encodeURIComponent(getActiveActivityCode())}/events`);
    events.addEventListener("invalidate", () => void refresh());
    return () => { active = false; window.clearInterval(timer); events.close(); };
  }, [report]);
  const isTop = report.includes("TOP5");
  const isTotal = report === "总战绩";
  const isDual = report === reports[8];
  const displayTitles: Record<string, string> = {
    "特渠专业客户金额、综合客户金额及合计": "特渠专业客户+综合客户",
    "礼盒：特渠专业客户金额、综合客户金额及合计": "礼盒",
    "综合客户各产品线金额及合计": "综合客户",
    "特渠专业客户与综合客户各产品线金额及合计": "特渠专业客户+综合客户",
  };
  const displayTitle = displayTitles[report] ?? report;
  const typeValues = (report.includes("礼盒") ? data?.giftCustomerTypes : data?.customerTypes) ?? [];
  const typeAmount = (type: string) => Number(typeValues.find((item) => item.customerType === type)?.amount ?? 0);
  const regionLabels = (activity?.regions ?? []).map((region) => region.name);
  const regionValues = (activity?.regions ?? []).map((region) => Number(data?.regions.find((item) => item.regionCode === region.code)?.amount ?? 0));
  const productLineRows = report === "综合客户各产品线金额及合计"
    ? data?.generalProductLines ?? []
    : data?.dashboard.productLines ?? [];
  const topRows = report.startsWith("特渠") ? data?.topSpecial ?? [] : data?.topGeneral ?? [];
  const totalAmount = Number(data?.dashboard.totals.total_amount ?? 0);
  return (
    <section className="screen-board report-board">
      <FestivalDecor />
      <header className="report-header">
        <span>调味品事业部新品发布及旺季动员会</span>
        <h1>月满家圆 · 味启新程</h1>
        <label>当前看板：
          <select value={report} onChange={(e) => setReport(e.target.value)}>
            {reports.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </header>
      {error && <div className="warning-box"><b>实时数据连接异常</b><span>{error}</span></div>}
      <div className={`report-content ${isDual ? "dual" : ""}`}>
        {isTotal ? (
          <div className="total-performance"><span>总战绩</span><strong>{totalAmount >= 100000000 ? (totalAmount / 100000000).toFixed(2) : totalAmount.toLocaleString()}<small>{totalAmount >= 100000000 ? "亿" : "元"}</small></strong></div>
        ) : isTop ? (
          <div className="top-five">
            <i className="metric-frame-corner corner-tl" aria-hidden="true" /><i className="metric-frame-corner corner-tr" aria-hidden="true" /><i className="metric-frame-corner corner-bl" aria-hidden="true" /><i className="metric-frame-corner corner-br" aria-hidden="true" />
            <h2>{report}</h2>
            {topRows.map((item) => <div key={item.name}><span>{item.rank}</span><b>{item.name}<small> · {Number(item.amount).toLocaleString()} 元</small></b></div>)}
            {topRows.length === 0 && <div className="order-empty-row">暂无有效订单</div>}
          </div>
        ) : isDual ? (
          <>
            <MetricTable kind="area" title="综合客户 · 区域" labels={regionLabels} values={regionValues} />
            <MetricTable kind="product" title="综合客户 · 产品线" labels={(data?.generalProductLines ?? []).map((item) => item.productLine)} values={(data?.generalProductLines ?? []).map((item) => Number(item.amount))} />
          </>
        ) : report.includes("产品线") ? (
          <MetricTable kind="product" title={displayTitle} labels={productLineRows.map((item) => item.productLine)} values={productLineRows.map((item) => Number(item.amount))} />
        ) : report.includes("东、南") ? (
          <MetricTable kind="area" title="综合客户" labels={regionLabels} values={regionValues} />
        ) : (
          <MetricTable title={displayTitle} labels={["特渠专业客户", "综合客户"]} values={[typeAmount("SPECIAL"), typeAmount("GENERAL")]} />
        )}
      </div>
    </section>
  );
}

type LotteryDisplayCandidate = {
  id: string;
  displayName: string;
  attendeeName: string;
  customerType: AttendanceCustomerType | "";
};

function attendanceCompanyKey(value: string) {
  return normalizeSearchText(value).replace(/[()（）\[\]【】{}：:，,。·\-_/\\]/g, "");
}

function getAttendanceCandidates(rows: AttendanceRow[], customerType: LotteryRound["customerType"]): LotteryDisplayCandidate[] {
  const seenCompanies = new Set<string>();
  return [...rows]
    .filter((row) => row.activityCustomerId !== null && row.matchStatus === "MATCHED" && row.lotteryEligible === true
      && row.dealerCompany.trim()
      && (customerType === "全部客户" || row.customerType === customerType))
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
    .filter((row) => {
      const key = attendanceCompanyKey(row.dealerCompany);
      if (!key || seenCompanies.has(key)) return false;
      seenCompanies.add(key);
      return true;
    })
    .map((row) => ({ id: row.id, displayName: row.dealerCompany.trim(), attendeeName: row.dealerName.trim(), customerType: row.customerType }));
}

function LotteryBoard({ rounds, attendanceRows, activityId, onComplete }: { rounds: LotteryRound[]; attendanceRows: AttendanceRow[]; activityId: number; onComplete: (id: number) => void }) {
  const [status, setStatus] = useState<"ready" | "rolling" | "done" | "finished">("ready");
  const [ticker, setTicker] = useState(0);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [drawnCandidateNames, setDrawnCandidateNames] = useState<string[]>([]);
  const [persistedWinners, setPersistedWinners] = useState<string[]>([]);
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const availableRounds = rounds.filter((item) => item.status !== "draft");
  const [roundId, setRoundId] = useState(availableRounds.find((item) => item.serverStatus !== "COMPLETED")?.id ?? availableRounds[0]?.id ?? 0);
  const currentRound = availableRounds.find((item) => item.id === roundId) ?? availableRounds[0];
  useEffect(() => {
    if (!availableRounds.length || availableRounds.some((item) => item.id === roundId)) return;
    setRoundId(availableRounds.find((item) => item.serverStatus !== "COMPLETED")?.id ?? availableRounds[0].id);
  }, [availableRounds, roundId]);
  useEffect(() => {
    if (status !== "rolling") return;
    const timer = window.setInterval(() => setTicker((n) => n + 1), 90);
    return () => window.clearInterval(timer);
  }, [status]);
  const attendanceCandidates = currentRound?.scope === "attended" ? getAttendanceCandidates(attendanceRows, currentRound.customerType) : [];
  const candidateNames = currentRound?.scope === "attended" ? attendanceCandidates.map((candidate) => candidate.displayName) : dealerNames;
  const availableCandidateNames = currentRound?.excludeWinners ? candidateNames.filter((name) => !drawnCandidateNames.includes(name)) : candidateNames;
  const rollingCount = persistedWinners.length || currentRound?.winnerCount || 0;
  const rollingNames = availableCandidateNames.length > 0
    ? Array.from({ length: Math.min(rollingCount, availableCandidateNames.length) }, (_, i) => availableCandidateNames[(ticker + i * 3) % availableCandidateNames.length])
    : Array.from({ length: rollingCount }, (_, index) => `幸运客户 ${index + 1}`);
  const winners = status === "done" ? persistedWinners : rollingNames;
  useEffect(() => {
    void loadPublicLottery().then((data) => {
      if (!currentRound) return;
      const names = data.winners.filter((winner) => winner.roundId === currentRound.id).sort((a, b) => a.position - b.position).map((winner) => winner.dealerDisplayName);
      if (names.length > 0) { setPersistedWinners(names); setStatus(currentRound.serverStatus === "COMPLETED" ? "finished" : "done"); }
    }).catch(() => undefined);
  }, [currentRound]);
  if (!currentRound) return <section className="screen-board lottery-board"><div className="lottery-ready"><h2>暂无已发布抽奖轮次</h2></div></section>;
  const handleAction = async () => {
    if (sessionFinished) return;
    setActionError("");
    if (status === "ready") {
      setSubmitting(true);
      try {
        const result = await drawLotteryRound(activityId, currentRound.id);
        setPersistedWinners(result.winners.map((winner) => winner.dealerDisplayName));
        setStatus("rolling");
      } catch (error) { setActionError(error instanceof ApiError ? error.message : "抽奖执行失败"); }
      finally { setSubmitting(false); }
    }
    else if (status === "rolling") {
      setStatus("done");
    } else if (status === "done") {
      setSubmitting(true);
      try {
        await completeLotteryRound(activityId, currentRound.id);
        setDrawnCandidateNames((current) => [...new Set([...current, ...persistedWinners])]);
        onComplete(currentRound.id);
        const currentIndex = availableRounds.findIndex((item) => item.id === currentRound.id);
        const next = availableRounds.slice(currentIndex + 1).find((item) => item.status !== "completed");
        if (next) { setRoundId(next.id); setPersistedWinners([]); setStatus("ready"); }
        else { setStatus("finished"); setSessionFinished(true); }
      } catch (error) { setActionError(error instanceof ApiError ? error.message : "完成本轮抽奖失败"); }
      finally { setSubmitting(false); }
    }
  };
  return (
    <section className="screen-board lottery-board">
      <FestivalDecor />
      <div className="lottery-controls"><label>当前轮次 <b>{currentRound.name}</b><small> · 按配置顺序执行</small></label></div>
      <div className="lottery-title"><b>{currentRound.name} 幸运抽奖</b><span>实物奖品：{currentRound.prize}</span></div>
      {status === "ready" ? (
        <div className="lottery-ready"><div className="lucky-seal">福</div><h2>好运即将揭晓</h2><p>候选资格将在开始抽奖时由服务端复核并固定</p></div>
      ) : (
        <div className={`winner-grid ${status}`}>
          {winners.map((name, index) => <div key={`${name}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><b>{name}</b></div>)}
        </div>
      )}
      {actionError && <p className="field-error">{actionError}</p>}
      <button className={`lottery-action ${status}`} onClick={handleAction} disabled={submitting || sessionFinished || (currentRound.status === "completed" && status === "ready")}>
        {submitting ? "正在保存抽奖结果…" : sessionFinished || status === "finished" ? "本场抽奖已完成" : currentRound.status === "completed" && status === "ready" ? "本轮已完成" : status === "ready" ? "开始抽奖" : status === "rolling" ? "停止并揭晓" : "完成本轮抽奖"}
      </button>
    </section>
  );
}



function DeleteConfirmDialog({ target, onCancel, onConfirm }: { target: DeleteTarget; onCancel: () => void; onConfirm: () => void }) {
  const labelPreview = target.labels.slice(0, 3).join("、");
  const extraCount = target.labels.length - 3;
  const countLabel = target.label ?? (target.ids.length === 1 ? target.kind : `${target.ids.length} 条${target.kind}`);
  return (
    <div className="delete-confirm" role="dialog" aria-modal="true" aria-label={`删除${target.kind}确认`} onClick={onCancel}>
      <div onClick={(event) => event.stopPropagation()}>
        <span className="delete-confirm-eyebrow">删除{target.kind}</span>
        <h3>确认删除{countLabel}？</h3>
        <p>{target.description ?? "删除后将从当前活动的可下单或身份验证列表中移除，已有订单不会被删除，订单明细和金额保持不变。"}</p>
        <div className="delete-confirm-items">
          <b>{labelPreview || countLabel}{extraCount > 0 ? ` 等 ${extraCount} 条` : ""}</b>
          <small>{target.summary ?? `已选择 ${target.ids.length} 条`}</small>
        </div>
        <div className="delete-confirm-actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="delete-confirm-danger" onClick={onConfirm}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

function ProductImageEditor({ materialName, images, imageStatus, onChange }: { materialName: string; images?: ProductImageAsset[]; imageStatus?: ProductImageStatus; onChange: (images: ProductImageAsset[] | undefined, status: ProductImageStatus) => void }) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const currentImages = images ?? [];
  const handleFiles = async (files: File[], replace: boolean) => {
    if (files.length === 0) return;
    setError("");
    setUploading(true);
    try {
      const uploadedImages = await createManualProductImageAssets(files);
      const nextImages = replace ? uploadedImages : [...currentImages, ...uploadedImages];
      onChange(nextImages, "已匹配");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "图片上传失败，请重新选择。" );
    } finally {
      setUploading(false);
    }
  };
  const removeImage = (id: string) => {
    const nextImages = currentImages.filter((image) => image.id !== id);
    onChange(nextImages.length > 0 ? nextImages : undefined, productImageStatusForAssets(nextImages, imageStatus));
    setPreviewIndex((current) => current === null ? null : Math.min(current, Math.max(0, nextImages.length - 1)));
  };
  const confirmCandidate = (id: string) => {
    const updated = currentImages.map((image) => image.id === id ? { ...image, matchStatus: "已匹配" as const } : image);
    const nextImages = [...updated.filter((image) => image.matchStatus !== "待确认"), ...updated.filter((image) => image.matchStatus === "待确认")];
    onChange(nextImages, productImageStatusForAssets(nextImages));
  };
  const setPrimary = (index: number) => {
    if (index <= 0 || index >= currentImages.length) return;
    onChange([currentImages[index], ...currentImages.slice(0, index), ...currentImages.slice(index + 1)], imageStatus ?? "已匹配");
  };
  return (
    <div className="product-image-editor">
      {currentImages.length > 0 ? <div className="product-image-gallery">
        {currentImages.map((image, index) => { const pending = image.matchStatus === "待确认"; return <div className={`product-image-tile ${!pending && index === 0 ? "primary" : ""} ${pending ? "pending" : ""}`} key={`${image.id}-${index}`}>
          <button type="button" className="product-image-tile-preview" disabled={uploading} onClick={() => setPreviewIndex(index)}>
            <img src={image.url} alt={`${materialName} ${index + 1}`} />
            <span>{pending ? "候选图片" : index === 0 ? "主图" : `第 ${index + 1} 张`}</span>
          </button>
          <div className="product-image-tile-actions">
            {pending ? <button type="button" disabled={uploading} onClick={() => confirmCandidate(image.id)}>确认绑定</button> : index > 0 && <button type="button" disabled={uploading} onClick={() => setPrimary(index)}>设为主图</button>}
            <button type="button" className="danger" disabled={uploading} onClick={() => removeImage(image.id)}>{pending ? "排除候选" : "删除"}</button>
          </div>
        </div>; })}
      </div> : <div className="product-image-editor-empty"><i>暂无图片</i><span>可以上传一张或多张商品图片</span></div>}
      <div className="product-image-editor-actions">
        <label className="product-image-upload-button"><input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" multiple disabled={uploading} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void handleFiles(files, false); }} />{uploading ? "读取中…" : "添加图片"}</label>
        {currentImages.length > 0 && <label className="product-image-upload-button secondary"><input type="file" accept=".jpg,.jpeg,.png,.webp,.gif,.bmp" multiple disabled={uploading} onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; void handleFiles(files, true); }} />替换全部</label>}
      </div>
      <small className="product-image-editor-hint">{currentImages.length > 0 ? `已匹配 ${currentImages.filter((image) => image.matchStatus !== "待确认").length} 张 · 待确认 ${currentImages.filter((image) => image.matchStatus === "待确认").length} 张` : "未匹配"} · 单张图片不超过 10MB</small>
      {error && <small className="product-image-editor-error">{error}</small>}
      {previewIndex !== null && currentImages.length > 0 && <ProductImageViewer productName={materialName} images={currentImages} initialIndex={previewIndex} status={`${currentImages.length} 张`} onClose={() => setPreviewIndex(null)} />}
    </div>
  );
}

function ProductImportTable({ rows, onEdit, onDelete, allowDelete = false, allowDeleteAll = false, readOnly = false }: { rows: ProductImportRow[]; onEdit: (row: ProductImportRow) => void; onDelete?: (ids: string[]) => void; allowDelete?: boolean; allowDeleteAll?: boolean; readOnly?: boolean }) {
  const [customerType, setCustomerType] = useState("全部");
  const [rebate, setRebate] = useState("全部");
  const [imageFilter, setImageFilter] = useState("全部");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [priceFilter, setPriceFilter] = useState("全部");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [imagePreview, setImagePreview] = useState<{ productName: string; images: ProductImageAsset[]; status: string } | null>(null);
  const heads = ["序号", "客户类型", "是否返利", "产品大类", "产品线", "物料代码", "物料名称", "商品图片", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "每吨箱数（箱/吨）", "是否礼盒", "分公司限制", "状态", "操作"];
  const filteredRows = useMemo(() => {
    const normalizedKeyword = normalizeSearchText(searchKeyword);
    const normalizedCodeKeyword = normalizeMaterialCode(searchKeyword);
    return rows.filter((row) => {
      const matchesImage = imageFilter === "全部"
        || (imageFilter === "已匹配" && row.imageStatus === "已匹配")
        || (imageFilter === "未匹配" && row.imageStatus === "未匹配")
        || (imageFilter === "待确认" && row.imageStatus === "待确认");
      const casePrice = Number(String(row.casePrice ?? "").replace(/[,，￥¥\s]/g, ""));
      const hasValidPrice = Number.isFinite(casePrice) && casePrice > 0;
      const matchesPrice = priceFilter === "全部"
        || (priceFilter === "价格有效" && hasValidPrice)
        || (priceFilter === "价格待完善" && !hasValidPrice);
      const matchesFilters = (customerType === "全部" || row.customerType === customerType)
        && (rebate === "全部" || row.rebate === rebate)
        && (statusFilter === "全部" || row.status === statusFilter) && matchesImage && matchesPrice;
      const matchesSearch = !normalizedKeyword
        || normalizeSearchText(row.materialName).includes(normalizedKeyword)
        || normalizeMaterialCode(row.materialCode).includes(normalizedCodeKeyword);
      return matchesFilters && matchesSearch;
    });
  }, [rows, customerType, rebate, imageFilter, statusFilter, priceFilter, searchKeyword]);
  const imageCounts = useMemo(() => ({
    matched: rows.filter((row) => row.imageStatus === "已匹配").length,
    unmatched: rows.filter((row) => row.imageStatus === "未匹配").length,
    pending: rows.filter((row) => row.imageStatus === "待确认").length,
  }), [rows]);
  const sortedRows = useMemo(() => [...filteredRows].sort(compareProductRows), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const filteredIds = useMemo(() => sortedRows.map((row) => row.id), [sortedRows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const openDelete = (ids: string[]) => {
    const targetRows = rows.filter((row) => ids.includes(row.id));
    setDeleteTarget({ ids, labels: targetRows.map((row) => row.materialName || row.materialCode), kind: "商品" });
  };
  const openClearAll = () => {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;
    setDeleteTarget({
      ids,
      labels: rows.map((row) => row.materialName || row.materialCode),
      kind: "商品",
      label: "全部当前商品",
      description: "将从当前有效商品列表移除全部商品；已有订单不会被删除，订单明细和金额保持不变。",
      summary: `当前共有 ${ids.length} 条商品`,
    });
  };
  const togglePageRows = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return [...next];
    });
  };
  const selectFilteredRows = () => {
    setSelectedIds((current) => [...new Set([...current, ...filteredIds])]);
  };
  const clearFilteredRows = () => {
    setSelectedIds((current) => current.filter((id) => !filteredIds.includes(id)));
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    onDelete?.(deleteTarget.ids);
    setSelectedIds((current) => current.filter((id) => !deleteTarget.ids.includes(id)));
    setDeleteTarget(null);
  };
  return (
    <>
      <div className="data-filters product-data-filters">
        <label><span>客户类型</span><select value={customerType} onChange={(e) => { setCustomerType(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>特渠</option><option>综合</option></select></label>
        <label><span>是否参与返利</span><select value={rebate} onChange={(e) => { setRebate(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>参与</option><option>不参与</option></select></label>
        <label><span>商品状态</span><select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>有效</option><option>待核对</option><option>待完善</option></select></label>
        <label><span>价格状态</span><select value={priceFilter} onChange={(e) => { setPriceFilter(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>价格有效</option><option>价格待完善</option></select></label>
        <label><span>商品图片</span><select value={imageFilter} onChange={(e) => { setImageFilter(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>已匹配</option><option>待确认</option><option>未匹配</option></select></label>
        <label className="data-filter-search"><span>搜索商品</span><input type="search" value={searchKeyword} onChange={(e) => { setSearchKeyword(e.target.value); setPage(1); setSelectedIds([]); }} placeholder="物料代码 / 物料名称" aria-label="搜索物料代码或物料名称" /></label>
        <small>已匹配 {imageCounts.matched} · 待确认 {imageCounts.pending} · 未匹配 {imageCounts.unmatched}<br />当前显示 {sortedRows.length} 条商品 · 第 {currentPage}/{totalPages} 页{readOnly ? "，活动已截止只读" : allowDelete ? "，可勾选删除" : "，可编辑"}</small>
      </div>
      {allowDelete && allowDeleteAll && rows.length > 0 && <div className="selection-toolbar selection-toolbar-all"><span>当前商品 <b>{rows.length}</b> 条</span><button type="button" className="selection-delete" onClick={openClearAll}>清空当前商品</button></div>}
      {allowDelete && selectedIds.length > 0 && <div className="selection-toolbar"><span>已选择 <b>{selectedIds.length}</b> 条商品{allFilteredSelected ? "（当前筛选结果）" : ""}</span><div>{!allFilteredSelected && filteredIds.length > pageIds.length && <button type="button" className="selection-select-all" onClick={selectFilteredRows}>选择全部 {filteredIds.length} 条</button>}{allFilteredSelected && <button type="button" className="selection-select-all" onClick={clearFilteredRows}>取消全选结果</button>}<button type="button" className="selection-clear" onClick={() => setSelectedIds([])}>取消选择</button><button type="button" className="selection-delete" onClick={() => openDelete(selectedIds)}>删除所选</button></div></div>}
      <div className="table-scroll">
        <div className={`data-table product-import-table ${allowDelete ? "with-selection" : ""}`}>
          <div className="table-row table-head">{allowDelete && <b className="select-cell"><input type="checkbox" aria-label="全选当前页商品" checked={allPageSelected} onChange={togglePageRows} /></b>}{heads.map((x) => <b key={x}>{x}</b>)}</div>
          {pageRows.map((row, index) => {
            const values = [pageStart + index + 1, row.customerType, row.rebate, row.category, row.line, row.materialCode, row.materialName, null, row.brand, row.variety, row.spec, row.casePack, row.unitPrice, row.casePrice, row.conversion, row.gift, row.branchScope || "全部分公司", row.status];
            const imageStatus = row.imageStatus ?? "未匹配";
            const imageLabel = imageStatus === "待确认" || imageStatus === "未匹配"
              ? imageStatus
              : row.images?.length ? `${row.images.length} 张` : "未匹配";
            return <div className={`table-row ${row.manuallyEdited ? "manually-edited-row" : ""}`} key={row.id}>{allowDelete && <span className="select-cell"><input type="checkbox" aria-label={`选择商品 ${row.materialName}`} checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></span>}{values.map((value, index) => index === 7 ? <button type="button" key={index} className={`product-image-cell product-image-button-cell ${imageStatus === "待确认" ? "pending" : row.images?.length ? "matched" : "unmatched"}`} disabled={!row.images?.length} aria-label={`查看${row.materialName}商品图片`} onClick={() => row.images?.length && setImagePreview({ productName: row.materialName, images: row.images, status: imageLabel })}>{row.images?.[0]?.url ? <img src={row.images[0].url} alt={row.materialName} /> : <i>—</i>}<small>{imageLabel}</small></button> : <span key={index} className={index === 17 ? `status-cell ${row.status !== "有效" ? "pending" : ""}` : ""}>{value || "—"}</span>)}<span className="table-row-actions"><button type="button" disabled={readOnly} onClick={() => onEdit(row)}>编辑</button>{allowDelete && <button type="button" onClick={() => openDelete([row.id])}>删除</button>}{row.manuallyEdited && <small>已修正</small>}</span></div>;
          })}
          {sortedRows.length === 0 && <div className="table-empty">{searchKeyword.trim() ? "当前搜索和筛选条件下没有商品" : "当前筛选条件下没有商品"}</div>}
        </div>
      </div>
      <div className="table-pagination"><span>共 {sortedRows.length} 条</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select>条</label><button type="button" disabled={currentPage <= 1} onClick={() => setPage(1)}>首页</button><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><b>{currentPage} / {totalPages}</b><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>末页</button></div></div>
      {deleteTarget && <DeleteConfirmDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
      {imagePreview && <ProductImageViewer productName={imagePreview.productName} images={imagePreview.images} status={imagePreview.status} onClose={() => setImagePreview(null)} />}
    </>
  );
}

function ProductImageUploadCard({ fileName, stats, assets, error, disabled = false, disabledMessage = "请先上传商品 Excel", onFile, onRemove }: { fileName: string; stats: ProductImageStats; assets: ProductImageAsset[]; error: string; disabled?: boolean; disabledMessage?: string; onFile: (file: File) => void | Promise<void>; onRemove: () => void }) {
  const ready = Boolean(fileName && !error);
  const reviewAssets = assets.filter((asset) => asset.matchStatus === "待确认" || asset.matchStatus === "未匹配");
  return (
    <article className={`file-upload-card image-upload-card ${ready ? "ready" : ""}`}>
      <div className="file-card-heading"><span>图</span><div><b>商品图片 ZIP</b><small>按商品物料名称匹配图片</small></div><em>{error ? "解析失败" : fileName ? "解析完成" : "待上传"}</em></div>
      {fileName ? <p title={fileName}>{fileName}</p> : <p>请选择：产品图片6月30日-OK(1).zip</p>}
      <div className="image-import-stats"><span>商品<b>{stats.totalProducts}</b></span><span>已匹配<b>{stats.matchedProducts}</b></span><span>待确认<b>{stats.pendingProducts}</b></span><span>未匹配<b>{stats.unmatchedProducts}</b></span></div>
      {reviewAssets.length > 0 && <div className="image-match-review"><b>需要处理的图片</b><div>{reviewAssets.map((asset) => <div className="image-match-review-row" key={asset.id}><img src={asset.url} alt="" /><span title={asset.fileName}>{asset.fileName}</span><em className={asset.matchStatus === "待确认" ? "pending" : "unmatched"}>{asset.matchStatus}</em></div>)}</div></div>}
      {error && <small className="image-upload-error">{error}</small>}
      <footer><small>{disabled ? disabledMessage : ready ? `已预览 ${assets.length} 张图片，确认替换后才会保存` : "支持 JPG、PNG、WEBP、GIF、BMP"}</small><div>{fileName && <button type="button" disabled={disabled} onClick={onRemove}>移除</button>}<label className={disabled ? "disabled" : ""}><input type="file" accept=".zip,application/zip" disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.currentTarget.value = ""; }} />{fileName ? "替换 ZIP" : "选择 ZIP"}</label></div></footer>
    </article>
  );
}

function CustomerWhitelistTable({ rows, onEdit, onDelete, allowDelete = false, allowDeleteAll = false, readOnly = false }: { rows: WhitelistRow[]; onEdit: (row: WhitelistRow) => void; onDelete?: (ids: string[]) => void; allowDelete?: boolean; allowDeleteAll?: boolean; readOnly?: boolean }) {
  const [customerType, setCustomerType] = useState("全部");
  const [statusFilter, setStatusFilter] = useState("全部");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const heads = ["序号", "客户类型", "大区", "分公司名称", "经销商名称（简）", "经销商名称（全）", "经销商类型", "经销商姓名", "经销商电话", "分公司确认人姓名", "分公司确认人电话", "状态", "操作"];
  const filteredRows = useMemo(() => {
    const normalizedKeyword = normalizeSearchText(searchKeyword);
    const phoneKeyword = normalizePhone(searchKeyword);
    return rows.filter((row) => {
      const matchesType = customerType === "全部" || row.customerType === customerType;
      const matchesStatus = statusFilter === "全部" || row.status === statusFilter;
      const matchesSearch = !normalizedKeyword
        || [row.dealerShort, row.dealerFull, row.dealerName].some((value) => normalizeSearchText(value).includes(normalizedKeyword))
        || (phoneKeyword.length > 0 && normalizePhone(row.dealerPhone).includes(phoneKeyword));
      return matchesType && matchesStatus && matchesSearch;
    });
  }, [rows, customerType, statusFilter, searchKeyword]);
  const sortedRows = useMemo(() => [...filteredRows].sort(compareWhitelistRows), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const filteredIds = useMemo(() => sortedRows.map((row) => row.id), [sortedRows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const openDelete = (ids: string[]) => {
    const targetRows = rows.filter((row) => ids.includes(row.id));
    setDeleteTarget({ ids, labels: targetRows.map((row) => row.dealerShort || row.dealerFull), kind: "白名单客户" });
  };
  const openClearAll = () => {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;
    setDeleteTarget({
      ids,
      labels: rows.map((row) => row.dealerShort || row.dealerFull),
      kind: "白名单客户",
      label: "全部当前白名单",
      description: "将从当前有效白名单中移除全部客户；已有订单不会被删除。",
      summary: `当前共有 ${ids.length} 名白名单客户`,
    });
  };
  const togglePageRows = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return [...next];
    });
  };
  const selectFilteredRows = () => {
    setSelectedIds((current) => [...new Set([...current, ...filteredIds])]);
  };
  const clearFilteredRows = () => {
    setSelectedIds((current) => current.filter((id) => !filteredIds.includes(id)));
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    onDelete?.(deleteTarget.ids);
    setSelectedIds((current) => current.filter((id) => !deleteTarget.ids.includes(id)));
    setDeleteTarget(null);
  };
  return (
    <>
      <div className="data-filters">
        <label><span>客户类型</span><select value={customerType} onChange={(e) => { setCustomerType(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>综合客户</option><option>特渠专业客户</option></select></label>
        <label><span>状态</span><select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option><option>有效</option><option>待处理</option></select></label>
        <label className="data-filter-search"><span>搜索白名单</span><input type="search" value={searchKeyword} onChange={(e) => { setSearchKeyword(e.target.value); setPage(1); setSelectedIds([]); }} placeholder="经销商名称 / 姓名 / 电话" aria-label="搜索经销商名称、经销商姓名或电话" /></label>
        <small>当前显示 {sortedRows.length} 名客户 · 第 {currentPage}/{totalPages} 页{readOnly ? "，活动已截止只读" : allowDelete ? "，可勾选删除" : "，可编辑"}</small>
      </div>
      {allowDelete && allowDeleteAll && rows.length > 0 && <div className="selection-toolbar selection-toolbar-all"><span>当前白名单 <b>{rows.length}</b> 名</span><button type="button" className="selection-delete" onClick={openClearAll}>清空当前白名单</button></div>}
      {allowDelete && selectedIds.length > 0 && <div className="selection-toolbar"><span>已选择 <b>{selectedIds.length}</b> 名客户{allFilteredSelected ? "（当前筛选结果）" : ""}</span><div>{!allFilteredSelected && filteredIds.length > pageIds.length && <button type="button" className="selection-select-all" onClick={selectFilteredRows}>选择全部 {filteredIds.length} 名</button>}{allFilteredSelected && <button type="button" className="selection-select-all" onClick={clearFilteredRows}>取消全选结果</button>}<button type="button" className="selection-clear" onClick={() => setSelectedIds([])}>取消选择</button><button type="button" className="selection-delete" onClick={() => openDelete(selectedIds)}>删除所选</button></div></div>}
      <div className="table-scroll">
        <div className={`data-table whitelist-table ${allowDelete ? "with-selection" : ""}`}>
          <div className="table-row table-head">{allowDelete && <b className="select-cell"><input type="checkbox" aria-label="全选当前页白名单" checked={allPageSelected} onChange={togglePageRows} /></b>}{heads.map((x) => <b key={x}>{x}</b>)}</div>
          {pageRows.map((row, index) => {
            const values = [pageStart + index + 1, row.customerType, row.region, row.branch, row.dealerShort, row.dealerFull, row.dealerType, row.dealerName, row.dealerPhone, row.confirmerName, row.confirmerPhone, row.status];
            return <div className={`table-row ${row.manuallyEdited ? "manually-edited-row" : ""}`} key={row.id}>{allowDelete && <span className="select-cell"><input type="checkbox" aria-label={`选择白名单客户 ${row.dealerShort}`} checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></span>}{values.map((value, index) => <span key={index} className={index === 11 ? `status-cell ${row.status === "待处理" ? "pending" : ""}` : ""}>{value || "—"}</span>)}<span className="table-row-actions"><button type="button" disabled={readOnly} onClick={() => onEdit(row)}>编辑</button>{allowDelete && <button type="button" onClick={() => openDelete([row.id])}>删除</button>}{row.manuallyEdited && <small>已修正</small>}</span></div>;
          })}
          {sortedRows.length === 0 && <div className="table-empty">{searchKeyword.trim() ? "当前搜索和筛选条件下没有白名单客户" : "当前筛选条件下没有白名单客户"}</div>}
        </div>
      </div>
      <div className="table-pagination"><span>共 {sortedRows.length} 名</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select>名</label><button type="button" disabled={currentPage <= 1} onClick={() => setPage(1)}>首页</button><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><b>{currentPage} / {totalPages}</b><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>末页</button></div></div>
      {deleteTarget && <DeleteConfirmDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
    </>
  );
}

function ProductFormDrawer({ rows, initialRow, activityStarted = false, onClose, onSave }: { rows: ProductImportRow[]; initialRow?: ProductImportRow; activityStarted?: boolean; onClose: () => void; onSave: (row: ProductImportRow, reason?: string) => Promise<boolean> }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<ProductImportRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("product"), sequence: 0, customerType: "特渠", rebate: "参与", category: "", line: "", materialCode: "", materialName: "", brand: "", variety: "", spec: "", casePack: "", unitPrice: "", casePrice: "", conversion: "", gift: "否", branchScope: "", status: "有效", source: "manual" });
  const [editReason, setEditReason] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (field: keyof ProductImportRow, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.filter((row) => row.customerType === form.customerType && row.rebate === form.rebate).map((row) => row.sequence)) + 1;
  const duplicateMaterialCode = form.materialCode.trim() !== "" && rows.some((row) => row.id !== form.id && row.customerType === form.customerType && row.rebate === form.rebate && row.materialCode.trim().toLowerCase() === form.materialCode.trim().toLowerCase());
  const conversionValue = Number(form.conversion);
  const conversionValid = form.conversion.trim() !== "" && Number.isFinite(conversionValue) && conversionValue > 0;
  const canSave = form.materialCode.trim() !== "" && form.materialName.trim() !== "" && form.casePrice.trim() !== "" && (conversionValid || form.status === "待完善") && !duplicateMaterialCode && (!activityStarted || editReason.trim() !== "");
  return (
    <div className="order-drawer-backdrop" onClick={onClose}>
      <aside className="order-drawer form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>活动商品</span><h2>{isEditing ? "编辑商品" : "手动添加商品"}</h2></div><button aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前商品" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>{form.customerType} · {form.rebate}返利分组</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>客户类型</span><select value={form.customerType} onChange={(e) => update("customerType", e.target.value)}><option>特渠</option><option>综合</option></select></label>
          <label><span>是否参与返利</span><select value={form.rebate} onChange={(e) => update("rebate", e.target.value)}><option>参与</option><option>不参与</option></select></label>
          <label><span>产品大类</span><input value={form.category} onChange={(e) => update("category", e.target.value)} placeholder="例如：特渠定制产品" /></label>
          <label><span>产品线</span><input value={form.line} onChange={(e) => update("line", e.target.value)} placeholder="例如：调味油" /></label>
          <label><span>物料代码 *</span><input value={form.materialCode} onChange={(e) => update("materialCode", e.target.value)} /><small className={duplicateMaterialCode ? "field-error" : ""}>{duplicateMaterialCode ? "同客户类型、同返利分组内已存在，请检查解析结果" : "跨 Sheet 可重复；用于识别同一商品"}</small></label>
          <label className="wide-field"><span>物料名称 *</span><input value={form.materialName} onChange={(e) => update("materialName", e.target.value)} /></label>
          <div className="product-form-image-field wide-field"><span>商品图片</span><ProductImageEditor materialName={form.materialName} images={form.images} imageStatus={form.imageStatus} onChange={(images, status) => setForm((current) => ({ ...current, images, imageStatus: status }))} /></div>
          <label><span>品牌</span><input value={form.brand} onChange={(e) => update("brand", e.target.value)} /></label>
          <label><span>品种</span><input value={form.variety} onChange={(e) => update("variety", e.target.value)} /></label>
          <label><span>规格</span><input value={form.spec} onChange={(e) => update("spec", e.target.value)} /></label>
          <label><span>箱规</span><input value={form.casePack} onChange={(e) => update("casePack", e.target.value)} /></label>
          <label><span>元/瓶</span><input inputMode="decimal" value={form.unitPrice} onChange={(e) => update("unitPrice", e.target.value)} /></label>
          <label><span>元/箱 *</span><input inputMode="decimal" value={form.casePrice} onChange={(e) => update("casePrice", e.target.value)} /></label>
          <label><span>每吨箱数（箱/吨） *</span><input inputMode="decimal" value={form.conversion} onChange={(e) => update("conversion", e.target.value)} /><small className={!conversionValid && form.status !== "待完善" ? "field-error" : ""}>Excel 原列名：吨箱转换系数；统计时按订货箱数 ÷ 每吨箱数计算吨数</small></label>
          <label><span>是否礼盒</span><select value={form.gift} onChange={(e) => update("gift", e.target.value)}><option>否</option><option>是</option></select></label>
          <label><span>分公司限制</span><input value={form.branchScope} onChange={(e) => update("branchScope", e.target.value)} placeholder="留空表示全部分公司" /><small>多个分公司用顿号或逗号分隔</small></label>
          <label><span>数据状态</span><select value={form.status} onChange={(e) => update("status", e.target.value)}><option>有效</option><option>待完善</option></select></label>
          {activityStarted && <label className="wide-field"><span>紧急修改原因 *</span><input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="请填写本次改单原因，保存后写入操作日志" /></label>}
        </div>
        <p className="drawer-form-note">带 * 的字段为必填项；{activityStarted ? "活动已开始，本次手动调整会记录操作日志。" : "手动新增或修改仅对当前数据版本生效，重新导入 Excel 后以新文件为准。"}</p></div>
        <footer><button disabled={saving} onClick={onClose}>取消</button><button className="admin-primary" disabled={!canSave || saving} onClick={async () => {
          setSaving(true);
          const saved = await onSave({ ...form, sequence: nextSequence, manuallyEdited: true }, editReason.trim());
          setSaving(false);
          if (saved) onClose();
        }}>{saving ? "保存中…" : isEditing ? "保存修改" : "添加商品"}</button></footer>
      </aside>
    </div>
  );
}

function WhitelistFormDrawer({ rows, initialRow, activityStarted = false, onClose, onSave }: { rows: WhitelistRow[]; initialRow?: WhitelistRow; activityStarted?: boolean; onClose: () => void; onSave: (row: WhitelistRow, reason?: string) => void }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<WhitelistRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("whitelist"), sequence: 0, customerType: "综合客户", region: "", branch: "", dealerShort: "", dealerFull: "", dealerType: "综合经销商", dealerName: "", dealerPhone: "", confirmerName: "", confirmerPhone: "", status: "有效", source: "manual" });
  const [editReason, setEditReason] = useState("");
  const update = (field: keyof WhitelistRow, value: string | number) => setForm((current) => ({ ...current, [field]: value }));
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.filter((row) => row.customerType === form.customerType).map((row) => row.sequence)) + 1;
  const phoneValid = (isEditing && form.dealerPhone.includes("*")) || whitelistPhoneIsValid(form.dealerPhone);
  const duplicateDealerName = normalizeWhitelistName(form.dealerFull) !== "" && rows.some((row) => row.id !== form.id && row.customerType === form.customerType && whitelistIdentityKey(row) === whitelistIdentityKey(form));
  const duplicateDealerPhone = whitelistPhoneIsValid(form.dealerPhone) && rows.some((row) => row.id !== form.id && row.customerType === form.customerType && normalizePhone(row.dealerPhone) === normalizePhone(form.dealerPhone));
  const canSave = form.region.trim() !== "" && form.branch.trim() !== "" && form.dealerShort.trim() !== "" && form.dealerFull.trim() !== "" && phoneValid && !duplicateDealerName && !duplicateDealerPhone && (!activityStarted || editReason.trim() !== "");
  return (
    <div className="order-drawer-backdrop" onClick={onClose}>
      <aside className="order-drawer form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>客户身份</span><h2>{isEditing ? "编辑白名单" : "手动添加白名单客户"}</h2></div><button aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前客户" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>{form.customerType}分组</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>客户类型</span><select value={form.customerType} onChange={(e) => { const type = e.target.value as WhitelistRow["customerType"]; setForm((current) => ({ ...current, customerType: type, dealerType: type === "综合客户" ? "综合经销商" : "特渠专业经销商" })); }}><option>综合客户</option><option>特渠专业客户</option></select></label>
          <label><span>大区 *</span><select value={form.region} onChange={(e) => update("region", e.target.value)}><option value="">请选择</option><option>东区</option><option>南区</option><option>北区</option><option>西区</option></select></label>
          <label><span>分公司名称 *</span><input value={form.branch} onChange={(e) => update("branch", e.target.value)} placeholder="例如：长沙分" /></label>
          <label><span>经销商名称（简）*</span><input value={form.dealerShort} onChange={(e) => update("dealerShort", e.target.value)} /><small>{form.dealerShort.length}/10 字</small></label>
          <label className="wide-field"><span>经销商名称（全）*</span><input value={form.dealerFull} onChange={(e) => update("dealerFull", e.target.value)} /><small className={duplicateDealerName ? "field-error" : ""}>{duplicateDealerName ? "同客户类型下已存在，请直接编辑原客户" : "客户身份匹配使用客户类型 + 名称全称；电话变化时会更新原客户"}</small></label>
          <label><span>经销商类型</span><input value={form.dealerType} onChange={(e) => update("dealerType", e.target.value)} /></label>
          <label><span>经销商姓名</span><input value={form.dealerName} onChange={(e) => update("dealerName", e.target.value)} /></label>
          <label><span>经销商电话 *</span><input inputMode="tel" maxLength={11} value={form.dealerPhone} onChange={(e) => update("dealerPhone", e.target.value.replace(/\D/g, ""))} placeholder="11 位手机号" /><small className={duplicateDealerPhone || (form.dealerPhone !== "" && !phoneValid) ? "field-error" : ""}>{duplicateDealerPhone ? "同客户类型内手机号已存在；综合和特渠可以同号" : form.dealerPhone && !phoneValid ? "请输入正确的 11 位手机号" : "用于 H5 身份验证；请输入完整的 11 位手机号"}</small></label>
          <label><span>分公司确认人姓名</span><input value={form.confirmerName} onChange={(e) => update("confirmerName", e.target.value)} /></label>
          <label><span>分公司确认人电话</span><input inputMode="tel" maxLength={11} value={form.confirmerPhone} onChange={(e) => update("confirmerPhone", e.target.value.replace(/\D/g, ""))} /></label>
          {activityStarted && <label className="wide-field"><span>紧急修改原因 *</span><input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="请填写本次改单原因，保存后写入操作日志" /></label>}
        </div>
        <p className="drawer-form-note">客户类型在 Excel 导入时由 Sheet 自动确定；{activityStarted ? "活动已开始，本次手动调整会记录操作日志。" : "手动新增或修改仅对当前数据版本生效，重新导入 Excel 后以新文件为准。"}</p></div>
        <footer><button onClick={onClose}>取消</button><button className="admin-primary" disabled={!canSave} onClick={() => { onSave({ ...form, sequence: nextSequence, status: "有效", source: isEditing ? form.source ?? "excel" : "manual", identityKey: whitelistIdentityKey(form), manuallyEdited: true }, editReason.trim()); onClose(); }}>{isEditing ? "保存修改" : "添加客户"}</button></footer>
      </aside>
    </div>
  );
}

function LotterySettings({ rounds, attendanceRows, activityId, customerCount, onChange }: { rounds: LotteryRound[]; attendanceRows: AttendanceRow[]; activityId: number; customerCount: number; onChange: (rounds: LotteryRound[]) => void }) {
  const [selectedId, setSelectedId] = useState(rounds.find((item) => item.status === "published")?.id ?? rounds[0]?.id ?? -1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [preview, setPreview] = useState<LotteryCandidatePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [statistics, setStatistics] = useState<LotteryWinnerStatistics>({ validWinnerRecords: 0, validWinnerCustomers: 0, invalidatedWinnerRecords: 0 });
  const selected = rounds.find((item) => item.id === selectedId) ?? rounds[0];
  const selectedIndex = Math.max(0, rounds.findIndex((item) => item.id === selected.id));
  const selectedLocked = Boolean(selected.serverStatus && !["DRAFT", "READY"].includes(selected.serverStatus));
  const statusLabel = { draft: "草稿", published: "已发布", completed: "已完成" } as const;
  const scopeOptions: { key: CandidateScope; title: string; detail: string }[] = [
    { key: "all", title: "所有活动客户", detail: "当前活动有效白名单" },
    { key: "attended", title: "现场到场客户", detail: "按签到或导入结果筛选" },
    { key: "ordered", title: "有效下单客户", detail: "当前已提交订单" },
  ];
  const updateSelected = (patch: Partial<LotteryRound>) => onChange(rounds.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  useEffect(() => {
    if (!Number.isFinite(activityId) || activityId <= 0 || !selected) return;
    const timer = window.setTimeout(() => {
      setPreviewLoading(true); setSaveError("");
      void previewLotteryCandidates(activityId, {
        roundNo: selectedIndex + 1, winnerCount: selected.winnerCount,
        candidateScope: selected.scope === "attended" ? "ATTENDEES" : selected.scope === "ordered" ? "VALID_ORDERS" : "ALL_CUSTOMERS",
        customerType: selected.customerType === "综合客户" ? "GENERAL" : selected.customerType === "特渠专业客户" ? "SPECIAL" : "ALL",
        minimumOrderAmount: selected.scope === "ordered" ? selected.minAmount : 0,
        excludePreviousWinners: selectedIndex > 0 && selected.excludeWinners,
      }).then(setPreview).catch((error) => setSaveError(error instanceof ApiError ? error.message : "候选名单试算失败"))
        .finally(() => setPreviewLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activityId, selected.id, selected.scope, selected.customerType, selected.minAmount, selected.winnerCount, selected.excludeWinners, selectedIndex]);
  useEffect(() => {
    if (!Number.isFinite(activityId) || activityId <= 0) return;
    void loadLotteryStatistics(activityId).then(setStatistics).catch(() => undefined);
  }, [activityId, rounds]);
  const addRound = () => {
    const id = Math.min(-1, ...rounds.map((item) => item.id - 1));
    const next: LotteryRound = { id, name: `第${rounds.length + 1}轮`, prize: "待配置奖品", winnerCount: 10, customerType: "全部客户", scope: "all", minAmount: 0, excludeWinners: true, status: "draft", candidateCount: 0 };
    onChange([...rounds, next]);
    setSelectedId(id);
  };
  const duplicateRound = () => {
    const id = Math.min(-1, ...rounds.map((item) => item.id - 1));
    onChange([...rounds, { ...selected, id, ruleId: undefined, serverStatus: undefined, name: `${selected.name}副本`, status: "draft" }]);
    setSelectedId(id);
  };
  const saveAndPublish = async () => {
    setSaving(true); setSaveError("");
    try {
      const body = { name: "订货会幸运抽奖规则", rounds: rounds.map((round, index) => ({ name: round.name, prizeName: round.prize,
        winnerCount: round.winnerCount, candidateScope: round.scope === "attended" ? "ATTENDEES" : round.scope === "ordered" ? "VALID_ORDERS" : "ALL_CUSTOMERS",
        customerType: round.customerType === "综合客户" ? "GENERAL" : round.customerType === "特渠专业客户" ? "SPECIAL" : "ALL",
        minimumOrderAmount: round.scope === "ordered" ? round.minAmount : 0,
        excludePreviousWinners: index === 0 ? false : round.excludeWinners, displayNameType: "FULL_NAME" })) };
      const existingRuleId = rounds.find((round) => round.ruleId && ["DRAFT", "READY", "DRAWN", "COMPLETED", "RESET"].includes(round.serverStatus || ""))?.ruleId;
      const saved = existingRuleId ? await updateLotteryRule(activityId, existingRuleId, body) : await createLotteryRule(activityId, body);
      const published = saved.status === "DRAFT" ? await publishLotteryRule(activityId, saved.id) : saved;
      const mapped = mapLotteryRule(published);
      onChange(mapped); setSelectedId(mapped[0]?.id ?? -1);
    } catch (error) { setSaveError(error instanceof ApiError ? error.message : "抽奖规则保存失败"); }
    finally { setSaving(false); }
  };
  const removeRound = () => {
    if (selectedLocked || rounds.length === 1) return;
    const rest = rounds.filter((item) => item.id !== selected.id);
    onChange(rest);
    setSelectedId(rest[0].id);
  };
  const ruleSummary = `${selected.customerType} · ${selected.scope === "all" ? "活动白名单" : selected.scope === "attended" ? "现场已到场" : "有效下单"}${selected.scope === "ordered" && selected.minAmount > 0 ? ` · 订单满 ¥${selected.minAmount.toLocaleString()}` : ""} · ${selectedIndex === 0 ? "第一轮不涉及历史中奖" : selected.excludeWinners ? "排除已中奖" : "允许重复中奖"}`;
  const resolvedCandidateCount = preview?.candidateCount ?? 0;
  const candidateSteps: [string, number][] = [["当前有效白名单", customerCount], [selected.scope === "attended" ? "已匹配到场客户" : selected.scope === "ordered" ? "有效订单客户" : "客户类型匹配", resolvedCandidateCount], ...(selectedIndex > 0 && selected.excludeWinners ? [["排除已中奖", resolvedCandidateCount] as [string, number]] : [])];
  return (
    <div className="admin-panel lottery-settings">
      <div className="panel-title"><div><h2>抽奖规则工作台</h2><p>候选按白名单客户 ID 去重并严格按轮次执行；已开始轮次自动锁定</p></div><div className="panel-actions"><span className="attendance-not-linked">现场名单已同步 {attendanceRows.length} 名</span><button className="admin-primary" disabled={saving || rounds.length === 0} onClick={saveAndPublish}>{saving ? "正在保存…" : rounds.some((round) => round.serverStatus === "READY") ? "保存规则修改" : "保存并发布"}</button></div></div>
      {saveError && <div className="warning-box"><b>抽奖规则未发布</b><span>{saveError}</span></div>}
      <div className="lottery-overview">
        <article><span>抽奖轮次</span><strong>{rounds.length}</strong><small>{rounds.filter((x) => x.status === "completed").length} 轮已完成</small></article>
        <article><span>活动客户</span><strong>{customerCount.toLocaleString()}</strong><small>白名单有效客户</small></article>
        <article><span>现场到场</span><strong>{attendanceRows.length}</strong><small>当前到场名单</small></article>
        <article><span>已中奖客户</span><strong>{statistics.validWinnerCustomers}</strong><small>数据库当前有效 · {statistics.invalidatedWinnerRecords} 条已作废</small></article>
      </div>
      <div className="lottery-config-grid">
        <section className="round-list"><div className="section-heading"><h3>抽奖轮次</h3><span>按顺序执行</span></div>{rounds.map((item, index) => <button key={item.id} className={selected.id === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><i>{String(index + 1).padStart(2, "0")}</i><span><b>{item.name}</b><small>{item.prize}</small></span><em><small className={`round-status ${item.status}`}>{statusLabel[item.status]}</small>{item.winnerCount} 人</em></button>)}<button className="add-round" onClick={addRound}>＋ 新增抽奖轮次</button></section>
        <section className="round-form">
          <div className="round-form-heading"><div><h3>{selected.name}</h3><span className={`round-status ${selected.status}`}>{statusLabel[selected.status]}</span></div><div><button onClick={duplicateRound}>复制</button><button onClick={removeRound} disabled={selectedLocked}>删除</button></div></div>
          <label><span>轮次名称</span><input value={selected.name} disabled={selectedLocked} onChange={(e) => updateSelected({ name: e.target.value })} /></label>
          <label><span>奖品名称</span><input value={selected.prize} disabled={selectedLocked} onChange={(e) => updateSelected({ prize: e.target.value })} /></label>
          <label><span>中奖人数</span><input type="number" min="1" value={selected.winnerCount} disabled={selectedLocked} onChange={(e) => updateSelected({ winnerCount: Number(e.target.value) })} /></label>
          <label><span>客户类型</span><select value={selected.customerType} disabled={selectedLocked} onChange={(e) => updateSelected({ customerType: e.target.value as LotteryRound["customerType"] })}>{["全部客户", "特渠专业客户", "综合客户"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <fieldset className="candidate-scope"><legend>候选客户范围</legend>{scopeOptions.map((option) => <button type="button" key={option.key} className={selected.scope === option.key ? "active" : ""} disabled={selectedLocked} onClick={() => updateSelected({ scope: option.key, minAmount: option.key === "ordered" ? selected.minAmount : 0 })}><i>{selected.scope === option.key ? "✓" : ""}</i><span><b>{option.title}</b><small>{option.detail}</small></span></button>)}</fieldset>
          {selected.scope === "ordered" && <label><span>最低订单金额</span><div className="amount-input"><b>¥</b><input type="number" min="0" value={selected.minAmount} disabled={selectedLocked} onChange={(e) => updateSelected({ minAmount: Number(e.target.value) })} /></div><small className="field-help">填写 0 表示不限制订单金额；以开奖时有效订单为准</small></label>}
          <label className="check-setting repeat-setting"><input type="checkbox" checked={selectedIndex === 0 ? false : selected.excludeWinners} disabled={selectedLocked || selectedIndex === 0} onChange={(e) => updateSelected({ excludeWinners: e.target.checked })} /><span><b>排除本活动已中奖客户</b><small>{selectedIndex === 0 ? "第一轮暂无历史中奖客户，无需设置" : "按白名单客户 ID 避免跨轮次重复中奖"}</small></span></label>
          <div className="rule-summary"><span>当前规则</span><p>{ruleSummary}</p></div>
          <div className="candidate-preview"><div><span>实时候选池</span><strong>{previewLoading ? "…" : resolvedCandidateCount}<small> 人</small></strong><p>后端实时试算 · 按白名单客户 ID 去重 · {preview ? new Date(preview.calculatedAt).toLocaleString("zh-CN", { hour12: false }) : "等待试算"}</p>{preview && preview.unawardedCount > 0 && <small className="field-error">配置中奖 {preview.configuredWinnerCount} 人，当前将由全部 {preview.actualWinnerCount} 名候选中奖，空缺 {preview.unawardedCount} 个名额</small>}</div><button disabled={previewLoading || !preview} onClick={() => setPreviewOpen(true)}>查看候选名单</button></div>
        </section>
      </div>
      {previewOpen && preview && <div className="order-drawer-backdrop" onClick={() => setPreviewOpen(false)}><aside className="order-drawer candidate-drawer" onClick={(e) => e.stopPropagation()}><header><div><span>实时候选池预览</span><h2>{selected.name} · {resolvedCandidateCount} 人</h2></div><button onClick={() => setPreviewOpen(false)}>×</button></header><div className="candidate-funnel">{candidateSteps.map(([label, count]) => <div key={label}><span>{label}</span><b>{count}</b></div>)}</div><div className="candidate-table">{preview.candidates.map((candidate, index) => <div key={candidate.activityCustomerId}><span>{String(index + 1).padStart(3, "0")}</span><b>{candidate.dealerFullName}</b><em>{candidate.customerType === "SPECIAL" ? "特渠" : "综合"}</em><small>ID {candidate.activityCustomerId} · {candidate.branchName || candidate.regionCode || "—"}{candidate.qualifyingOrderAmount != null ? ` · ¥${Number(candidate.qualifyingOrderAmount).toLocaleString()}` : ""}</small></div>)}{preview.candidates.length === 0 && <div className="table-empty">当前没有符合条件的候选客户</div>}</div><footer><small>正式候选将在点击开始抽奖时再次校验并固定</small><button className="admin-primary" onClick={() => setPreviewOpen(false)}>关闭</button></footer></aside></div>}
    </div>
  );
}

function cloneAttendanceRows(rows: AttendanceRow[]) {
  return rows.map((row) => ({ ...row }));
}

function mapAdminAttendanceRows(attendees: AdminAttendee[]): AttendanceRow[] {
  return attendees.map((attendee, index) => ({
    id: String(attendee.id), activityCustomerId: attendee.activityCustomerId ?? null, sequence: index + 1,
    dealerName: attendee.participantName || "", gender: attendee.gender || "", contactPhone: attendee.phone || attendee.phoneMasked || "",
    branch: attendee.branchName || "", dealerCompany: attendee.dealerName, participantType: attendee.participantType || "",
    customerType: attendee.participantType?.includes("特渠") ? "特渠专业客户" : attendee.participantType?.includes("综合") ? "综合客户" : "",
    matchStatus: attendee.matchStatus, matchMethod: attendee.matchMethod, matchReasonCode: attendee.matchReasonCode,
    matchedDealerName: attendee.matchedDealerName, lotteryEligible: attendee.lotteryEligible,
  }));
}

const attendanceMatchLabels = { MATCHED: "已关联", PENDING_CONFIRMATION: "待确认", UNMATCHED: "未关联" } as const;
const attendanceMethodLabels = { PHONE: "手机号", FULL_NAME: "经销商全称", SHORT_NAME: "经销商简称", MANUAL: "人工确认" } as const;
const attendanceReasonLabels: Record<string, string> = {
  PHONE_NAME_CONFLICT: "手机号与名称冲突", FULL_SHORT_NAME_CONFLICT: "全称与简称冲突",
  MULTIPLE_CANDIDATES: "存在多个候选", CUSTOMER_TYPE_UNKNOWN: "客户类型无法识别",
  WHITELIST_NOT_PUBLISHED: "白名单未发布", NO_UNIQUE_MATCH: "没有唯一匹配结果", LEGACY_UNMATCHED: "历史记录未关联",
};

function AttendanceFormDrawer({ rows, initialRow, onClose, onSave }: { rows: AttendanceRow[]; initialRow?: AttendanceRow; onClose: () => void; onSave: (row: AttendanceRow) => void }) {
  const isEditing = Boolean(initialRow);
  const [form, setForm] = useState<AttendanceRow>(() => initialRow ? { ...initialRow } : { id: createImportRowId("attendance-manual"), sequence: 0, dealerName: "", gender: "", contactPhone: "", branch: "", dealerCompany: "", participantType: "", customerType: "" });
  const nextSequence = isEditing ? form.sequence : Math.max(0, ...rows.map((row) => row.sequence)) + 1;
  const update = (field: AttendanceFieldKey, value: string) => setForm((current) => ({ ...current, [field]: value, ...(field === "participantType" ? { customerType: attendanceCustomerType(value) } : {}) }));
  return (
    <div className="order-drawer-backdrop" onClick={onClose}>
      <aside className="order-drawer form-drawer attendance-form-drawer" onClick={(event) => event.stopPropagation()}>
        <header><div><span>现场到场客户</span><h2>{isEditing ? "编辑到场客户" : "手动添加到场客户"}</h2></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
        <div className="auto-sequence-note"><span>{isEditing ? "当前记录" : "序号自动生成"}</span><b>{isEditing ? `原序号：${form.sequence}` : `保存后编号：${nextSequence}`}</b><small>当前仅用于到场名单页面展示</small></div>
        <div className="drawer-form-body"><div className="drawer-form-grid">
          <label><span>分公司</span><input value={form.branch} onChange={(event) => update("branch", event.target.value)} placeholder="请输入分公司" /></label>
          <label><span>参会人姓名</span><input value={form.dealerName} onChange={(event) => update("dealerName", event.target.value)} placeholder="请输入参会人姓名" /></label>
          <label><span>性别</span><select value={form.gender} onChange={(event) => update("gender", event.target.value)}><option value="">请选择</option><option>男</option><option>女</option></select></label>
          <label><span>参会人电话</span><input inputMode="tel" value={form.contactPhone} onChange={(event) => update("contactPhone", event.target.value)} placeholder="请输入参会人电话" /></label>
          <label className="wide-field"><span>经销商名称</span><input value={form.dealerCompany} onChange={(event) => update("dealerCompany", event.target.value)} placeholder="请输入经销商名称" /></label>
          <label className="wide-field"><span>参会人员类型</span><input value={form.participantType} onChange={(event) => update("participantType", event.target.value)} placeholder="例如：综合经销商 / 特渠专业经销商" /></label>
        </div><p className="drawer-form-note">抽奖大屏只显示经销商名称；客户类型由参会人员类型自动识别。</p></div>
        <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="admin-primary" onClick={() => { onSave({ ...form, sequence: nextSequence, manuallyEdited: true }); onClose(); }}>{isEditing ? "保存修改" : "保存到场客户"}</button></footer>
      </aside>
    </div>
  );
}

function AttendanceTable({ rows, onEdit, onDelete, allowDelete = false, allowDeleteAll = false, readOnly = false }: { rows: AttendanceRow[]; onEdit: (row: AttendanceRow) => void; onDelete?: (ids: string[]) => void; allowDelete?: boolean; allowDeleteAll?: boolean; readOnly?: boolean }) {
  const [customerType, setCustomerType] = useState("全部");
  const [branch, setBranch] = useState("全部");
  const [matchStatus, setMatchStatus] = useState("全部");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const branchOptions = useMemo(() => ["全部", ...Array.from(new Set(rows.map((row) => row.branch).filter(Boolean)))], [rows]);
  const customerTypeOptions = useMemo(() => ["全部", ...Array.from(new Set(rows.map((row) => row.customerType).filter(Boolean)))], [rows]);
  const filteredRows = useMemo(() => {
    const keyword = normalizeSearchText(searchKeyword);
    return rows.filter((row) => {
      const values = [row.dealerName, row.gender, row.contactPhone, row.branch, row.dealerCompany, row.participantType, row.customerType];
      const matchesSearch = !keyword || values.some((value) => normalizeSearchText(value).includes(keyword));
      return (customerType === "全部" || row.customerType === customerType) && (branch === "全部" || row.branch === branch)
        && (matchStatus === "全部" || row.matchStatus === matchStatus) && matchesSearch;
    });
  }, [rows, customerType, branch, matchStatus, searchKeyword]);
  const sortedRows = useMemo(() => [...filteredRows].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id)), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);
  const pageIds = useMemo(() => pageRows.map((row) => row.id), [pageRows]);
  const filteredIds = useMemo(() => sortedRows.map((row) => row.id), [sortedRows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const openDelete = (ids: string[]) => {
    const targetRows = rows.filter((row) => ids.includes(row.id));
    setDeleteTarget({
      ids,
      labels: targetRows.map((row) => row.dealerCompany || row.dealerName || row.contactPhone),
      kind: "现场到场客户",
      description: "删除后将从当前现场到场名单和抽奖候选池中移除，不会删除原 Excel 文件。",
    });
  };
  const openClearAll = () => {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return;
    setDeleteTarget({
      ids,
      labels: rows.map((row) => row.dealerCompany || row.dealerName || row.contactPhone),
      kind: "现场到场客户",
      label: "全部当前到场名单",
      description: "将从当前现场到场名单和抽奖候选池中移除全部客户，不会删除原 Excel 文件。",
      summary: `当前共有 ${ids.length} 名到场客户`,
    });
  };
  const togglePageRows = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return [...next];
    });
  };
  const selectFilteredRows = () => {
    setSelectedIds((current) => [...new Set([...current, ...filteredIds])]);
  };
  const clearFilteredRows = () => {
    setSelectedIds((current) => current.filter((id) => !filteredIds.includes(id)));
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    onDelete?.(deleteTarget.ids);
    setSelectedIds((current) => current.filter((id) => !deleteTarget.ids.includes(id)));
    setDeleteTarget(null);
  };
  return (
    <>
      <div className="data-filters attendance-filters">
        <label><span>客户类型</span><select value={customerType} onChange={(event) => { setCustomerType(event.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option>{customerTypeOptions.filter((value) => value !== "全部").map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>分公司</span><select value={branch} onChange={(event) => { setBranch(event.target.value); setPage(1); setSelectedIds([]); }}><option>全部</option>{branchOptions.filter((value) => value !== "全部").map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>关联状态</span><select value={matchStatus} onChange={(event) => { setMatchStatus(event.target.value); setPage(1); setSelectedIds([]); }}><option value="全部">全部</option><option value="MATCHED">已关联</option><option value="PENDING_CONFIRMATION">待确认</option><option value="UNMATCHED">未关联</option></select></label>
        <label className="data-filter-search"><span>搜索到场客户</span><input type="search" value={searchKeyword} onChange={(event) => { setSearchKeyword(event.target.value); setPage(1); setSelectedIds([]); }} placeholder="姓名 / 联系电话 / 经销商名称" aria-label="搜索现场到场客户" /></label>
        <small>当前显示 {sortedRows.length} 名 · 第 {currentPage}/{totalPages}{readOnly ? "，活动已截止只读" : allowDelete ? "，可勾选删除" : "，可编辑"}</small>
      </div>
      {allowDelete && allowDeleteAll && rows.length > 0 && <div className="selection-toolbar selection-toolbar-all"><span>当前到场名单 <b>{rows.length}</b> 名</span><button type="button" className="selection-delete" onClick={openClearAll}>清空当前名单</button></div>}
      {allowDelete && selectedIds.length > 0 && <div className="selection-toolbar"><span>已选择 <b>{selectedIds.length}</b> 名客户{allFilteredSelected ? "（当前筛选结果）" : ""}</span><div>{!allFilteredSelected && filteredIds.length > pageIds.length && <button type="button" className="selection-select-all" onClick={selectFilteredRows}>选择全部 {filteredIds.length} 名</button>}{allFilteredSelected && <button type="button" className="selection-select-all" onClick={clearFilteredRows}>取消全选结果</button>}<button type="button" className="selection-clear" onClick={() => setSelectedIds([])}>取消选择</button><button type="button" className="selection-delete" onClick={() => openDelete(selectedIds)}>删除所选</button></div></div>}
      <div className="table-scroll">
        <div className={`data-table attendance-table ${allowDelete ? "with-selection" : ""}`}>
          <div className="table-row table-head">{allowDelete && <b className="select-cell"><input type="checkbox" aria-label="全选当前页到场客户" checked={allPageSelected} onChange={togglePageRows} /></b>}<b>序号</b><b>分公司</b><b>参会人姓名</b><b>性别</b><b>参会人电话</b><b>参会人员类型</b><b>经销商名称</b><b>关联状态</b><b>操作</b></div>
          {pageRows.map((row, index) => <div className="table-row" key={row.id}>
            {allowDelete && <span className="select-cell"><input type="checkbox" aria-label={`选择到场客户 ${row.dealerCompany || row.dealerName || row.contactPhone}`} checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></span>}<span>{pageStart + index + 1}</span><span>{row.branch || "—"}</span><span>{row.dealerName || "—"}</span><span>{row.gender || "—"}</span><span>{row.contactPhone || "—"}</span><span>{row.participantType || "—"}</span><span>{row.dealerCompany || "—"}</span><span className={`attendance-match-status ${(row.matchStatus || "UNMATCHED").toLowerCase()}`}><b>{row.matchStatus ? attendanceMatchLabels[row.matchStatus] : "导入后重算"}</b><small>{row.matchMethod ? attendanceMethodLabels[row.matchMethod] : attendanceReasonLabels[row.matchReasonCode || ""] || "—"}</small></span><span className="table-row-actions"><button type="button" disabled={readOnly} onClick={() => onEdit(row)}>编辑</button>{allowDelete && <button type="button" onClick={() => openDelete([row.id])}>删除</button>}</span>
          </div>)}
          {sortedRows.length === 0 && <div className="table-empty">当前条件下没有到场客户</div>}
        </div>
      </div>
      <div className="table-pagination"><span>共 {sortedRows.length} 名</span><div><label>每页<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select>名</label><button type="button" disabled={currentPage <= 1} onClick={() => setPage(1)}>首页</button><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><b>{currentPage} / {totalPages}</b><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button><button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(totalPages)}>末页</button></div></div>
      {deleteTarget && <DeleteConfirmDialog target={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />}
    </>
  );
}

function AttendancePage({ rows, fileName, warnings, sheetCounts, error, activityStarted, activityClosed, pendingImport, importAttemptName, onFile, onAdd, onEdit, onDelete, onConfirmImport, onCancelImport }: { rows: AttendanceRow[]; fileName: string; warnings: string[]; sheetCounts: Array<{ name: string; count: number }>; error: string; activityStarted: boolean; activityClosed: boolean; pendingImport: AttendanceImportDraft | null; importAttemptName: string; onFile: (file: File) => void | Promise<void>; onAdd: () => void; onEdit: (row: AttendanceRow) => void; onDelete: (ids: string[]) => void; onConfirmImport: () => void; onCancelImport: () => void }) {
  const previewRows = pendingImport?.rows ?? rows;
  const displayWarnings = pendingImport?.warnings ?? warnings;
  const displaySheetCounts = pendingImport?.sheetCounts ?? sheetCounts;
  const displayFileName = pendingImport?.fileName || (error ? importAttemptName : fileName);
  const isPending = Boolean(pendingImport);
  const originalCount = pendingImport?.inputCount ?? previewRows.length;
  const removedCount = Math.max(0, originalCount - previewRows.length);
  const comprehensiveCount = previewRows.filter((row) => row.customerType.includes("综合")).length;
  const specialCount = previewRows.filter((row) => row.customerType.includes("特渠")).length;
  const blankTypeCount = previewRows.filter((row) => !row.customerType).length;
  const phoneCount = previewRows.filter((row) => row.contactPhone).length;
  const linkedCount = previewRows.filter((row) => row.matchStatus === "MATCHED" && row.lotteryEligible).length;
  const pendingCount = previewRows.filter((row) => row.matchStatus === "PENDING_CONFIRMATION").length;
  const unmatchedCount = previewRows.filter((row) => row.matchStatus === "UNMATCHED").length;
  return (
    <div className="admin-panel attendance-panel">
      <div className="panel-title"><div><h2>现场到场客户</h2><p>按现场参会名单模板导入；抽奖选择现场到场客户时，现场大屏显示经销商名称。</p></div><div className="panel-actions"><button className="secondary-button" disabled={activityClosed} onClick={onAdd}>＋ 手动添加到场客户</button></div></div>
      <div className="import-rule-hint"><b>{isPending ? "待确认导入" : activityClosed ? "活动已截止" : activityStarted ? "活动已开始" : "导入规则"}</b><span>{isPending ? "Excel 已解析，下面显示的是待导入预览；确认后才会替换当前名单并更新抽奖候选池，可先编辑或删除异常记录。" : activityClosed ? "活动已截止，现场到场名单只读。" : activityStarted ? "活动已开始，现场到场 Excel 导入和批量替换已锁定；如需补录，请手动添加或编辑单条记录。" : "活动开始前允许导入完整现场到场 Excel；分公司、参会人姓名、性别、参会人电话、参会人员类型、经销商名称会按表头识别。"}</span></div>
      <div className="attendance-upload-grid">
        <article className={`file-upload-card attendance-upload-card ${isPending ? "pending" : displayFileName && !error ? "ready" : ""}`}>
          <div className="file-card-heading"><span>XL</span><div><b>现场到场客户 Excel</b><small>选择文件后先预览，确认后替换当前名单</small></div><em>{isPending ? "待确认" : error ? "解析失败" : displayFileName ? "解析完成" : "待上传"}</em></div>
          <p title={displayFileName}>{displayFileName || "尚未选择真实 Excel 文件"}</p>
          <div className="sheet-counts">{displaySheetCounts.length > 0 ? displaySheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>) : <span>{isPending ? "待导入名单" : "当前名单"}<b>{previewRows.length}</b></span>}</div>
          {error && <div className="warning-box"><b>文件无法导入</b><span>{error}</span></div>}
                <footer><small>{isPending ? `Excel 原始 ${originalCount} 名 · 已移除 ${removedCount} 名 · 待发布 ${previewRows.length} 名` : activityClosed ? "活动已截止，名单只读" : activityStarted ? "活动已开始，Excel 导入已锁定" : error ? "文件解析失败，请修正后重试" : displayFileName ? `已读取 ${previewRows.length} 名客户` : "支持 .xlsx 文件"}</small><div>{isPending && <button type="button" onClick={onCancelImport}>取消导入</button>}{error && !isPending && <button type="button" onClick={onCancelImport}>清除错误</button>}<label className={`file-button ${activityStarted ? "disabled" : ""}`}><input type="file" accept=".xlsx" disabled={activityStarted} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void onFile(file); }} />{isPending || displayFileName ? "重新选择文件" : "选择 Excel"}</label>{isPending && <button type="button" className="admin-primary" disabled={activityStarted || activityClosed || previewRows.length === 0} onClick={onConfirmImport}>确认导入 {previewRows.length} 名</button>}</div></footer>
        </article>
        <div className="attendance-overview-card"><div><span>{isPending ? "待发布名单" : "当前名单"}</span><strong>{previewRows.length}<small> 名</small></strong><em>{isPending ? `原始 ${originalCount} · 移除 ${removedCount}` : "当前导入批次"}</em></div><div><span>已关联／有资格</span><b>{isPending ? "—" : linkedCount}</b></div><div><span>待确认</span><b>{isPending ? "—" : pendingCount}</b></div><div><span>未关联</span><b>{isPending ? "—" : unmatchedCount}</b></div><div><span>综合／特渠</span><b>{comprehensiveCount}／{specialCount}</b></div><div><span>已填写电话</span><b>{phoneCount}</b></div><div><span>未填客户类型</span><b>{blankTypeCount}</b></div><p>{isPending ? "当前为导入预览；发布后按当前完整白名单重新计算关联结果。" : "仅已关联当前有效白名单的到场记录具备现场抽奖资格。"}</p></div>
      </div>
      {displayWarnings.length > 0 && <div className="warning-box attendance-warning"><b>导入提示</b>{displayWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
      <div className="data-section-title"><div><b>{isPending ? "待导入到场客户预览" : "到场客户名单"}</b><span>{isPending ? `${pendingImport?.fileName} · 尚未确认` : fileName ? `${fileName} · 当前导入结果` : "尚未导入到场名单"}</span></div><span className={`attendance-not-linked ${isPending ? "pending" : ""}`}>{isPending ? "发布后重新关联" : `已关联 ${linkedCount} / ${previewRows.length}`}</span></div>
      <AttendanceTable rows={previewRows} onEdit={onEdit} onDelete={onDelete} allowDelete={!activityStarted} allowDeleteAll={!activityStarted} readOnly={activityClosed} />
    </div>
  );
}

type ProductRowsSetter = (value: ProductImportRow[] | ((current: ProductImportRow[]) => ProductImportRow[])) => void;
type WhitelistRowsSetter = (value: WhitelistRow[] | ((current: WhitelistRow[]) => WhitelistRow[])) => void;
type AttendanceRowsSetter = (value: AttendanceRow[] | ((current: AttendanceRow[]) => AttendanceRow[])) => void;
type OperationLogEntry = { id: string; action: string; target: string; detail: string; operator: string; time: string };

function AdminPrototype({ lotteryRounds, onLotteryChange, activityName, onActivityNameChange, activityId, activityStatus, onActivityStatusChange, activityStartAt, onActivityStartAtChange, activityEndAt, onActivityEndAtChange, productRows, onProductRowsChange, productImportCompleted, onProductImportCompleted, onProductImportCommitted, productImportHasRun, whitelistRows, onWhitelistRowsChange, whitelistImportCompleted, onWhitelistImportCompleted, onWhitelistImportCommitted, whitelistImportHasRun, attendanceRows, onAttendanceRowsChange, attendanceFileName, onAttendanceFileNameChange, attendanceWarnings, onAttendanceWarningsChange, attendanceSheetCounts, onAttendanceSheetCountsChange, attendanceImportError, onAttendanceImportErrorChange }: { lotteryRounds: LotteryRound[]; onLotteryChange: (rounds: LotteryRound[]) => void; activityName: string; onActivityNameChange: (value: string) => void; activityId: string; activityStatus: ActivityStatus; onActivityStatusChange: (status: ActivityStatus) => void; activityStartAt: string; onActivityStartAtChange: (value: string) => void; activityEndAt: string; onActivityEndAtChange: (value: string) => void; productRows: ProductImportRow[]; onProductRowsChange: ProductRowsSetter; productImportCompleted: boolean; onProductImportCompleted: (completed: boolean) => void; onProductImportCommitted: () => void; productImportHasRun: boolean; whitelistRows: WhitelistRow[]; onWhitelistRowsChange: WhitelistRowsSetter; whitelistImportCompleted: boolean; onWhitelistImportCompleted: (completed: boolean) => void; onWhitelistImportCommitted: () => void; whitelistImportHasRun: boolean; attendanceRows: AttendanceRow[]; onAttendanceRowsChange: AttendanceRowsSetter; attendanceFileName: string; onAttendanceFileNameChange: (value: string) => void; attendanceWarnings: string[]; onAttendanceWarningsChange: (value: string[]) => void; attendanceSheetCounts: Array<{ name: string; count: number }>; onAttendanceSheetCountsChange: (value: Array<{ name: string; count: number }>) => void; attendanceImportError: string; onAttendanceImportErrorChange: (value: string) => void }) {
  const activityStarted = activityStatus === "running" || activityStatus === "ended";
  const activityClosed = activityStatus === "ended";
  const [tab, setTab] = useState("活动概览");
  const setProductRows = onProductRowsChange;
  const setWhitelistRows = onWhitelistRowsChange;
  const setProductImportCompleted = onProductImportCompleted;
  const setWhitelistImportCompleted = onWhitelistImportCompleted;
  const [editingProductRow, setEditingProductRow] = useState<ProductImportRow | null>(null);
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [editingWhitelistRow, setEditingWhitelistRow] = useState<WhitelistRow | null>(null);
  const [whitelistFormOpen, setWhitelistFormOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [operationLogs, setOperationLogs] = useState<OperationLogEntry[]>([]);
  const [operationLogOpen, setOperationLogOpen] = useState(false);
  const [activityStartDraft, setActivityStartDraft] = useState(activityStartAt);
  const [activityEndDraft, setActivityEndDraft] = useState(activityEndAt);
  const [activityNameDraft, setActivityNameDraft] = useState(activityName);
  const [productFileName, setProductFileName] = useState("");
  const [productImportWarnings, setProductImportWarnings] = useState<string[]>([]);
  const [productImportError, setProductImportError] = useState("");
  const [productSheetCounts, setProductSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [productImportInputCount, setProductImportInputCount] = useState(0);
  const productImportStats = useMemo(() => summarizeProductImportRows(productRows), [productRows]);
  const [pendingProductRollbackRows, setPendingProductRollbackRows] = useState<ProductImportRow[] | null>(null);
  const [productImageAssets, setProductImageAssets] = useState<ProductImageAsset[]>([]);
  const [productImageFileName, setProductImageFileName] = useState("");
  const [productImageUploadFile, setProductImageUploadFile] = useState<File | null>(null);
  const productImageStats = useMemo<ProductImageStats>(() => ({
    totalProducts: productRows.length,
    matchedProducts: productRows.filter((row) => row.imageStatus === "已匹配").length,
    pendingProducts: productRows.filter((row) => row.imageStatus === "待确认").length,
    unmatchedProducts: productRows.filter((row) => row.imageStatus !== "已匹配" && row.imageStatus !== "待确认").length,
  }), [productRows]);
  const resolvedProductImageAssets = useMemo(() => productImageAssets.map((asset) => {
    const references = productRows.flatMap((row) => row.images?.filter((image) => image.id === asset.id) ?? []);
    const hasConfirmedReference = references.some((image) => image.matchStatus !== "待确认");
    const hasPendingReference = references.some((image) => image.matchStatus === "待确认");
    return { ...asset, matchStatus: hasConfirmedReference ? "已匹配" as const : hasPendingReference ? "待确认" as const : "未匹配" as const };
  }), [productImageAssets, productRows]);
  const [productImageError, setProductImageError] = useState("");
  const [whitelistFileName, setWhitelistFileName] = useState("");
  const [whitelistImportWarnings, setWhitelistImportWarnings] = useState<string[]>([]);
  const [whitelistImportError, setWhitelistImportError] = useState("");
  const [whitelistSheetCounts, setWhitelistSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [whitelistImportInputCount, setWhitelistImportInputCount] = useState(0);
  const whitelistImportStats = useMemo(() => summarizeWhitelistRows(whitelistRows), [whitelistRows]);
  const [pendingWhitelistRollbackRows, setPendingWhitelistRollbackRows] = useState<WhitelistRow[] | null>(null);
  const setAttendanceRows = onAttendanceRowsChange;
  const [attendanceFormOpen, setAttendanceFormOpen] = useState(false);
  const [editingAttendanceRow, setEditingAttendanceRow] = useState<AttendanceRow | null>(null);
  const [pendingAttendanceImport, setPendingAttendanceImport] = useState<AttendanceImportDraft | null>(null);
  const [attendanceImportAttemptName, setAttendanceImportAttemptName] = useState("");
  const [serverImportTasks, setServerImportTasks] = useState<Partial<Record<"PRODUCT" | "WHITELIST" | "ATTENDANCE", number>>>({});
  const [serverImportBlocking, setServerImportBlocking] = useState<Partial<Record<"PRODUCT" | "WHITELIST" | "ATTENDANCE", number>>>({});
  const [regionCodesByName, setRegionCodesByName] = useState<Record<string, string>>({});
  const [overviewDashboard, setOverviewDashboard] = useState<DashboardData | null>(null);
  const [overviewByType, setOverviewByType] = useState<{ GENERAL: DashboardData | null; SPECIAL: DashboardData | null }>({ GENERAL: null, SPECIAL: null });
  const nav = ["活动概览", "商品导入", "白名单", "现场到场", "订单管理", "抽奖规则"];
  const parsedProductCount = productFileName ? productImportInputCount : 0;
  const parsedWhitelistCount = whitelistFileName ? whitelistImportInputCount : 0;
  const removedProductCount = Math.max(0, parsedProductCount - productImportStats.total);
  const removedWhitelistCount = Math.max(0, parsedWhitelistCount - whitelistImportStats.total);
  useEffect(() => {
    let active = true;
    const refreshOverview = async () => {
      try {
        const [all, general, special] = await Promise.all([
          loadDashboard(), loadDashboard({ customerType: "GENERAL" }), loadDashboard({ customerType: "SPECIAL" }),
        ]);
        if (active) {
          setOverviewDashboard(all);
          setOverviewByType({ GENERAL: general, SPECIAL: special });
        }
      } catch {
        // 其它后台数据仍可正常维护；概览保留最近一次成功结果。
      }
    };
    void refreshOverview();
    const timer = window.setInterval(refreshOverview, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [activityId]);
  useEffect(() => {
    const numericActivityId = Number(activityId);
    if (!Number.isFinite(numericActivityId)) return;
    let active = true;
    void Promise.all([loadActivity(), loadAdminProducts(numericActivityId), loadAdminCustomers(numericActivityId),
      loadAdminAttendees(numericActivityId), loadLotteryRules(numericActivityId), loadAuditLogs(numericActivityId)]).then(([activity, serverProducts, customers, attendees, rules, auditLogs]) => {
      if (!active) return;
      const regionNames = new Map(activity.regions.map((region) => [region.code, region.name]));
      setRegionCodesByName(Object.fromEntries(activity.regions.map((region) => [region.name, region.code])));
      if (serverProducts.length > 0) {
        setProductRows(serverProducts.map(runtimeProductToImportRow));
        onProductImportCompleted(true); onProductImportCommitted(); setProductFileName("当前已发布商品目录"); setProductImportInputCount(serverProducts.length);
      }
      if (customers.length > 0) {
        setWhitelistRows(customers.map((customer, index) => ({
          id: String(customer.id), serverVersion: customer.lockVersion, sequence: customer.excelSequence ?? index + 1,
          customerType: customer.customerType === "GENERAL" ? "综合客户" : "特渠专业客户",
          region: regionNames.get(customer.regionCode || "") || customer.regionCode || "", branch: customer.branchName || "",
          dealerShort: customer.dealerShortName || "", dealerFull: customer.dealerFullName, dealerType: customer.dealerCategory || "",
          dealerName: customer.contactName || "", dealerPhone: customer.phone || customer.phoneMasked, confirmerName: customer.confirmerName || "",
          confirmerPhone: customer.confirmerPhone || customer.confirmerPhoneMasked || "", status: customer.active ? "有效" : "待处理", source: "excel",
        })));
        onWhitelistImportCompleted(true); onWhitelistImportCommitted(); setWhitelistFileName("当前已发布白名单"); setWhitelistImportInputCount(customers.length);
      }
      if (attendees.length > 0) {
        setAttendanceRows(mapAdminAttendanceRows(attendees));
        onAttendanceFileNameChange("当前已发布现场到场名单");
      }
      const rule = rules.find((item) => item.status === "PUBLISHED") ?? rules[0];
      if (rule) onLotteryChange(mapLotteryRule(rule));
      setOperationLogs(auditLogs.map((entry) => ({ id: String(entry.id), action: entry.actionCode, target: `${entry.objectType}${entry.objectId ? ` #${entry.objectId}` : ""}`,
        detail: entry.result === "SUCCESS" ? `操作成功 · 追踪号 ${entry.traceId}` : `操作失败：${entry.errorCode || "未知错误"}`,
        operator: entry.actorName || (entry.actorType === "H5_CUSTOMER" ? "H5 客户" : "系统"),
        time: new Date(entry.occurredAt).toLocaleString("zh-CN", { hour12: false }) })));
    }).catch((reason) => { if (active) setActionNotice(reason instanceof ApiError ? reason.message : "后台数据加载失败"); });
    return () => { active = false; };
  }, [activityId, onAttendanceFileNameChange, onLotteryChange, onProductImportCommitted, onProductImportCompleted,
    onWhitelistImportCommitted, onWhitelistImportCompleted, setAttendanceRows, setProductRows, setWhitelistRows]);
  const recordOperation = (action: string, target: string, detail: string) => {
    setOperationLogs((current) => [{ id: createImportRowId("operation"), action, target, detail, operator: "运营管理员", time: new Date().toLocaleString("zh-CN", { hour12: false }) }, ...current]);
  };
  const changeActivityStatus = async (nextStatus: ActivityStatus) => {
    if (Number.isFinite(Number(activityId))) {
      try {
        const current = await loadActivity();
        const target = nextStatus === "running" ? "ACTIVE" : nextStatus === "ended" ? "CLOSED" : nextStatus === "scheduled" ? "SCHEDULED" : "DRAFT";
        await transitionActivity(current, target);
      } catch (error) {
        setActionNotice(error instanceof ApiError ? error.message : "活动状态保存失败，请稍后重试。");
        return;
      }
    }
    const nextStarted = nextStatus === "running" || nextStatus === "ended";
    if (nextStatus === "ended" && !activityClosed) {
      setActionNotice("活动已截止，基础数据已锁定并进入只读状态。" );
      recordOperation("截止活动并锁定基础数据", "活动及基础数据", "活动截止后订单和基础数据进入只读状态。" );
    } else if (nextStarted && !activityStarted) {
      if (!productImportCompleted && productFileName) cancelProductImport();
      if (!whitelistImportCompleted && whitelistFileName) cancelWhitelistImport();
      if (pendingAttendanceImport) cancelAttendanceImport();
      setActionNotice(nextStatus === "ended" ? "活动已截止，基础数据已锁定并进入只读状态。" : "活动已开始，商品、白名单和现场到场 Excel 导入已锁定；如需调整只能改单条。");
      recordOperation(nextStatus === "ended" ? "截止活动并锁定基础数据" : "开始活动并锁定基础数据", "活动及基础数据", nextStatus === "ended" ? "活动截止后订单和基础数据进入只读状态。" : "活动开始后禁止 Excel、批量图片导入和批量删除。" );
    } else if (!nextStarted && activityStarted) {
      setActionNotice("活动已恢复为准备状态，当前可重新导入完整 Excel。");
      recordOperation("恢复活动准备状态", "活动及基础数据", "解除活动开始后的导入锁定，可重新导入完整商品、白名单和现场到场 Excel。" );
    } else {
      setActionNotice(`活动状态已切换为${nextStatus === "draft" ? "草稿" : nextStatus === "scheduled" ? "待开始" : nextStatus === "running" ? "进行中" : "已截止"}。`);
      recordOperation("调整活动状态", "活动状态", `状态调整为${nextStatus === "draft" ? "草稿" : nextStatus === "scheduled" ? "待开始" : nextStatus === "running" ? "进行中" : "已截止"}。`);
    }
    onActivityStatusChange(nextStatus);
  };
  const saveActivityConfig = async () => {
    if (!activityNameDraft.trim()) {
      setActionNotice("请填写活动名称。" );
      return;
    }
    if (!activityStartDraft || !activityEndDraft) {
      setActionNotice("请填写活动开始时间和截止时间。" );
      return;
    }
    if (new Date(activityStartDraft).getTime() >= new Date(activityEndDraft).getTime()) {
      setActionNotice("活动开始时间必须早于截止时间。" );
      return;
    }
    if (Number.isFinite(Number(activityId))) {
      try { await updateActivity(await loadActivity(), { name: activityNameDraft.trim(), startsAt: activityStartDraft, endsAt: activityEndDraft }); }
      catch (error) { setActionNotice(error instanceof ApiError ? error.message : "活动配置保存失败，请稍后重试。"); return; }
    }
    onActivityNameChange(activityNameDraft.trim());
    onActivityStartAtChange(activityStartDraft);
    onActivityEndAtChange(activityEndDraft);
    recordOperation("保存活动配置", activityId, `活动名称：${activityNameDraft.trim()}；活动编号：${activityId}；开始：${activityStartDraft.replace("T", " ")}；截止：${activityEndDraft.replace("T", " ")}。`);
    setActionNotice("活动名称、编号和时间配置已保存。" );
  };
  const beginProductImport = () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止重新导入商品 Excel。");
      return;
    }
    setProductImportCompleted(false);
    setProductFileName("");
    setProductSheetCounts([]);
    setProductImportWarnings([]);
    setProductImportError("");
    setProductImportInputCount(0);
    setPendingProductRollbackRows(null);
    revokeProductImageAssets(productImageAssets);
    setProductImageAssets([]);
    setProductImageFileName("");
    setProductImageUploadFile(null);
  };
  const cancelProductImport = () => {
    const hadConfirmedImport = productImportHasRun;
    if (pendingProductRollbackRows) setProductRows(cloneProductRows(pendingProductRollbackRows));
    setPendingProductRollbackRows(null);
    revokeProductImageAssets(productImageAssets);
    setProductImageAssets([]);
    setProductImageFileName("");
    setProductImageUploadFile(null);
    setProductFileName("");
    setProductSheetCounts([]);
    setProductImportWarnings([]);
    setProductImportError("");
    setProductImportInputCount(0);
    setProductImportCompleted(hadConfirmedImport);
    setActionNotice("已取消本次商品替换，当前商品目录保持不变。" );
  };
  const confirmProductImport = async () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止确认商品 Excel 导入。");
      return;
    }
    if ((serverImportBlocking.PRODUCT ?? 0) > 0) {
      setActionNotice(`仍有 ${serverImportBlocking.PRODUCT} 条商品异常，请先编辑或删除后再发布。`);
      return;
    }
    const imageWarningCount = productImageStats.pendingProducts + productImageStats.unmatchedProducts;
    if (imageWarningCount > 0 && !window.confirm(`本批次有 ${productImageStats.pendingProducts} 个商品图片待确认、${productImageStats.unmatchedProducts} 个商品图片未匹配。发布后这些商品将使用默认图片，是否继续？`)) return;
    const taskId = serverImportTasks.PRODUCT;
    let publishedRows: ProductImportRow[] | null = null;
    if (taskId) {
      try {
        await confirmImport(Number(activityId), taskId, productImageUploadFile ?? undefined,
          buildProductImageDecisions(productRows, resolvedProductImageAssets));
        await waitForImport(Number(activityId), taskId);
        publishedRows = (await loadAdminProducts(Number(activityId))).map(runtimeProductToImportRow);
      } catch (error) {
        setActionNotice(error instanceof ApiError ? error.message : "商品导入发布失败，请检查后重试。");
        return;
      }
    }
    const cleanRows = publishedRows ?? productRows;
    setProductRows(cleanRows);
    setPendingProductRollbackRows(null);
    setProductImportCompleted(true);
    onProductImportCommitted();
    recordOperation("替换商品 Excel", productFileName || "商品信息 Excel", `共 ${productImportStats.total} 条；有效 ${productImportStats.valid} 条，待完善 ${productImportStats.incomplete} 条。`);
    setActionNotice(`商品目录已替换：共 ${productImportStats.total} 条，有效 ${productImportStats.valid} 条、待完善 ${productImportStats.incomplete} 条${productImageUploadFile ? "，本批次图片已同步" : "，未匹配商品使用默认图片"}。`);
  };
  const handleProductFile = async (file: File) => {
    if (activityStarted) {
      setProductImportError("活动已开始，禁止重新导入商品 Excel。");
      setActionNotice("活动已开始，禁止重新导入商品 Excel。");
      return;
    }
    setProductImportError("");
    try {
      const result = await parseProductWorkbook(file);
      let serverRows: ImportStagingRow[] = [];
      if (Number.isFinite(Number(activityId))) {
        const task = await uploadImport(Number(activityId), "PRODUCT", file);
        setServerImportTasks((current) => ({ ...current, PRODUCT: Number(task.id) }));
        setServerImportBlocking((current) => ({ ...current, PRODUCT: Number(task.errorCount || 0) }));
        serverRows = await loadImportRows(Number(activityId), Number(task.id));
      }
      revokeProductImageAssets(productImageAssets);
      const imageResult = matchProductImages(result.rows, []);
      const nextRows = bindProductStaging(imageResult.rows, serverRows);
      setProductImageAssets([]);
      setProductImageFileName("");
      setProductImageUploadFile(null);
      setPendingProductRollbackRows(pendingProductRollbackRows ? pendingProductRollbackRows : cloneProductRows(productRows));
      setProductRows(nextRows);
      setProductFileName(file.name);
      setProductSheetCounts(result.sheetCounts);
      setProductImportInputCount(result.rows.length);
      setProductImportWarnings(result.warnings);
      setProductImportCompleted(false);
      const stats = summarizeProductImportRows(nextRows);
      setActionNotice(`已解析 ${stats.total} 条商品：有效 ${stats.valid} 条、待完善 ${stats.incomplete} 条、待核对 ${stats.review} 条，请检查后确认替换。`);
    } catch (error) {
      setProductFileName(file.name);
      setProductSheetCounts([]);
      setProductImportInputCount(0);
      setProductImportWarnings([]);
      setProductImportError(error instanceof Error ? error.message : "文件解析失败，请检查 Excel 格式。");
      setProductImportCompleted(false);
    }
  };
  const handleProductImageFile = async (file: File) => {
    if (activityStarted) {
      setProductImageError("活动已开始，禁止批量导入商品图片。");
      setActionNotice("活动已开始，禁止批量导入商品图片；如需修改请编辑单条商品。");
      return;
    }
    setProductImageError("");
    try {
      const assets = await parseProductImageZip(file);
      const imageResult = matchProductImages(productRows, assets);
      revokeProductImageAssets(productImageAssets);
      setProductImageAssets(imageResult.assets);
      setProductImageFileName(file.name);
      setProductImageUploadFile(file);
      setProductRows(imageResult.rows);
      setActionNotice(`已读取 ${assets.length} 张图片：已匹配 ${imageResult.stats.matchedProducts} 个商品、待确认 ${imageResult.stats.pendingProducts} 个商品、未匹配 ${imageResult.stats.unmatchedProducts} 个商品。`);
    } catch (error) {
      setProductImageError(error instanceof Error ? error.message : "图片 ZIP 解析失败，请检查文件。");
    }
  };
  const removeProductImages = () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止批量移除商品图片；如需修改请编辑单条商品。");
      return;
    }
    revokeProductImageAssets(productImageAssets);
    setProductImageAssets([]);
    setProductImageFileName("");
    setProductImageUploadFile(null);
    setProductImageError("");
    setProductRows((current) => current.map((row) => ({ ...row, images: undefined, imageStatus: "未匹配" })));
    setActionNotice("已移除本批次 ZIP，全部商品恢复为未匹配；当前已发布目录不受影响。");
  };
  const refreshServerImportPreview = async (type: "PRODUCT" | "WHITELIST" | "ATTENDANCE") => {
    const taskId = serverImportTasks[type];
    if (!taskId || !Number.isFinite(Number(activityId))) return;
    const [task, staging] = await Promise.all([loadImportTask(Number(activityId), taskId), loadImportRows(Number(activityId), taskId)]);
    setServerImportBlocking((current) => ({ ...current, [type]: task.errorCount }));
    if (type === "PRODUCT") {
      setProductRows((current) => {
        const next = bindProductStaging(current, staging);
        return next;
      });
    } else if (type === "WHITELIST") {
      setWhitelistRows((current) => bindWhitelistStaging(current, staging));
    } else {
      setPendingAttendanceImport((current) => current ? { ...current, rows: bindAttendanceStaging(current.rows, staging) } : current);
    }
  };
  const openProductForm = () => {
    if (activityClosed) {
      setActionNotice("活动已截止，商品数据只读。" );
      return;
    }
    if (!productImportCompleted && (!productFileName || productImportError)) {
      setActionNotice("请先完成一次商品 Excel 解析，再手动添加商品。" );
      return;
    }
    setEditingProductRow(null);
    setProductFormOpen(true);
  };
  const saveProductRow = async (row: ProductImportRow, reason = "") => {
    if (activityClosed) {
      setActionNotice("活动已截止，商品数据只读。" );
      return false;
    }
    const nextRow = { ...row, imageStatus: productImageStatusForAssets(row.images) };
    const numeric = (value: string) => value.trim() === "" ? null : Number(value);
    const productBody = {
      customerType: nextRow.customerType === "综合" ? "GENERAL" : "SPECIAL",
      rebateStatus: nextRow.rebate === "参与" ? "PARTICIPATING" : "NOT_PARTICIPATING",
      categoryName: nextRow.category, productLine: nextRow.line, materialCode: nextRow.materialCode,
      materialName: nextRow.materialName, brandName: nextRow.brand, varietyName: nextRow.variety,
      specification: nextRow.spec, casePack: nextRow.casePack, bottlePrice: numeric(nextRow.unitPrice),
      casePrice: numeric(nextRow.casePrice), tonCaseFactor: numeric(nextRow.conversion), giftBox: nextRow.gift === "是",
      visible: true, orderable: Number(nextRow.casePrice) > 0, branchScope: nextRow.branchScope, reason,
    };
    if (editingProductRow) {
      if (!productImportCompleted && editingProductRow.serverRowId && serverImportTasks.PRODUCT) {
        try {
          await updateImportRow(Number(activityId), serverImportTasks.PRODUCT, editingProductRow.serverRowId, {
            customerType: nextRow.customerType === "综合" ? "GENERAL" : "SPECIAL",
            rebateStatus: nextRow.rebate === "参与" ? "PARTICIPATING" : "NOT_PARTICIPATING",
            categoryName: nextRow.category, productLine: nextRow.line, materialCode: nextRow.materialCode,
            materialName: nextRow.materialName, brandName: nextRow.brand, varietyName: nextRow.variety,
            specification: nextRow.spec, casePack: nextRow.casePack, bottlePrice: nextRow.unitPrice,
            casePrice: nextRow.casePrice, tonCaseFactor: nextRow.conversion, giftBox: nextRow.gift === "是",
            branchScope: nextRow.branchScope,
          });
        } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品预览修改失败"); return false; }
      }
      let savedRow = { ...nextRow, manuallyEdited: true };
      if (productImportCompleted && editingProductRow.serverVersion !== undefined) {
        try {
          const productId = Number(editingProductRow.id);
          const saved = await updateAdminProduct(Number(activityId), Number(editingProductRow.id), editingProductRow.serverVersion, {
            ...productBody, bottlePriceSet: true, casePriceSet: true, tonCaseFactorSet: true,
          });
          savedRow = { ...savedRow, id: String(saved.id), serverVersion: saved.version,
            status: saved.dataStatus === "INCOMPLETE" ? "待完善" : "有效" };
          const desiredImages = savedRow.images ?? [];
          const desiredPersistedIds = new Set(desiredImages.map((image) => Number(image.id)).filter(Number.isSafeInteger));
          const originalPersistedIds = (editingProductRow.images ?? []).map((image) => Number(image.id)).filter(Number.isSafeInteger);
          for (const imageId of originalPersistedIds.filter((imageId) => !desiredPersistedIds.has(imageId))) {
            await deleteAdminProductImage(Number(activityId), productId, imageId);
          }
          const uploadedIds = new Map<string, number>();
          for (const image of desiredImages.filter((item) => !Number.isSafeInteger(Number(item.id)) && item.file)) {
            const uploaded = await addAdminProductImage(Number(activityId), productId, image.file!, false);
            uploadedIds.set(image.id, uploaded.id);
          }
          const orderedImageIds = desiredImages.map((image) => Number.isSafeInteger(Number(image.id)) ? Number(image.id) : uploadedIds.get(image.id))
            .filter((imageId): imageId is number => imageId !== undefined);
          for (let index = 0; index < orderedImageIds.length; index += 1) {
            await updateAdminProductImage(Number(activityId), productId, orderedImageIds[index], index === 0, index);
          }
          const refreshed = (await loadAdminProducts(Number(activityId))).find((product) => product.id === productId);
          if (refreshed) savedRow = { ...runtimeProductToImportRow(refreshed), manuallyEdited: true };
        } catch (error) { setActionNotice(error instanceof ApiError ? `商品或图片保存失败：${error.message}` : "商品或图片保存失败，请刷新后重试"); return false; }
      }
      const confirmedZipIds = new Set((savedRow.images ?? []).filter((image) => image.source === "zip" && image.matchStatus !== "待确认").map((image) => image.id));
      const confirmedZipImages = (savedRow.images ?? []).filter((image) => confirmedZipIds.has(image.id));
      const savedProductKey = normalizeProductImageName(savedRow.materialName);
      setProductImageAssets((current) => current.map((image) => confirmedZipIds.has(image.id) ? { ...image, matchStatus: "已匹配" } : image));
      setProductRows((current) => current.map((item) => {
        if (item.id === nextRow.id) return savedRow;
        const sameProduct = savedProductKey !== "" && normalizeProductImageName(item.materialName) === savedProductKey;
        const retainedImages = item.images?.filter((image) => !confirmedZipIds.has(image.id)) ?? [];
        const images = sameProduct ? [...retainedImages, ...confirmedZipImages] : retainedImages;
        return { ...item, images: images?.length ? images : undefined, imageStatus: productImageStatusForAssets(images) };
      }));
      if (!productImportCompleted) await refreshServerImportPreview("PRODUCT");
      if (activityStarted) recordOperation("活动开始后改单条商品", nextRow.materialName, `修改前：物料代码 ${editingProductRow.materialCode || "—"}、名称 ${editingProductRow.materialName || "—"}、元/箱 ${editingProductRow.casePrice || "—"}、分公司 ${editingProductRow.branchScope || "全部"}、状态 ${editingProductRow.status}；修改后：物料代码 ${nextRow.materialCode || "—"}、名称 ${nextRow.materialName || "—"}、元/箱 ${nextRow.casePrice || "—"}、分公司 ${nextRow.branchScope || "全部"}、状态 ${nextRow.status}；原因：${reason || "—"}。`);
      setActionNotice(`${activityStarted ? "已记录并保存" : "已保存"}商品修改：${nextRow.materialName}`);
      return true;
    }
    if (!productImportCompleted && productFileName) {
      setActionNotice("导入预览阶段不能新增商品；请先发布本次 Excel，再使用单条新增。");
      return false;
    }
    let manualRow: ProductImportRow = { ...nextRow, source: "manual", manuallyEdited: true };
    if (productImportCompleted) {
      try {
        const saved = await createAdminProduct(Number(activityId), productBody);
        manualRow = { ...manualRow, id: String(saved.id), serverVersion: saved.version, sequence: saved.sortNo,
          status: saved.dataStatus === "INCOMPLETE" ? "待完善" : "有效" };
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品新增失败"); return false; }
    }
    setProductRows((current) => [...current, manualRow]);
    if (!productImportCompleted && productFileName) {
      setProductImportInputCount((current) => current + 1);
    }
    recordOperation(activityStarted ? "活动开始后手动新增商品" : "手动添加商品", manualRow.materialName, `物料代码：${manualRow.materialCode || "—"}；客户类型：${manualRow.customerType}；返利：${manualRow.rebate}；${activityStarted ? `原因：${reason || "—"}。` : ""}`);
    setActionNotice(`${activityStarted ? "已记录并添加" : "已添加"}商品：${manualRow.materialName}`);
    return true;
  };
  const beginWhitelistImport = () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止重新导入白名单 Excel。");
      return;
    }
    setWhitelistImportCompleted(false);
    setWhitelistFileName("");
    setWhitelistSheetCounts([]);
    setWhitelistImportWarnings([]);
    setWhitelistImportError("");
    setWhitelistImportInputCount(0);
    setPendingWhitelistRollbackRows(null);
  };
  const cancelWhitelistImport = () => {
    const hadConfirmedImport = whitelistImportHasRun;
    const rollbackRows = pendingWhitelistRollbackRows ? cloneWhitelistRows(pendingWhitelistRollbackRows) : whitelistRows;
    if (pendingWhitelistRollbackRows) setWhitelistRows(rollbackRows);
    setPendingWhitelistRollbackRows(null);
    setWhitelistFileName("");
    setWhitelistSheetCounts([]);
    setWhitelistImportWarnings([]);
    setWhitelistImportError("");
    setWhitelistImportInputCount(0);
    setWhitelistImportCompleted(hadConfirmedImport);
    setActionNotice("已取消本次白名单替换，当前白名单保持不变。" );
  };
  const confirmWhitelistImport = async () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止确认白名单 Excel 导入。");
      return;
    }
    if ((serverImportBlocking.WHITELIST ?? 0) > 0) {
      setActionNotice(`仍有 ${serverImportBlocking.WHITELIST} 条白名单异常，请先编辑或删除后再发布。`);
      return;
    }
    const taskId = serverImportTasks.WHITELIST;
    if (taskId) {
      try { await confirmImport(Number(activityId), taskId); await waitForImport(Number(activityId), taskId); }
      catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单导入发布失败，请处理异常数据后重试。"); return; }
    }
    setPendingWhitelistRollbackRows(null);
    setWhitelistImportCompleted(true);
    onWhitelistImportCommitted();
    let refreshedAttendance = attendanceRows;
    if (taskId && attendanceRows.length > 0) {
      refreshedAttendance = mapAdminAttendanceRows(await loadAdminAttendees(Number(activityId)));
      setAttendanceRows(refreshedAttendance);
    }
    const linkedAttendance = refreshedAttendance.filter((row) => row.lotteryEligible).length;
    recordOperation("替换白名单 Excel", whitelistFileName || "客户白名单 Excel", `共 ${whitelistImportStats.total} 名；有效 ${whitelistImportStats.valid} 名，待处理 ${whitelistImportStats.pending} 名。`);
    setActionNotice(`白名单已替换：共 ${whitelistImportStats.total} 名，有效 ${whitelistImportStats.valid} 名；当前到场已重新关联 ${linkedAttendance} 名。`);
  };
  const handleWhitelistFile = async (file: File) => {
    if (activityStarted) {
      setWhitelistImportError("活动已开始，禁止重新导入白名单 Excel。");
      setActionNotice("活动已开始，禁止重新导入白名单 Excel。");
      return;
    }
    setWhitelistImportError("");
    try {
      const result = await parseWhitelistWorkbook(file);
      let serverRows: ImportStagingRow[] = [];
      if (Number.isFinite(Number(activityId))) {
        const task = await uploadImport(Number(activityId), "WHITELIST", file);
        setServerImportTasks((current) => ({ ...current, WHITELIST: Number(task.id) }));
        setServerImportBlocking((current) => ({ ...current, WHITELIST: Number(task.errorCount || 0) }));
        serverRows = await loadImportRows(Number(activityId), Number(task.id));
      }
      const prepared = prepareWhitelistImportRows(result.rows);
      setPendingWhitelistRollbackRows(pendingWhitelistRollbackRows ? pendingWhitelistRollbackRows : cloneWhitelistRows(whitelistRows));
      const nextRows = bindWhitelistStaging(prepared.rows, serverRows);
      setWhitelistRows(nextRows);
      setWhitelistFileName(file.name);
      setWhitelistSheetCounts(result.sheetCounts);
      setWhitelistImportInputCount(result.rows.length);
      setWhitelistImportWarnings([...result.warnings, ...prepared.warnings]);
      setWhitelistImportCompleted(false);
      const stats = summarizeWhitelistRows(nextRows);
      setActionNotice(`已解析 ${stats.total} 名白名单客户：有效 ${stats.valid} 名、待处理 ${stats.pending} 名，请检查后确认替换。`);
    } catch (error) {
      setWhitelistFileName(file.name);
      setWhitelistSheetCounts([]);
      setWhitelistImportInputCount(0);
      setWhitelistImportWarnings([]);
      setWhitelistImportError(error instanceof Error ? error.message : "文件解析失败，请检查 Excel 格式。");
      setWhitelistImportCompleted(false);
    }
  };
  const openWhitelistForm = () => {
    if (activityClosed) {
      setActionNotice("活动已截止，白名单数据只读。" );
      return;
    }
    if (!whitelistImportCompleted && (!whitelistFileName || whitelistImportError)) {
      setActionNotice("请先完成一次白名单 Excel 解析，再手动添加客户。" );
      return;
    }
    setEditingWhitelistRow(null);
    setWhitelistFormOpen(true);
  };
  const handleAttendanceFile = async (file: File) => {
    if (activityStarted) {
      onAttendanceImportErrorChange("活动已开始，禁止重新导入现场到场 Excel。" );
      setActionNotice("活动已开始，禁止重新导入现场到场 Excel。" );
      return;
    }
    setAttendanceImportAttemptName(file.name);
    onAttendanceImportErrorChange("");
    try {
      const result = await parseAttendanceWorkbook(file);
      let serverRows: ImportStagingRow[] = [];
      if (Number.isFinite(Number(activityId))) {
        const task = await uploadImport(Number(activityId), "ATTENDANCE", file);
        setServerImportTasks((current) => ({ ...current, ATTENDANCE: Number(task.id) }));
        setServerImportBlocking((current) => ({ ...current, ATTENDANCE: Number(task.errorCount || 0) }));
        serverRows = await loadImportRows(Number(activityId), Number(task.id));
      }
      setPendingAttendanceImport({ ...result, rows: bindAttendanceStaging(result.rows, serverRows), fileName: file.name, inputCount: result.rows.length });
      setActionNotice(`已解析 ${result.rows.length} 名现场到场客户，请检查预览后确认导入。`);
    } catch (error) {
      onAttendanceImportErrorChange(error instanceof Error ? error.message : "文件解析失败，请检查 Excel 内容。" );
      setPendingAttendanceImport(null);
    }
  };
  const cancelAttendanceImport = () => {
    if (!pendingAttendanceImport && !attendanceImportError) return;
    setPendingAttendanceImport(null);
    setAttendanceImportAttemptName("");
    onAttendanceImportErrorChange("");
    setAttendanceFormOpen(false);
    setEditingAttendanceRow(null);
    setActionNotice("已取消本次现场到场名单导入，当前名单保持不变。" );
  };
  const confirmAttendanceImport = async () => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止确认现场到场 Excel 导入。" );
      return;
    }
    if (!pendingAttendanceImport) return;
    if ((serverImportBlocking.ATTENDANCE ?? 0) > 0) {
      setActionNotice(`仍有 ${serverImportBlocking.ATTENDANCE} 条到场名单异常，请先编辑或删除后再发布。`);
      return;
    }
    const taskId = serverImportTasks.ATTENDANCE;
    if (taskId) {
      try { await confirmImport(Number(activityId), taskId); await waitForImport(Number(activityId), taskId); }
      catch (error) { setActionNotice(error instanceof ApiError ? error.message : "现场到场名单发布失败，请处理异常数据后重试。"); return; }
    }
    const imported = pendingAttendanceImport;
    const publishedRows = taskId ? mapAdminAttendanceRows(await loadAdminAttendees(Number(activityId))) : cloneAttendanceRows(imported.rows);
    setAttendanceRows(publishedRows);
    onAttendanceFileNameChange(imported.fileName);
    onAttendanceWarningsChange(imported.warnings);
    onAttendanceSheetCountsChange(imported.sheetCounts);
    onAttendanceImportErrorChange("");
    setPendingAttendanceImport(null);
    setAttendanceImportAttemptName("");
    setAttendanceFormOpen(false);
    setEditingAttendanceRow(null);
    const linkedCount = publishedRows.filter((row) => row.lotteryEligible).length;
    recordOperation("替换现场到场 Excel", imported.fileName, `确认导入 ${publishedRows.length} 名现场到场客户；重新关联当前白名单，${linkedCount} 名具备抽奖资格。`);
    setActionNotice(`现场到场 Excel 导入完成：${publishedRows.length} 名，已关联 ${linkedCount} 名。`);
  };
  const saveWhitelistRow = async (row: WhitelistRow, reason = "") => {
    if (activityClosed) {
      setActionNotice("活动已截止，白名单数据只读。" );
      return;
    }
    const nextRow = { ...row, identityKey: whitelistIdentityKey(row) };
    const customerBody = {
      customerType: nextRow.customerType === "综合客户" ? "GENERAL" : "SPECIAL",
      regionCode: regionCodesByName[nextRow.region] || nextRow.region || null, branchName: nextRow.branch,
      dealerShortName: nextRow.dealerShort, dealerFullName: nextRow.dealerFull, dealerCategory: nextRow.dealerType,
      contactName: nextRow.dealerName, phone: nextRow.dealerPhone, confirmerName: nextRow.confirmerName,
      confirmerPhone: nextRow.confirmerPhone,
      expectedVersion: editingWhitelistRow?.serverVersion ?? 0, reason,
    };
    if (editingWhitelistRow) {
      if (!whitelistImportCompleted && editingWhitelistRow.serverRowId && serverImportTasks.WHITELIST) {
        try {
          await updateImportRow(Number(activityId), serverImportTasks.WHITELIST, editingWhitelistRow.serverRowId, {
            customerType: nextRow.customerType === "综合客户" ? "GENERAL" : "SPECIAL", regionName: nextRow.region,
            branchName: nextRow.branch, dealerShortName: nextRow.dealerShort, dealerFullName: nextRow.dealerFull,
            dealerCategory: nextRow.dealerType, contactName: nextRow.dealerName, dealerPhone: nextRow.dealerPhone,
            confirmerName: nextRow.confirmerName, confirmerPhone: nextRow.confirmerPhone,
          });
        } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单预览修改失败"); return; }
      }
      let savedRow = { ...nextRow, manuallyEdited: true };
      if (whitelistImportCompleted && editingWhitelistRow.serverVersion !== undefined) {
        try {
          const saved = await updateAdminCustomer(Number(activityId), Number(editingWhitelistRow.id), customerBody);
          savedRow = { ...savedRow, id: String(saved.id), serverVersion: saved.lockVersion, dealerPhone: saved.phone || saved.phoneMasked,
            confirmerPhone: saved.confirmerPhone || saved.confirmerPhoneMasked || nextRow.confirmerPhone, status: saved.active ? "有效" : "待处理" };
        } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单保存失败"); return; }
      }
      setWhitelistRows((current) => current.map((item) => item.id === nextRow.id ? savedRow : item));
      if (!whitelistImportCompleted) await refreshServerImportPreview("WHITELIST");
      if (activityStarted) recordOperation("活动开始后改单条白名单", nextRow.dealerShort || nextRow.dealerFull, `修改前：客户类型 ${editingWhitelistRow.customerType}、全称 ${editingWhitelistRow.dealerFull || "—"}、姓名 ${editingWhitelistRow.dealerName || "—"}、电话 ${editingWhitelistRow.dealerPhone || "—"}、分公司 ${editingWhitelistRow.branch || "—"}、状态 ${editingWhitelistRow.status}；修改后：客户类型 ${nextRow.customerType}、全称 ${nextRow.dealerFull || "—"}、姓名 ${nextRow.dealerName || "—"}、电话 ${nextRow.dealerPhone || "—"}、分公司 ${nextRow.branch || "—"}、状态 ${nextRow.status}；原因：${reason || "—"}。`);
      setActionNotice(`${activityStarted ? "已记录并保存" : "已保存"}白名单修改：${nextRow.dealerShort}`);
      return;
    }
    if (!whitelistImportCompleted && whitelistFileName) {
      setActionNotice("导入预览阶段不能新增白名单客户；请先发布本次 Excel，再使用单条新增。");
      return;
    }
    let manualRow: WhitelistRow = { ...nextRow, source: "manual", status: "有效", manuallyEdited: true };
    if (whitelistImportCompleted) {
      try {
        const saved = await createAdminCustomer(Number(activityId), customerBody);
        manualRow = { ...manualRow, id: String(saved.id), serverVersion: saved.lockVersion, sequence: saved.excelSequence ?? nextRow.sequence,
          dealerPhone: saved.phone || saved.phoneMasked, confirmerPhone: saved.confirmerPhone || saved.confirmerPhoneMasked || nextRow.confirmerPhone,
          status: saved.active ? "有效" : "待处理" };
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单新增失败"); return; }
    }
    setWhitelistRows((current) => [...current, manualRow]);
    if (!whitelistImportCompleted && whitelistFileName) {
      setWhitelistImportInputCount((current) => current + 1);
    }
    recordOperation(activityStarted ? "活动开始后手动新增白名单客户" : "手动添加白名单客户", manualRow.dealerShort || manualRow.dealerFull, `客户类型：${manualRow.customerType}；电话：${manualRow.dealerPhone || "—"}；${activityStarted ? `原因：${reason || "—"}。` : ""}`);
    setActionNotice(`${activityStarted ? "已记录并添加" : "已添加"}白名单客户：${manualRow.dealerShort || manualRow.dealerFull}`);
  };
  const saveAttendanceRow = async (row: AttendanceRow) => {
    if (activityClosed) {
      setActionNotice("活动已截止，现场到场名单只读。" );
      return;
    }
    if (pendingAttendanceImport) {
      if (editingAttendanceRow) {
        if (editingAttendanceRow.serverRowId && serverImportTasks.ATTENDANCE) {
          try {
            await updateImportRow(Number(activityId), serverImportTasks.ATTENDANCE, editingAttendanceRow.serverRowId, {
              participantName: row.dealerName, gender: row.gender, contactPhone: row.contactPhone,
              branchName: row.branch, dealerFullName: row.dealerCompany, participantType: row.participantType,
            });
          } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "到场名单预览修改失败"); return; }
        }
        setPendingAttendanceImport((current) => current ? { ...current, rows: current.rows.map((item) => item.id === row.id ? row : item) } : current);
        await refreshServerImportPreview("ATTENDANCE");
        setActionNotice(`已修改待导入到场客户：${row.dealerCompany || row.dealerName || "未命名客户"}，确认导入后生效。`);
      } else {
        setActionNotice("导入预览阶段不能新增到场客户；请先发布本次 Excel，再使用单条新增。");
      }
      return;
    }
    const attendeeBody = { participantName: row.dealerName, gender: row.gender, participantType: row.participantType,
      dealerName: row.dealerCompany, branchName: row.branch, phone: row.contactPhone };
    if (editingAttendanceRow) {
      let savedRow = row;
      try {
        const saved = await updateAdminAttendee(Number(activityId), Number(editingAttendanceRow.id), attendeeBody);
        savedRow = { ...mapAdminAttendanceRows([saved])[0], sequence: row.sequence, manuallyEdited: true };
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "到场客户保存失败"); return; }
      setAttendanceRows((current) => current.map((item) => item.id === row.id ? savedRow : item));
      if (activityStarted) recordOperation("活动开始后改单条现场到场客户", row.dealerCompany || row.dealerName, `修改现场到场信息；原因由表单记录。`);
      else recordOperation("编辑现场到场客户", row.dealerCompany || row.dealerName, "修改当前现场到场名单信息。" );
      setActionNotice(`${activityStarted ? "已记录并保存" : "已保存"}到场客户修改：${row.dealerCompany || row.dealerName || "未命名客户"}`);
    } else {
      let savedRow = row;
      try {
        const saved = await createAdminAttendee(Number(activityId), attendeeBody);
        savedRow = { ...mapAdminAttendanceRows([saved])[0], sequence: row.sequence, manuallyEdited: true };
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "到场客户新增失败"); return; }
      setAttendanceRows((current) => [...current, savedRow]);
      recordOperation(activityStarted ? "活动开始后手动新增现场到场客户" : "手动添加现场到场客户", row.dealerCompany || row.dealerName, activityStarted ? "活动开始后单条补录现场到场客户。" : "手动添加现场到场客户。" );
      setActionNotice(`已添加到场客户：${row.dealerCompany || row.dealerName || "未命名客户"}`);
    }
  };
  const deleteProductRows = async (ids: string[]) => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止删除商品；如需紧急处理请改单条并记录原因。");
      return;
    }
    if (!productImportCompleted && serverImportTasks.PRODUCT) {
      const targets = productRows.filter((row) => ids.includes(row.id) && row.serverRowId);
      try {
        if (targets.length > 0) await deleteImportRows(Number(activityId), serverImportTasks.PRODUCT, targets.map((row) => row.serverRowId!));
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品预览删除失败"); return; }
    } else if (productImportCompleted) {
      const targets = productRows.filter((row) => ids.includes(row.id) && row.serverVersion !== undefined);
      try {
        for (const row of targets) await deleteAdminProduct(Number(activityId), Number(row.id), row.serverVersion!);
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "商品移除失败"); return; }
    }
    setProductRows((current) => current.filter((row) => !ids.includes(row.id)));
    if (!productImportCompleted) await refreshServerImportPreview("PRODUCT");
    setEditingProductRow((current) => current && ids.includes(current.id) ? null : current);
    recordOperation("删除商品", `${ids.length} 条商品`, "从当前有效商品列表移除；已有订单明细和金额不受影响。" );
    setActionNotice(`${productImportCompleted ? "已删除" : "已从待导入结果移除"} ${ids.length} 条商品，已有订单明细和金额不受影响。`);
  };
  const deleteWhitelistRows = async (ids: string[]) => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止删除白名单客户；如需紧急处理请改单条并记录原因。");
      return;
    }
    if (!whitelistImportCompleted && serverImportTasks.WHITELIST) {
      const targets = whitelistRows.filter((row) => ids.includes(row.id) && row.serverRowId);
      try {
        if (targets.length > 0) await deleteImportRows(Number(activityId), serverImportTasks.WHITELIST, targets.map((row) => row.serverRowId!));
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单预览删除失败"); return; }
    } else if (whitelistImportCompleted) {
      const targets = whitelistRows.filter((row) => ids.includes(row.id) && row.serverVersion !== undefined);
      try {
        for (const row of targets) await deleteAdminCustomer(Number(activityId), Number(row.id), row.serverVersion!);
      } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "白名单删除失败"); return; }
    }
    setWhitelistRows((current) => {
      const nextRows = current.filter((row) => !ids.includes(row.id));
      return nextRows;
    });
    if (!whitelistImportCompleted) await refreshServerImportPreview("WHITELIST");
    setEditingWhitelistRow((current) => current && ids.includes(current.id) ? null : current);
    recordOperation("删除白名单", `${ids.length} 名客户`, "从当前有效白名单移除；已有订单不会被删除。" );
    setActionNotice(`${whitelistImportCompleted ? "已删除" : "已从待导入结果移除"} ${ids.length} 名白名单客户，已有订单不会被删除。`);
  };
  const deleteAttendanceRows = async (ids: string[]) => {
    if (activityStarted) {
      setActionNotice("活动已开始，禁止批量删除现场到场客户；如需调整请编辑单条记录。");
      return;
    }
    if (ids.length === 0) return;
    if (pendingAttendanceImport) {
      if (serverImportTasks.ATTENDANCE) {
        const targets = pendingAttendanceImport.rows.filter((row) => ids.includes(row.id) && row.serverRowId);
        try {
          if (targets.length > 0) await deleteImportRows(Number(activityId), serverImportTasks.ATTENDANCE, targets.map((row) => row.serverRowId!));
        } catch (error) { setActionNotice(error instanceof ApiError ? error.message : "到场名单预览删除失败"); return; }
      }
      setPendingAttendanceImport((current) => current ? { ...current, rows: current.rows.filter((row) => !ids.includes(row.id)) } : current);
      await refreshServerImportPreview("ATTENDANCE");
      setActionNotice(`已从待导入结果移除 ${ids.length} 名到场客户，确认导入后生效。`);
      return;
    }
    try { for (const id of ids) await deleteAdminAttendee(Number(activityId), Number(id)); }
    catch (error) { setActionNotice(error instanceof ApiError ? error.message : "到场客户删除失败"); return; }
    setAttendanceRows((current) => current.filter((row) => !ids.includes(row.id)));
    setEditingAttendanceRow((current) => current && ids.includes(current.id) ? null : current);
    recordOperation("删除现场到场客户", `${ids.length} 名客户`, "从当前现场到场名单移除，并同步从抽奖候选池移除；原 Excel 文件不受影响。" );
    setActionNotice(`已删除 ${ids.length} 名现场到场客户，抽奖候选池已同步更新。`);
  };
  const overviewTotals = overviewDashboard?.totals;
  const submittedCustomers = Number(overviewTotals?.order_count ?? 0);
  const totalActiveCustomers = whitelistRows.filter((row) => row.status === "有效").length;
  const progressRows = ([
    ["综合客户", "GENERAL"], ["特渠专业客户", "SPECIAL"],
  ] as const).map(([label, type]) => {
    const total = whitelistRows.filter((row) => row.status === "有效" && (type === "GENERAL" ? row.customerType === "综合客户" : row.customerType === "特渠专业客户")).length;
    const submitted = Number(overviewByType[type]?.totals.order_count ?? 0);
    return { label, total, submitted, percentage: total > 0 ? Math.min(100, submitted / total * 100) : 0 };
  });
  const adminStats = [
    ["订单总金额", `¥${money(Number(overviewTotals?.total_amount ?? 0))}`, "当前有效已提交订单"],
    ["已提交客户", submittedCustomers.toLocaleString("zh-CN"), totalActiveCustomers > 0 ? `${(submittedCustomers / totalActiveCustomers * 100).toFixed(1)}% 白名单已提交` : "当前提交客户"],
    ["订货总箱数", Number(overviewTotals?.total_quantity ?? 0).toLocaleString("zh-CN"), "当前有效已提交订单"],
    ["订货总吨数", overviewTotals?.total_tons == null ? "—" : Number(overviewTotals.total_tons).toLocaleString("zh-CN", { minimumFractionDigits: 1, maximumFractionDigits: 3 }), overviewTotals?.total_tons == null ? "部分商品缺少吨箱系数" : "当前有效已提交订单"],
  ];
  return (
    <section className="admin-app">
      <aside className="admin-sidebar">
        <div className="admin-logo"><span>金</span><b>订购会管理平台</b></div>
        <nav>{nav.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><i>{item.slice(0, 1)}</i>{item}</button>)}</nav>
        <div className="admin-user"><span>陈</span><p><b>运营管理员</b><small>调味品事业部</small></p></div>
      </aside>
      <main className="admin-main">
        <header><div><span>{activityName}</span><b>{tab}</b></div><div className="admin-actions"><button onClick={() => setOperationLogOpen((value) => !value)}>操作日志{operationLogs.length > 0 ? ` · ${operationLogs.length}` : ""}</button><span className={activityClosed ? "closed" : activityStarted ? "" : "pending"}>{activityStatus === "draft" ? "草稿" : activityStatus === "scheduled" ? "待开始" : activityStatus === "running" ? "进行中" : "已截止"}</span>{activityStarted && <span className="locked">数据已锁定</span>}{operationLogOpen && <div className="operation-log-popover"><div><b>操作日志</b><button type="button" onClick={() => setOperationLogOpen(false)}>×</button></div>{operationLogs.length === 0 ? <p>暂无操作记录</p> : operationLogs.slice(0, 8).map((entry) => <article key={entry.id}><b>{entry.action}</b><span>{entry.target}</span><small>{entry.detail}</small><em>{entry.operator} · {entry.time}</em></article>)}</div>}</div></header>
        {tab === "活动概览" && (
          <>
            <div className="admin-stats">
              {adminStats.map((item) => <article key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small>{item[2]}</small></article>)}
            </div>
            <div className="admin-grid">
              <article className="progress-card"><h2>客户提交进度</h2>{progressRows.map((item) => <div key={item.label}><p><b>{item.label}</b><span>{item.submitted} / {item.total}</span></p><i><em style={{ width: `${item.percentage}%` }} /></i></div>)}</article>
              <article className="activity-card"><h2>活动设置</h2><div className="activity-config-grid"><label><span>活动名称 *</span><input value={activityNameDraft} onChange={(event) => setActivityNameDraft(event.target.value)} placeholder="例如：2026 年中秋订货会" /></label><label><span>活动编号</span><input value={activityId} readOnly aria-label="活动编号，只读" /></label><label><span>订货开始时间</span><input type="datetime-local" value={activityStartDraft} onChange={(event) => setActivityStartDraft(event.target.value)} /></label><label><span>订货截止时间</span><input type="datetime-local" value={activityEndDraft} onChange={(event) => setActivityEndDraft(event.target.value)} /></label><label><span>活动状态</span><select value={activityStatus} onChange={(event) => changeActivityStatus(event.target.value as ActivityStatus)}><option value="draft">草稿</option><option value="scheduled">待开始</option><option value="running">进行中</option><option value="ended">已截止</option></select></label></div><p><span>当前状态</span><b className={activityClosed ? "closed-text" : activityStarted ? "green" : "pending-text"}>{activityStatus === "draft" ? "草稿" : activityStatus === "scheduled" ? "待开始" : activityStatus === "running" ? "进行中" : "已截止"}</b></p><p><span>基础数据</span><b className={activityStarted ? "closed-text" : "green"}>{activityStarted ? "已锁定" : "可导入"}</b></p><p><span>运行规则</span><small>{activityClosed ? "全部数据只读" : activityStarted ? "仅可单条手动调整" : "可批量导入和替换"}</small></p><div className="activity-card-actions"><button className="admin-primary" onClick={saveActivityConfig}>保存活动设置</button><button onClick={() => changeActivityStatus(activityStarted ? "scheduled" : "running")}>{activityStarted ? "恢复为待开始" : "立即开始并锁定导入"}</button></div></article>
            </div>
          </>
        )}
        {tab === "商品导入" && (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>{productImportCompleted ? "当前活动商品" : "活动商品导入"}</h2><p>{productImportCompleted ? "当前数据来自最近一次确认的完整 Excel，可在活动开始前重新替换" : "上传完整商品 Excel，浏览器解析后替换当前商品目录"}</p></div><div className="panel-actions"><button className="secondary-button" disabled={activityClosed || (!productImportCompleted && (!productFileName || Boolean(productImportError)))} onClick={openProductForm}>＋ 手动添加商品</button>{productImportCompleted && <button className="admin-primary" disabled={activityStarted} onClick={beginProductImport}>重新导入 Excel</button>}</div></div>
            {!productImportCompleted && <div className="import-rule-hint"><b>全量替换规则</b><span>{activityStarted ? "活动已开始，商品 Excel 和批量图片导入已锁定；如需紧急处理，只能编辑单条商品并记录操作日志。" : "每次 Excel 与本次 ZIP 构成一套独立批次，不比较上一版本，也不继承上一版本图片。上传只生成预览，点击确认且全部保存成功后，才会整体替换当前商品目录。"}</span></div>}
            {!productImportCompleted && <div className="dual-upload-grid product-import-upload-grid">
              <article className={`file-upload-card ${productFileName && !productImportError ? "ready" : ""}`}>
                <div className="file-card-heading"><span>XL</span><div><b>商品信息 Excel</b><small>统一文件 · 读取 4 个商品 Sheet</small></div><em>{productFileName ? (productImportError ? "解析失败" : "解析完成") : "待上传"}</em></div>
                {productFileName ? <p title={productFileName}>{productFileName}</p> : <p>请选择：调味产品信息表.xlsx</p>}
                <div className="sheet-tags">{productSheetConfig.map((item) => <span key={item.name}>{item.name}</span>)}</div>
                <footer><small>{activityStarted ? "活动已开始，Excel 导入已锁定" : productFileName && !productImportError ? `识别 ${parsedProductCount} 条商品` : "必须包含上述 4 个 Sheet"}</small><div>{productFileName && <button type="button" disabled={activityStarted} onClick={cancelProductImport}>移除</button>}<label className={activityStarted ? "disabled" : ""}><input type="file" accept=".xlsx" disabled={activityStarted} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleProductFile(file); event.currentTarget.value = ""; }} />{productFileName ? "替换文件" : "选择文件"}</label></div></footer>
              </article>
              <ProductImageUploadCard fileName={productImageFileName} stats={productImageStats} assets={resolvedProductImageAssets} error={productImageError} disabled={activityStarted || (!productFileName && !productImportCompleted)} disabledMessage={activityStarted ? "活动已开始，批量图片导入已锁定" : undefined} onFile={handleProductImageFile} onRemove={removeProductImages} />
            </div>}
            {!productImportCompleted && productFileName && <div className="import-result"><div className="import-summary"><span className="success-icon">✓</span><p><b>{productImportError ? "文件解析失败" : "Excel 与图片预览完成 · 等待确认替换"}</b><small>{productImportError ? "请修正文件后重新选择" : `Excel 原始 ${parsedProductCount} 条、已移除 ${removedProductCount} 条、待发布 ${productImportStats.total} 条；有效 ${productImportStats.valid} 条、待完善 ${productImportStats.incomplete} 条、待核对 ${productImportStats.review} 条`}</small></p><strong>{productImportStats.total} 条待发布</strong></div>{productImportError && <div className="warning-box"><b>文件无法导入</b><span>{productImportError}</span></div>}{!productImportError && productImportWarnings.length > 0 && <div className="warning-box"><b>导入前检查提示</b>{productImportWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}{!productImportError && <><div className="sheet-counts">{productSheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>)}</div><div className="product-import-stats">{[["待发布商品", productImportStats.total], ["有效", productImportStats.valid], ["待核对", productImportStats.review], ["待完善", productImportStats.incomplete]].map(([label, count]) => <span key={label as string}><b>{count}</b><small>{label}</small></span>)}</div><ProductImportTable rows={productRows} onEdit={setEditingProductRow} readOnly={activityClosed} allowDelete={!activityStarted} onDelete={deleteProductRows} /><button className="admin-primary wide" disabled={!productImportStats.total || activityStarted || productImportStats.review > 0 || (serverImportBlocking.PRODUCT ?? 0) > 0} onClick={confirmProductImport}>{productImportStats.review > 0 || (serverImportBlocking.PRODUCT ?? 0) > 0 ? `请先处理 ${Math.max(productImportStats.review, serverImportBlocking.PRODUCT ?? 0)} 条待核对商品` : `确认替换当前商品 ${productImportStats.total} 条`}</button></>}</div>}
            {productImportCompleted && <><div className="import-completed-banner"><span className="success-icon">✓</span><p><b>本次商品目录替换完成</b><small>{activityClosed ? "活动已截止，商品数据只读。" : activityStarted ? "活动已开始，Excel 导入已锁定；紧急修改单条商品会记录操作日志。" : "当前商品和图片来自最近一次确认的完整批次；重新导入不会继承本版图片，历史订单仍保留。"}</small></p><div><strong>{productRows.length}</strong><small>商品总数</small></div><div><strong>{productRows.filter((row) => row.status === "有效").length}</strong><small>有效</small></div><div><strong>{productRows.filter((row) => row.status === "待完善").length}</strong><small>待完善</small></div><div><strong>{productRows.filter((row) => row.imageStatus === "未匹配").length}</strong><small>图片未匹配</small></div></div><div className="data-section-title"><div><b>当前活动商品</b><span>{productFileName} · 共 {productRows.length} 条 · {activityClosed ? "活动已截止，只读" : activityStarted ? "活动已锁定，仅可改单条" : "可编辑、单条/批量删除"}</span></div></div><ProductImportTable rows={productRows} onEdit={setEditingProductRow} readOnly={activityClosed} allowDelete={!activityStarted} allowDeleteAll={!activityStarted} onDelete={deleteProductRows} /></>}
          </div>
        )}
        {tab === "白名单" && (
          <div className="admin-panel">
            <div className="panel-title"><div><h2>{whitelistImportCompleted ? "当前客户白名单" : "客户白名单导入"}</h2><p>{whitelistImportCompleted ? "当前数据来自最近一次确认的完整 Excel，可在活动开始前重新替换" : "上传完整白名单 Excel，浏览器解析后替换当前白名单"}</p></div><div className="panel-actions"><button className="secondary-button" disabled={activityClosed || (!whitelistImportCompleted && (!whitelistFileName || Boolean(whitelistImportError)))} onClick={openWhitelistForm}>＋ 手动添加客户</button>{whitelistImportCompleted && <button className="admin-primary" disabled={activityStarted} onClick={beginWhitelistImport}>重新导入 Excel</button>}</div></div>
            {!whitelistImportCompleted && <div className="import-rule-hint"><b>全量替换规则</b><span>{activityStarted ? "活动已开始，白名单 Excel 导入已锁定；如需紧急处理，只能编辑单条客户并记录操作日志。" : "每次白名单 Excel 都是一套独立完整名单，不展示新增、更新或移除差异。上传只生成预览，点击确认且保存成功后才整体替换当前白名单；客户类型由 Sheet 确定，综合和特渠可以存在同一个手机号。"}</span></div>}
            {!whitelistImportCompleted && <div className="single-upload-grid">
              <article className={"file-upload-card " + (whitelistFileName && !whitelistImportError ? "ready" : "")}>
                <div className="file-card-heading"><span>XL</span><div><b>客户白名单 Excel</b><small>统一文件 · 读取 2 个白名单 Sheet</small></div><em>{whitelistFileName ? (whitelistImportError ? "解析失败" : "解析完成") : "待上传"}</em></div>
                {whitelistFileName ? <p title={whitelistFileName}>{whitelistFileName}</p> : <p>请选择：【白名单】26年中秋订货会经销商白名单7.2.xlsx</p>}
                <div className="sheet-tags">{whitelistSheetConfig.map((item) => <span key={item.name}>{item.name}</span>)}</div>
                <footer><small>{activityStarted ? "活动已开始，Excel 导入已锁定" : whitelistFileName && !whitelistImportError ? "识别 " + parsedWhitelistCount + " 名客户" : "必须包含上述 2 个 Sheet"}</small><div>{whitelistFileName && <button type="button" disabled={activityStarted} onClick={cancelWhitelistImport}>移除</button>}<label className={activityStarted ? "disabled" : ""}><input type="file" accept=".xlsx" disabled={activityStarted} onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleWhitelistFile(file); event.currentTarget.value = ""; }} />{whitelistFileName ? "替换文件" : "选择文件"}</label></div></footer>
              </article>
            </div>}
            {!whitelistImportCompleted && whitelistFileName && <div className="import-result"><div className="import-summary"><span className="success-icon">✓</span><p><b>{whitelistImportError ? "文件解析失败" : "Excel 预览完成 · 等待确认替换"}</b><small>{whitelistImportError ? "请修正文件后重新选择" : `Excel 原始 ${parsedWhitelistCount} 名、已移除 ${removedWhitelistCount} 名、待发布 ${whitelistImportStats.total} 名；有效 ${whitelistImportStats.valid} 名、待处理 ${whitelistImportStats.pending} 名`}</small></p><strong>{whitelistImportStats.total} 名待发布</strong></div>{whitelistImportError && <div className="warning-box"><b>文件无法导入</b><span>{whitelistImportError}</span></div>}{!whitelistImportError && whitelistImportWarnings.length > 0 && <div className="warning-box"><b>导入前检查提示</b>{whitelistImportWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}{!whitelistImportError && <><div className="sheet-counts">{whitelistSheetCounts.map((item) => <span key={item.name}>{item.name}<b>{item.count}</b></span>)}</div><div className="product-import-stats">{[["待发布客户", whitelistImportStats.total], ["有效", whitelistImportStats.valid], ["待处理", whitelistImportStats.pending]].map(([label, count]) => <span key={label as string}><b>{count}</b><small>{label}</small></span>)}</div><CustomerWhitelistTable rows={whitelistRows} onEdit={setEditingWhitelistRow} readOnly={activityClosed} allowDelete={!activityStarted} onDelete={deleteWhitelistRows} /><button className="admin-primary wide" disabled={!whitelistImportStats.total || activityStarted || whitelistImportStats.pending > 0 || (serverImportBlocking.WHITELIST ?? 0) > 0} onClick={confirmWhitelistImport}>{whitelistImportStats.pending > 0 || (serverImportBlocking.WHITELIST ?? 0) > 0 ? `请先处理 ${Math.max(whitelistImportStats.pending, serverImportBlocking.WHITELIST ?? 0)} 条待处理白名单` : `确认替换当前白名单 ${whitelistImportStats.total} 名`}</button></>}</div>}
            {whitelistImportCompleted && <><div className="import-completed-banner"><span className="success-icon">✓</span><p><b>本次白名单替换完成</b><small>{activityClosed ? "活动已截止，白名单数据只读。" : activityStarted ? "活动已开始，白名单 Excel 导入已锁定；紧急修改单条客户会记录操作日志。" : "当前白名单来自最近一次确认的完整 Excel；重新导入后以新文件为准，历史订单不会被删除。"}</small></p><div><strong>{whitelistRows.length}</strong><small>客户总数</small></div><div><strong>{whitelistRows.filter((row) => row.status === "有效").length}</strong><small>有效</small></div><div><strong>{whitelistRows.filter((row) => row.status === "待处理").length}</strong><small>待处理</small></div></div><div className="data-section-title"><div><b>当前客户白名单</b><span>{whitelistFileName} · 综合客户和特渠客户共 {whitelistRows.length} 名 · {activityClosed ? "活动已截止，只读" : activityStarted ? "活动已锁定，仅可改单条" : "可编辑、单条/批量删除"}</span></div></div><CustomerWhitelistTable rows={whitelistRows} onEdit={setEditingWhitelistRow} readOnly={activityClosed} allowDelete={!activityStarted} allowDeleteAll={!activityStarted} onDelete={deleteWhitelistRows} /></>}
          </div>
        )}
        {tab === "现场到场" && <AttendancePage rows={pendingAttendanceImport?.rows ?? attendanceRows} fileName={attendanceFileName} warnings={attendanceWarnings} sheetCounts={attendanceSheetCounts} error={attendanceImportError} activityStarted={activityStarted} activityClosed={activityClosed} pendingImport={pendingAttendanceImport} importAttemptName={attendanceImportAttemptName} onFile={handleAttendanceFile} onAdd={() => { setEditingAttendanceRow(null); setAttendanceFormOpen(true); }} onEdit={setEditingAttendanceRow} onDelete={deleteAttendanceRows} onConfirmImport={confirmAttendanceImport} onCancelImport={cancelAttendanceImport} />}
        {tab === "订单管理" && <OrderManagement activityClosed={activityClosed} activityId={Number(activityId)} />}
        {tab === "抽奖规则" && <LotterySettings rounds={lotteryRounds} attendanceRows={attendanceRows} activityId={Number(activityId)} customerCount={whitelistRows.filter((row) => row.status === "有效").length} onChange={onLotteryChange} />}
      </main>
      {(productFormOpen || editingProductRow) && <ProductFormDrawer key={editingProductRow?.id ?? "new-product"} rows={productRows} initialRow={editingProductRow ?? undefined} activityStarted={activityStarted} onClose={() => { setProductFormOpen(false); setEditingProductRow(null); }} onSave={saveProductRow} />}
      {(whitelistFormOpen || editingWhitelistRow) && <WhitelistFormDrawer key={editingWhitelistRow?.id ?? "new-whitelist"} rows={whitelistRows} initialRow={editingWhitelistRow ?? undefined} activityStarted={activityStarted} onClose={() => { setWhitelistFormOpen(false); setEditingWhitelistRow(null); }} onSave={saveWhitelistRow} />}
      {(attendanceFormOpen || editingAttendanceRow) && !activityClosed && <AttendanceFormDrawer key={editingAttendanceRow?.id ?? "new-attendance"} rows={pendingAttendanceImport?.rows ?? attendanceRows} initialRow={editingAttendanceRow ?? undefined} onClose={() => { setAttendanceFormOpen(false); setEditingAttendanceRow(null); }} onSave={saveAttendanceRow} />}
      {actionNotice && <div className="admin-toast" role="status"><span>✓</span>{actionNotice}<button aria-label="关闭提示" onClick={() => setActionNotice("")}>×</button></div>}
    </section>
  );
}

function AdminGateway({ children }: { children: React.ReactNode }) {
  const [admin, setAdmin] = useState<{ username: string; displayName: string; mustChangePassword: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void adminMe().then((value) => setAdmin(value)).catch(() => setAdmin(null)).finally(() => setLoading(false));
  }, []);
  const login = async () => {
    setLoading(true); setError("");
    try { setAdmin(await adminLogin(username, password)); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : "管理后台连接失败"); }
    finally { setLoading(false); }
  };
  const changePassword = async () => {
    setLoading(true); setError("");
    try {
      await changeAdminPassword(password, newPassword);
      setAdmin(await adminMe()); setPassword(""); setNewPassword("");
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "密码修改失败"); }
    finally { setLoading(false); }
  };
  if (loading && !admin) return <section className="admin-shell"><main className="admin-main"><div className="admin-panel"><div className="empty-state">正在连接管理服务…</div></div></main></section>;
  if (!admin || admin.mustChangePassword) return (
    <section className="admin-shell"><main className="admin-main"><div className="admin-panel">
      <div className="panel-title"><div><h2>{admin ? "首次登录修改密码" : "管理后台登录"}</h2><p>{admin ? "修改初始密码后才可以导入数据和修改活动配置" : "请输入运营管理员账号"}</p></div></div>
      <div className="activity-form-grid">
        {!admin && <label><span>用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} /></label>}
        <label><span>{admin ? "当前密码" : "密码"}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {admin && <label><span>新密码（至少 10 位）</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>}
      </div>
      {error && <div className="warning-box"><b>操作失败</b><span>{error}</span></div>}
      <button className="admin-primary" disabled={loading || !password || (Boolean(admin) && newPassword.length < 10)} onClick={() => void (admin ? changePassword() : login())}>{loading ? "正在处理…" : admin ? "修改密码并进入后台" : "登录"}</button>
    </div></main></section>
  );
  return <>{children}</>;
}

type PrototypeProps = {
  initialSurface?: Surface;
  showSurfaceTabs?: boolean;
};

export function Prototype({ initialSurface = "h5", showSurfaceTabs = true }: PrototypeProps = {}) {
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [lotteryRounds, setLotteryRounds] = useState<LotteryRound[]>(initialLotteryRounds);
  const [activityName, setActivityName] = useState("2026年中秋订货会");
  const [activityId, setActivityId] = useState("1");
  const [activityStatus, setActivityStatus] = useState<ActivityStatus>("scheduled");
  const [activityStartAt, setActivityStartAt] = useState("2030-07-28T14:30");
  const [activityEndAt, setActivityEndAt] = useState("2030-07-30T18:30");
  const activityClosed = activityStatus === "ended";
  const [productRows, setProductRows] = useState<ProductImportRow[]>([]);
  const [productImportCompleted, setProductImportCompleted] = useState(false);
  const [productImportHasRun, setProductImportHasRun] = useState(false);
  const [whitelistRows, setWhitelistRows] = useState<WhitelistRow[]>([]);
  const [whitelistImportCompleted, setWhitelistImportCompleted] = useState(false);
  const [whitelistImportHasRun, setWhitelistImportHasRun] = useState(false);
  const [attendanceRows, setAttendanceRows] = useState<AttendanceRow[]>([]);
  const [attendanceFileName, setAttendanceFileName] = useState("");
  const [attendanceWarnings, setAttendanceWarnings] = useState<string[]>([]);
  const [attendanceSheetCounts, setAttendanceSheetCounts] = useState<Array<{ name: string; count: number }>>([]);
  const [attendanceImportError, setAttendanceImportError] = useState("");
  const [runtimeActivity, setRuntimeActivity] = useState<RuntimeActivity | null>(null);
  const [runtimeConnected, setRuntimeConnected] = useState(false);
  const markProductImportCommitted = useCallback(() => setProductImportHasRun(true), []);
  const markWhitelistImportCommitted = useCallback(() => setWhitelistImportHasRun(true), []);
  useEffect(() => {
    void Promise.all([loadActivity(), loadPublicLottery()]).then(([activity, lottery]) => {
      setRuntimeActivity(activity); setRuntimeConnected(true); setActivityName(activity.name); setActivityId(String(activity.id));
      setActivityStartAt(toDateTimeLocal(activity.startsAt)); setActivityEndAt(toDateTimeLocal(activity.endsAt));
      setActivityStatus(activity.status === "ACTIVE" ? "running" : activity.status === "CLOSED" ? "ended" : activity.status === "SCHEDULED" ? "scheduled" : "draft");
      const rule = lottery.rules.find((item) => item.status === "PUBLISHED") ?? lottery.rules[0];
      if (rule) setLotteryRounds(mapLotteryRule(rule));
    }).catch(() => setRuntimeConnected(false));
  }, []);
  const surfaces: { key: Surface; label: string; sub: string }[] = [
    { key: "h5", label: "订货 H5", sub: "手机端" },
    { key: "ranking", label: "订货排行", sub: "大屏 A" },
    { key: "report", label: "专题战报", sub: "大屏 B" },
    { key: "lottery", label: "幸运抽奖", sub: "现场" },
    { key: "admin", label: "管理后台", sub: "运营端" },
  ];
  return (
    <main className={`prototype-root surface-${surface}`}>
      <nav className="prototype-nav">
        <div className="prototype-title"><span>金</span><p><b>{activityName}</b><small>{runtimeConnected ? "业务系统 · 实时数据" : "业务服务连接中"}</small></p></div>
        {showSurfaceTabs && <div className="surface-tabs">{surfaces.map((item) => <button key={item.key} className={surface === item.key ? "active" : ""} onClick={() => setSurface(item.key)}><b>{item.label}</b><small>{item.sub}</small></button>)}</div>}
        <div className="prototype-status"><i /> {runtimeConnected ? "服务已连接" : "服务未连接"}</div>
      </nav>
      <div className="prototype-canvas">
        {showSurfaceTabs ? <>
          <div className={surface === "h5" ? "surface-slot" : "surface-slot surface-hidden"}><H5Prototype activityClosed={activityClosed} importedRows={productImportCompleted ? productRows : null} importedWhitelistRows={whitelistImportCompleted ? whitelistRows : null} runtimeActivity={runtimeActivity} /></div>
          {surface === "ranking" && <RankingBoard activity={runtimeActivity} />}
          {surface === "report" && <ReportBoard activity={runtimeActivity} />}
          {surface === "lottery" && <LotteryBoard rounds={lotteryRounds} attendanceRows={attendanceRows} activityId={Number(activityId)} onComplete={(id) => setLotteryRounds((items) => items.map((item) => item.id === id ? { ...item, status: "completed", serverStatus: "COMPLETED" } : item))} />}
          {surface === "admin" && <AdminGateway><AdminPrototype lotteryRounds={lotteryRounds} onLotteryChange={setLotteryRounds} activityName={activityName} onActivityNameChange={setActivityName} activityId={runtimeActivity ? String(runtimeActivity.id) : activityId} activityStatus={activityStatus} onActivityStatusChange={setActivityStatus} activityStartAt={activityStartAt} onActivityStartAtChange={setActivityStartAt} activityEndAt={activityEndAt} onActivityEndAtChange={setActivityEndAt} productRows={productRows} onProductRowsChange={setProductRows} productImportCompleted={productImportCompleted} onProductImportCompleted={setProductImportCompleted} onProductImportCommitted={markProductImportCommitted} productImportHasRun={productImportHasRun} whitelistRows={whitelistRows} onWhitelistRowsChange={setWhitelistRows} whitelistImportCompleted={whitelistImportCompleted} onWhitelistImportCompleted={setWhitelistImportCompleted} onWhitelistImportCommitted={markWhitelistImportCommitted} whitelistImportHasRun={whitelistImportHasRun} attendanceRows={attendanceRows} onAttendanceRowsChange={setAttendanceRows} attendanceFileName={attendanceFileName} onAttendanceFileNameChange={setAttendanceFileName} attendanceWarnings={attendanceWarnings} onAttendanceWarningsChange={setAttendanceWarnings} attendanceSheetCounts={attendanceSheetCounts} onAttendanceSheetCountsChange={setAttendanceSheetCounts} attendanceImportError={attendanceImportError} onAttendanceImportErrorChange={setAttendanceImportError} /></AdminGateway>}
        </> : <>
          {surface === "h5" && <H5Prototype activityClosed={activityClosed} importedRows={productImportCompleted ? productRows : null} importedWhitelistRows={whitelistImportCompleted ? whitelistRows : null} runtimeActivity={runtimeActivity} />}
          {surface === "ranking" && <RankingBoard activity={runtimeActivity} />}
          {surface === "report" && <ReportBoard activity={runtimeActivity} />}
          {surface === "lottery" && <LotteryBoard rounds={lotteryRounds} attendanceRows={attendanceRows} activityId={Number(activityId)} onComplete={(id) => setLotteryRounds((items) => items.map((item) => item.id === id ? { ...item, status: "completed", serverStatus: "COMPLETED" } : item))} />}
          {surface === "admin" && <AdminGateway><AdminPrototype lotteryRounds={lotteryRounds} onLotteryChange={setLotteryRounds} activityName={activityName} onActivityNameChange={setActivityName} activityId={runtimeActivity ? String(runtimeActivity.id) : activityId} activityStatus={activityStatus} onActivityStatusChange={setActivityStatus} activityStartAt={activityStartAt} onActivityStartAtChange={setActivityStartAt} activityEndAt={activityEndAt} onActivityEndAtChange={setActivityEndAt} productRows={productRows} onProductRowsChange={setProductRows} productImportCompleted={productImportCompleted} onProductImportCompleted={setProductImportCompleted} onProductImportCommitted={markProductImportCommitted} productImportHasRun={productImportHasRun} whitelistRows={whitelistRows} onWhitelistRowsChange={setWhitelistRows} whitelistImportCompleted={whitelistImportCompleted} onWhitelistImportCompleted={setWhitelistImportCompleted} onWhitelistImportCommitted={markWhitelistImportCommitted} whitelistImportHasRun={whitelistImportHasRun} attendanceRows={attendanceRows} onAttendanceRowsChange={setAttendanceRows} attendanceFileName={attendanceFileName} onAttendanceFileNameChange={setAttendanceFileName} attendanceWarnings={attendanceWarnings} onAttendanceWarningsChange={setAttendanceWarnings} attendanceSheetCounts={attendanceSheetCounts} onAttendanceSheetCountsChange={setAttendanceSheetCounts} attendanceImportError={attendanceImportError} onAttendanceImportErrorChange={setAttendanceImportError} /></AdminGateway>}
        </>}
      </div>
    </main>
  );
}
