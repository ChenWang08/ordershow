import { productCompletenessStatus } from "../../domain/product-completeness";
import readXlsxFile, { readSheetNames } from "read-excel-file";
import { apiAssetUrl, type ImportStagingRow, type ProductImageReview, type RuntimeProduct } from "../../api";
import { attendanceCustomerType, createImportRowId, productImportDuplicateRowIds, productMaterialCodeKey, productMaterialNameKey, whitelistCustomerTypeLabel, type AttendanceRow, type ProductImageAsset, type ProductImportRow, type WhitelistRow } from "../../domain/import-domain";
import { normalizeProductImageName, productImageBaseName } from "../../domain/product-images";
import { normalizePhone } from "../shared/utils";

export function normalizeMaterialCode(value: string) {
  return productMaterialCodeKey(value);
}

export function runtimeProductToImportRow(product: RuntimeProduct): ProductImportRow {
  const selectedImages = [...product.images].sort((a, b) => Number(b.primary) - Number(a.primary) || a.sortNo - b.sortNo || a.id - b.id);
  return {
    id: String(product.id), serverVersion: product.version, sequence: product.sortNo, dealerScope: product.dealerScope ?? [], effectiveDealerCount: product.effectiveDealerCount, dealerScopeRestricted: product.dealerScopeRestricted,
    customerType: product.customerType === "GENERAL" ? "综合" : product.customerType === "SPECIAL" ? "特渠" : "",
    rebate: product.rebateStatus === "PARTICIPATING" ? "参与" : product.rebateStatus === "NOT_PARTICIPATING" ? "不参与" : "",
    category: product.categoryName || "", line: product.productLine || "", materialCode: product.materialCode || "",
    materialName: product.materialName, description: product.description || "", brand: product.brandName || "", variety: product.varietyName || "",
    spec: product.specification || "", casePack: product.casePack || "",
    unitPrice: product.bottlePrice == null ? "" : String(product.bottlePrice),
    casePrice: product.casePrice == null ? "" : String(product.casePrice),
    priceTierMinQuantity: product.priceTier == null ? "" : String(product.priceTier.minQuantity),
    priceTierCasePrice: product.priceTier == null ? "" : String(product.priceTier.casePrice),
    priceTierPricingMode: product.priceTier?.pricingMode ?? "WHOLE_ORDER",
    conversion: product.tonCaseFactor == null ? "" : String(product.tonCaseFactor),
    gift: product.giftBox ? "是" : "否", branchScope: (product.branchScope ?? []).join("，"),
    status: product.dataStatus === "INCOMPLETE" ? "待完善" : "有效", source: "excel",
    imageStatus: selectedImages.length ? "已匹配" : "未匹配",
    images: selectedImages.length ? selectedImages.map((image) => ({
      id: String(image.id), fileName: product.materialName, url: apiAssetUrl(image.url),
      normalizedName: normalizeProductImageName(product.materialName), relationStatus: "CONFIRMED" as const,
      matchStatus: "已匹配" as const, source: image.sourceType === "MANUAL" ? "manual" as const : "zip" as const,
    })) : undefined,
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
      customerType: data.customerType === "SPECIAL" ? "特渠" : data.customerType === "GENERAL" ? "综合" : "",
      rebate: data.rebateStatus === "NOT_PARTICIPATING" ? "不参与" : data.rebateStatus === "PARTICIPATING" ? "参与" : "",
      category: String(data.categoryName ?? ""), line: String(data.productLine ?? ""),
      materialCode: String(data.materialCode ?? ""), materialName: String(data.materialName ?? ""), description: String(data.description ?? ""),
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
      customerType: whitelistCustomerTypeLabel(String(data.customerType ?? "")),
      customerTypeInvalid: Boolean(data.customerTypeInvalid),
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
  const reviewsByName = new Map<string, ProductImageReview[]>();
  reviews.forEach((review) => {
    const name = productMaterialNameKey(review.materialName);
    if (name) reviewsByName.set(name, [...(reviewsByName.get(name) ?? []), review]);
  });
  return rows.map((row) => {
    if (row.images?.length) return row;
    const candidates = reviewsByName.get(productMaterialNameKey(row.materialName)) ?? [];
    if (!candidates.length) return row;
    const images: ProductImageAsset[] = candidates.map((candidate) => ({
      id: `review-${candidate.id}`, reviewCandidateId: candidate.id, fileName: productImageBaseName(candidate.archivePath),
      archivePath: candidate.archivePath, url: apiAssetUrl(candidate.url), normalizedName: normalizeProductImageName(candidate.materialName),
      matchStatus: "待确认", relationStatus: "CANDIDATE", source: "zip",
    }));
    return { ...row, images, imageStatus: "待确认" };
  });
}

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
  const sheets = await Promise.all(sheetNames.map(async (name) => ({ name, matrix: await readXlsxFile(file, { sheet: name }) })));
  const nonEmptySheets = sheets.filter(({ matrix }) => matrix.some((values) => values.some((value) => textCell(value) !== "")));
  if (nonEmptySheets.length === 0) throw new Error("Excel 中没有找到商品信息 Sheet。");
  if (nonEmptySheets.length > 1) throw new Error(`商品 Excel 只允许一个非空 Sheet，当前发现：${nonEmptySheets.map(({ name }) => name).join("、")}`);
  const { name: sheetName, matrix } = nonEmptySheets[0];
  const headerIndex = matrix.findIndex((values) => values.some((value) => normalizedHeader(value) === "物料名称"));
  if (headerIndex < 0) throw new Error(`${sheetName} 未找到“物料名称”表头。`);
  const expectedHeaders = ["客户类型", "是否返利", "产品大类", "项目组", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否为标品礼盒", "分公司定制品", "产品说明"];
  const header = (matrix[headerIndex] ?? []).map(textCell);
  const aliases = (field: string) => field === "分公司定制品" ? ["分公司限制", "分公司定制品"] : field === "项目组" ? ["项目组", "产品线"] : [field];
  const missingHeaders = expectedHeaders.filter((field) => findHeaderIndex(header, aliases(field)) < 0);
  if (missingHeaders.length > 0) throw new Error(`${sheetName} 缺少字段：${missingHeaders.join("、")}`);
  const indexes = Object.fromEntries(expectedHeaders.map((field) => [field, findHeaderIndex(header, aliases(field))]));
  const parsed: ProductImportRow[] = [];
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const values = matrix[index] ?? [];
    if (values.every((value) => textCell(value) === "")) continue;
    const get = (field: string) => textCell(values[indexes[field]]);
    const customerTypeRaw = get("客户类型");
    const rebateRaw = get("是否返利");
    const customerType = customerTypeRaw === "综合" || customerTypeRaw === "特渠" ? customerTypeRaw : "";
    const rebate = rebateRaw === "是" ? "参与" : rebateRaw === "否" ? "不参与" : "";
    if (customerTypeRaw && !customerType) warnings.push(`${sheetName} 第 ${index + 1} 行客户类型“${customerTypeRaw}”无效，只允许“综合”“特渠”或空。`);
    if (rebateRaw && !rebate) warnings.push(`${sheetName} 第 ${index + 1} 行是否返利“${rebateRaw}”无效，只允许“是”“否”或空。`);
    parsed.push({
      id: createImportRowId("product"), sequence: parsed.length + 1, customerType, rebate,
      category: get("产品大类"), line: get("项目组"), materialCode: get("物料代码"), materialName: get("物料名称"),
      description: get("产品说明"), brand: get("品牌"), variety: get("品种"), spec: get("规格"), casePack: get("箱规"),
      unitPrice: get("元/瓶"), casePrice: get("元/箱"), priceTierMinQuantity: "", priceTierCasePrice: "", priceTierPricingMode: "WHOLE_ORDER",
      conversion: get("吨箱转换系数"), gift: get("是否为标品礼盒") === "是" ? "是" : "否", branchScope: get("分公司定制品"),
      source: "excel", sourceSheet: sheetName, sourceRowNumber: index + 1, status: "有效",
    });
  }
  if (parsed.length === 0) throw new Error("Excel 中没有找到可展示的商品数据行，请检查文件内容。");
  const invalidRows = parsed.filter((row) => {
    const customerTypeRaw = textCell(matrix[(row.sourceRowNumber ?? 1) - 1]?.[indexes["客户类型"]]);
    const rebateRaw = textCell(matrix[(row.sourceRowNumber ?? 1) - 1]?.[indexes["是否返利"]]);
    return !row.materialName.trim() || (customerTypeRaw !== "" && !row.customerType) || (rebateRaw !== "" && !row.rebate);
  });
  const invalidRowIds = new Set(invalidRows.map((row) => row.id));
  const duplicateRowIds = productImportDuplicateRowIds(parsed.filter((row) => !invalidRowIds.has(row.id)));
  const duplicateRows = parsed.filter((row) => duplicateRowIds.has(row.id));
  parsed.forEach((row) => {
    row.status = invalidRowIds.has(row.id) || duplicateRowIds.has(row.id) ? "待核对"
      : productCompletenessStatus(row.casePrice, row.conversion);
  });
  if (duplicateRows.length > 0) warnings.push(`${sheetName} 有 ${duplicateRows.length} 条商品在同一客户类型、同一返利类型下名称与物料代码冲突，已标记为待核对；任一物料代码为空时按名称判重。`);
  const missingNames = parsed.filter((row) => !row.materialName.trim()).length;
  if (missingNames > 0) warnings.push(`${sheetName} 有 ${missingNames} 条商品缺少物料名称，已标记为待核对。`);
  if (parsed.some((row) => row.status === "待完善")) warnings.push(`${sheetName} 有商品的元/箱或吨箱转换系数为空或无效，已标记为待完善。`);
  return { rows: parsed, warnings, sheetCounts: [{ name: sheetName, count: parsed.length }] };
}

