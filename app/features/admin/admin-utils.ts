import readXlsxFile, { readSheetNames } from "read-excel-file";
import { apiAssetUrl, type ImportStagingRow, type ProductImageReview, type RuntimeProduct } from "../../api";
import { attendanceCustomerType, createImportRowId, normalizeWhitelistName, productMaterialCodeKey, type AttendanceRow, type ProductImageAsset, type ProductImportRow, type WhitelistRow } from "../../domain/import-domain";
import { normalizeProductImageName, productImageBaseName } from "../../domain/product-images";
import { normalizePhone, normalizeSearchText } from "../shared/utils";

export function normalizeMaterialCode(value: string) {
  return normalizeSearchText(value).replace(/[-_]/g, "");
}

export function runtimeProductToImportRow(product: RuntimeProduct): ProductImportRow {
  const selectedImage = [...product.images].sort((a, b) => Number(b.primary) - Number(a.primary) || a.sortNo - b.sortNo)[0];
  return {
    id: String(product.id), serverVersion: product.version, sequence: product.sortNo,
    customerType: product.customerType === "GENERAL" ? "综合" : "特渠",
    rebate: product.rebateStatus === "PARTICIPATING" ? "参与" : "不参与",
    category: product.categoryName || "", line: product.productLine || "", materialCode: product.materialCode || "",
    materialName: product.materialName, brand: product.brandName || "", variety: product.varietyName || "",
    spec: product.specification || "", casePack: product.casePack || "",
    unitPrice: product.bottlePrice == null ? "" : String(product.bottlePrice),
    casePrice: product.casePrice == null ? "" : String(product.casePrice),
    priceTierMinQuantity: product.priceTier == null ? "" : String(product.priceTier.minQuantity),
    priceTierCasePrice: product.priceTier == null ? "" : String(product.priceTier.casePrice),
    priceTierPricingMode: product.priceTier?.pricingMode ?? "WHOLE_ORDER",
    conversion: product.tonCaseFactor == null ? "" : String(product.tonCaseFactor),
    gift: product.giftBox ? "是" : "否", branchScope: (product.branchScope ?? []).join("，"),
    status: product.dataStatus === "INCOMPLETE" ? "待完善" : "有效", source: "excel",
    imageStatus: product.images.length ? "已匹配" : "未匹配",
    images: selectedImage ? [{
      id: String(selectedImage.id), fileName: product.materialName, url: apiAssetUrl(selectedImage.url),
      normalizedName: normalizeProductImageName(product.materialName), relationStatus: "CONFIRMED",
      matchStatus: "已匹配", source: selectedImage.sourceType === "MANUAL" ? "manual" : "zip",
    }] : undefined,
  };
}

export function stagingData(row: ImportStagingRow) {
  return { ...row.normalizedData, ...row.editedData };
}

export function restoredSheetCounts(rows: ImportStagingRow[]) {
  const counts = new Map<string, number>();
  rows.filter((row) => !row.deleted).forEach((row) => counts.set(row.sheetName, (counts.get(row.sheetName) ?? 0) + 1));
  return [...counts].map(([name, count]) => ({ name, count }));
}

export function restoreProductPreview(rows: ImportStagingRow[]): ProductImportRow[] {
  return rows.filter((row) => !row.deleted).map((row, index) => {
    const data = stagingData(row);
    return {
      id: createImportRowId("product-preview"), sequence: index + 1,
      customerType: data.customerType === "SPECIAL" ? "特渠" : "综合",
      rebate: data.rebateStatus === "NOT_PARTICIPATING" ? "不参与" : "参与",
      category: String(data.categoryName ?? ""), line: String(data.productLine ?? ""),
      materialCode: String(data.materialCode ?? ""), materialName: String(data.materialName ?? ""),
      brand: String(data.brandName ?? ""), variety: String(data.varietyName ?? ""),
      spec: String(data.specification ?? ""), casePack: String(data.casePack ?? ""),
      unitPrice: String(data.bottlePrice ?? ""), casePrice: String(data.casePrice ?? ""),
      priceTierMinQuantity: String(data.priceTierMinQuantity ?? ""), priceTierCasePrice: String(data.priceTierCasePrice ?? ""),
      priceTierPricingMode: data.priceTierPricingMode === "INCREMENTAL" ? "INCREMENTAL" : "WHOLE_ORDER",
      conversion: String(data.tonCaseFactor ?? ""), gift: data.giftBox ? "是" : "否",
      branchScope: String(data.branchScope ?? ""),
      status: row.validationStatus === "BLOCKED" ? "待核对" : row.validationStatus === "WARNING" ? "待完善" : "有效",
      source: "excel", sourceSheet: row.sheetName, sourceRowNumber: row.sourceRowNumber, serverRowId: row.id,
      imageStatus: "未匹配",
    };
  });
}

export function restoreWhitelistPreview(rows: ImportStagingRow[]): WhitelistRow[] {
  return rows.filter((row) => !row.deleted).map((row, index) => {
    const data = stagingData(row);
    return {
      id: createImportRowId("whitelist-preview"), sequence: Number(data.sequence ?? index + 1),
      customerType: data.customerType === "SPECIAL" ? "特渠专业客户" : "综合客户",
      region: String(data.regionName ?? ""), branch: String(data.branchName ?? ""),
      dealerShort: String(data.dealerShortName ?? ""), dealerFull: String(data.dealerFullName ?? ""),
      dealerType: String(data.dealerCategory ?? ""), dealerName: String(data.contactName ?? ""),
      dealerPhone: String(data.phoneMasked ?? ""), confirmerName: String(data.confirmerName ?? ""),
      confirmerPhone: String(data.confirmerPhoneMasked ?? ""),
      status: row.validationStatus === "BLOCKED" ? "待处理" : "有效",
      source: "excel", sourceSheet: row.sheetName, sourceRowNumber: row.sourceRowNumber, serverRowId: row.id,
    };
  });
}

export function restoreAttendancePreview(rows: ImportStagingRow[]): AttendanceRow[] {
  return rows.filter((row) => !row.deleted).map((row, index) => {
    const data = stagingData(row);
    const participantType = String(data.participantType ?? "");
    return {
      id: createImportRowId("attendance-preview"), sequence: index + 1,
      dealerName: String(data.participantName ?? ""), gender: String(data.gender ?? ""),
      contactPhone: String(data.phoneMasked ?? ""), branch: String(data.branchName ?? ""),
      dealerCompany: String(data.dealerFullName ?? ""), participantType,
      customerType: attendanceCustomerType(participantType), sourceSheet: row.sheetName,
      sourceRowNumber: row.sourceRowNumber, serverRowId: row.id,
    };
  });
}

export function mergeProductImageReviews(rows: ProductImportRow[], reviews: ProductImageReview[]): ProductImportRow[] {
  const reviewsByCode = new Map<string, ProductImageReview[]>();
  reviews.forEach((review) => {
    const code = productMaterialCodeKey(review.materialCode);
    if (code) reviewsByCode.set(code, [...(reviewsByCode.get(code) ?? []), review]);
  });
  return rows.map((row) => {
    if (row.images?.length) return row;
    const candidates = reviewsByCode.get(productMaterialCodeKey(row.materialCode)) ?? [];
    if (!candidates.length) return row;
    const images: ProductImageAsset[] = candidates.map((candidate) => ({
      id: `review-${candidate.id}`, reviewCandidateId: candidate.id, fileName: productImageBaseName(candidate.archivePath),
      archivePath: candidate.archivePath, url: apiAssetUrl(candidate.url), normalizedName: normalizeProductImageName(candidate.materialName),
      matchStatus: "待确认", relationStatus: "CANDIDATE", source: "zip",
    }));
    return { ...row, images, imageStatus: "待确认" };
  });
}

export const productSheetConfig = [
  { name: "综合参与返利", customerType: "综合" as const, rebate: "参与" as const },
  { name: "综合不参与返利", customerType: "综合" as const, rebate: "不参与" as const },
  { name: "特渠参与返利", customerType: "特渠" as const, rebate: "参与" as const },
  { name: "特渠不参与返利", customerType: "特渠" as const, rebate: "不参与" as const },
];

export const whitelistSheetConfig = [
  { name: "综合客户白名单", customerType: "综合客户" as const },
  { name: "特渠客户白名单", customerType: "特渠专业客户" as const },
];

type ProductImportParseResult = {
  rows: ProductImportRow[];
  warnings: string[];
  sheetCounts: Array<{ name: string; count: number }>;
};

export function textCell(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

export async function parseProductWorkbook(file: File): Promise<ProductImportParseResult> {
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
        priceTierMinQuantity: "",
        priceTierCasePrice: "",
        priceTierPricingMode: "WHOLE_ORDER",
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

export function normalizedHeader(value: unknown) {
  return textCell(value).replace(/\s+/g, "");
}

export function findHeaderIndex(header: string[], aliases: readonly string[]) {
  const normalized = header.map(normalizedHeader);
  return aliases.map(normalizedHeader).map((alias) => normalized.findIndex((item) => item === alias || item.includes(alias))).find((index) => index >= 0) ?? -1;
}

export async function parseWhitelistWorkbook(file: File): Promise<WhitelistImportParseResult> {
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