type WhitelistImportParseResult = {
  rows: WhitelistRow[];
  warnings: string[];
  sheetCounts: Array<{ name: string; count: number }>;
  crossSheetPhoneCount: number;
  customerTypeMode: "TYPED" | "UNSPECIFIED";
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
  const sheets = await Promise.all(sheetNames.map(async (name) => ({ name, matrix: await readXlsxFile(file, { sheet: name }) })));
  const nonEmptySheets = sheets.filter(({ matrix }) => matrix.some((values) => values.some((value) => textCell(value) !== "")));
  if (nonEmptySheets.length === 0) throw new Error("白名单 Excel 中没有找到非空 Sheet。");
  if (nonEmptySheets.length > 1) throw new Error(`白名单 Excel 只允许一个非空 Sheet，当前发现：${nonEmptySheets.map(({ name }) => name).join("、")}`);
  const { name: sheetName, matrix } = nonEmptySheets[0];

  const requiredColumns = [
    ["客户类型", ["客户类型", "客户类型（综合客户/特渠专业客户）"]],
    ["大区", ["大区"]],
    ["分公司名称", ["分公司名称", "分公司"]],
    ["经销商名称（简）", ["经销商名称（简）", "经销商简称"]],
    ["经销商名称（全）", ["经销商名称（全）", "经销商全称"]],
    ["经销商姓名", ["经销商姓名"]],
    ["经销商电话", ["经销商电话"]],
  ] as const;
  const optionalColumns = [
    ["序号", ["序号"]], ["经销商类型", ["经销商类型", "综合经销商特渠专业经销商"]],
    ["分公司确认人姓名", ["分公司确认人姓名"]], ["分公司确认人电话", ["分公司确认人电话"]],
  ] as const;
  const headerIndex = matrix.findIndex((row) => {
    const header = row.map(textCell);
    return findHeaderIndex(header, ["客户类型"]) >= 0 && findHeaderIndex(header, ["经销商电话"]) >= 0;
  });
  if (headerIndex < 0) throw new Error(`${sheetName} 未找到包含“客户类型”和“经销商电话”的表头行。`);
  const header = (matrix[headerIndex] ?? []).map(textCell);
  const indexes = Object.fromEntries([...requiredColumns, ...optionalColumns].map(([label, aliases]) => [label, findHeaderIndex(header, aliases)]));
  const missingHeaders = requiredColumns.filter(([label]) => indexes[label] < 0).map(([label]) => label);
  if (missingHeaders.length > 0) throw new Error(`${sheetName} 缺少字段：${missingHeaders.join("、")}`);
  if (indexes["客户类型"] !== 0) throw new Error(`${sheetName} 的“客户类型”必须是第一列`);
  const get = (values: unknown[], label: string) => indexes[label] >= 0 ? textCell(values[indexes[label]]) : "";
  const sourceRows = matrix.slice(headerIndex + 1).filter((values) => values.some((value) => textCell(value) !== ""));
  if (sourceRows.length === 0) throw new Error(`${sheetName} 中没有找到白名单数据行。`);
  const rawTypes = sourceRows.map((values) => get(values, "客户类型"));
  const hasTypedRows = rawTypes.some(Boolean);
  const hasUnspecifiedRows = rawTypes.some((value) => !value);
  if (hasTypedRows && hasUnspecifiedRows) throw new Error(`${sheetName} 的客户类型不能部分填写、部分为空；请保证整张表全部填写或全部留空。`);
  const customerTypeMode: WhitelistImportParseResult["customerTypeMode"] = hasTypedRows ? "TYPED" : "UNSPECIFIED";
  if (customerTypeMode === "UNSPECIFIED" && sourceRows.some((values) => get(values, "大区") !== "")) {
    throw new Error(`${sheetName} 的客户类型全部为空时，大区也必须全部为空。`);
  }
  let invalidCustomerTypeCount = 0;
  let invalidPhoneCount = 0;
  sourceRows.forEach((values, offset) => {
    const rawType = get(values, "客户类型").replace(/\s+/g, "");
    const customerType: WhitelistRow["customerType"] = rawType === "" ? ""
      : rawType.includes("特渠") ? "特渠专业客户" : rawType.includes("综合") ? "综合客户" : "";
    const customerTypeInvalid = Boolean(rawType && !customerType);
    const dealerPhone = normalizePhone(get(values, "经销商电话"));
    const phoneInvalid = !/^1\d{10}$/.test(dealerPhone);
    if (customerTypeInvalid) invalidCustomerTypeCount += 1;
    if (phoneInvalid) invalidPhoneCount += 1;
    rows.push({
      id: createImportRowId("whitelist"), sequence: Number(get(values, "序号")) || rows.length + 1,
      customerType, customerTypeInvalid, region: get(values, "大区"), branch: get(values, "分公司名称"),
      dealerShort: get(values, "经销商名称（简）"), dealerFull: get(values, "经销商名称（全）"),
      dealerType: get(values, "经销商类型"), dealerName: get(values, "经销商姓名"), dealerPhone,
      confirmerName: get(values, "分公司确认人姓名"), confirmerPhone: normalizePhone(get(values, "分公司确认人电话")),
      status: customerTypeInvalid || phoneInvalid ? "待处理" : "有效", source: "excel", sourceSheet: sheetName,
      sourceRowNumber: headerIndex + offset + 2,
    });
  });
  if (invalidCustomerTypeCount > 0) warnings.push(`${sheetName} 有 ${invalidCustomerTypeCount} 条客户类型无效，只允许“综合客户”“特渠专业客户”或空。`);
  if (invalidPhoneCount > 0) warnings.push(`${sheetName} 有 ${invalidPhoneCount} 条手机号为空或格式异常，已标记为待处理。`);
  sheetCounts.push({ name: sheetName, count: sourceRows.length });
  return { rows, warnings, sheetCounts, crossSheetPhoneCount: 0, customerTypeMode };
}
