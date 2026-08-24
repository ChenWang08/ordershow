import readXlsxFile from "read-excel-file";
import type { ImportStagingRow } from "../api";

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

function normalizeMaterialCode(value: string) {
  return normalizeSearchText(value).replace(/[-_]/g, "");
}

function textCell(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function normalizedHeader(value: unknown) {
  return textCell(value).replace(/\s+/g, "");
}

function attendanceCompanyKey(value: string) {
  return normalizeSearchText(value).replace(/[()（）\[\]【】{}：:，,。·\-_/\\]/g, "");
}

const productSheetConfig = [
  { name: "综合参与返利" },
  { name: "综合不参与返利" },
  { name: "特渠参与返利" },
  { name: "特渠不参与返利" },
];

const whitelistSheetConfig = [
  { name: "综合客户白名单" },
  { name: "特渠客户白名单" },
];

export type ProductImportRow = {
  id: string;
  serverVersion?: number;
  sequence: number;
  customerType: "特渠" | "综合";
  rebate: "参与" | "不参与";
  category: string;
  line: string;
  materialCode: string;
  materialName: string;
  brand: string;
  variety: string;
  spec: string;
  casePack: string;
  unitPrice: string;
  casePrice: string;
  conversion: string;
  gift: "是" | "否";
  branchScope: string;
  status: "有效" | "待完善";
  manuallyEdited?: boolean;
  source?: "excel" | "manual";
  sourceSheet?: string;
  sourceRowNumber?: number;
  serverRowId?: number;
  images?: ProductImageAsset[];
  imageStatus?: ProductImageStatus;
  importAction?: ProductImportAction;
};

export type ProductImportAction = "新增" | "更新" | "未变更" | "疑似重复" | "待确认";

export type ProductImportStats = {
  added: number;
  updated: number;
  unchanged: number;
  suspected: number;
  pending: number;
  removed: number;
};

export const emptyProductImportStats: ProductImportStats = { added: 0, updated: 0, unchanged: 0, suspected: 0, pending: 0, removed: 0 };

export type ProductImageStatus = "未上传" | "已匹配" | "待确认" | "未匹配" | "手动维护";

export type ProductImageSource = "zip" | "manual";

export type ProductImageAsset = {
  id: string;
  fileName: string;
  url: string;
  normalizedName: string;
  source?: ProductImageSource;
};

export type ProductImageStats = {
  totalImages: number;
  matchedProducts: number;
  pendingProducts: number;
  unmatchedProducts: number;
};

export type WhitelistRow = {
  id: string;
  serverVersion?: number;
  sequence: number;
  customerType: "综合客户" | "特渠专业客户";
  region: string;
  branch: string;
  dealerShort: string;
  dealerFull: string;
  dealerType: string;
  dealerName: string;
  dealerPhone: string;
  confirmerName: string;
  confirmerPhone: string;
  status: "有效" | "待处理";
  identityKey?: string;
  source?: "excel" | "manual";
  sourceSheet?: string;
  sourceRowNumber?: number;
  serverRowId?: number;
  manuallyEdited?: boolean;
  importAction?: WhitelistImportAction;
};

export type WhitelistImportAction = "新增" | "电话已更新" | "信息已更新" | "未变更" | "名称重复" | "电话待处理" | "名称待处理";

export type WhitelistImportStats = {
  added: number;
  phoneUpdated: number;
  updated: number;
  unchanged: number;
  duplicateName: number;
  pendingPhone: number;
  pendingName: number;
  removed: number;
};

export const emptyWhitelistImportStats: WhitelistImportStats = { added: 0, phoneUpdated: 0, updated: 0, unchanged: 0, duplicateName: 0, pendingPhone: 0, pendingName: 0, removed: 0 };

export type AttendanceRow = {
  id: string;
  activityCustomerId?: number | null;
  sequence: number;
  dealerName: string;
  gender: string;
  contactPhone: string;
  branch: string;
  dealerCompany: string;
  participantType: string;
  sourceRowNumber?: number;
  serverRowId?: number;
  customerType: AttendanceCustomerType | "";
  sourceSheet?: string;
  manuallyEdited?: boolean;
  matchStatus?: "MATCHED" | "PENDING_CONFIRMATION" | "UNMATCHED";
  matchMethod?: "PHONE" | "FULL_NAME" | "SHORT_NAME" | "MANUAL";
  matchReasonCode?: string;
  matchedDealerName?: string;
  lotteryEligible?: boolean;
};

export type AttendanceCustomerType = "综合客户" | "特渠专业客户";

export function stagingRowKey(sheet?: string, row?: number) { return `${sheet || ""}:${row || 0}`; }

export function bindProductStaging(rows: ProductImportRow[], staging: ImportStagingRow[]) {
  const bySource = new Map(staging.map((row) => [stagingRowKey(row.sheetName, row.sourceRowNumber), row]));
  return rows.map((row) => {
    const server = bySource.get(stagingRowKey(row.sourceSheet, row.sourceRowNumber));
    if (!server) return row;
    const importAction: ProductImportAction = server.diffType === "POSSIBLE_DUPLICATE" ? "疑似重复"
      : server.diffType === "PENDING_CONFIRMATION" ? "待确认"
      : server.diffType === "UPDATED" ? "更新" : server.diffType === "UNCHANGED" ? "未变更" : "新增";
    return { ...row, serverRowId: server.id, importAction };
  }).filter((row) => !bySource.get(stagingRowKey(row.sourceSheet, row.sourceRowNumber))?.deleted);
}

export function bindWhitelistStaging(rows: WhitelistRow[], staging: ImportStagingRow[]) {
  const bySource = new Map(staging.map((row) => [stagingRowKey(row.sheetName, row.sourceRowNumber), row]));
  return rows.map((row) => {
    const server = bySource.get(stagingRowKey(row.sourceSheet, row.sourceRowNumber));
    if (!server) return row;
    let importAction: WhitelistImportAction = "新增";
    if (server.diffType === "PENDING_CONFIRMATION") importAction = "名称重复";
    else if (server.validationStatus === "BLOCKED") importAction = row.dealerFull.trim() ? "电话待处理" : "名称待处理";
    return { ...row, serverRowId: server.id, importAction, status: server.validationStatus === "BLOCKED" ? "待处理" as const : row.status };
  }).filter((row) => !bySource.get(stagingRowKey(row.sourceSheet, row.sourceRowNumber))?.deleted);
}

export function bindAttendanceStaging(rows: AttendanceRow[], staging: ImportStagingRow[]) {
  const bySource = new Map(staging.map((row) => [stagingRowKey(row.sheetName, row.sourceRowNumber), row]));
  return rows.map((row) => ({ ...row, serverRowId: bySource.get(stagingRowKey(row.sourceSheet, row.sourceRowNumber))?.id }))
    .filter((row) => !bySource.get(stagingRowKey(row.sourceSheet, row.sourceRowNumber))?.deleted);
}

export function normalizeWhitelistName(value: string) {
  return normalizeSearchText(value).replace(/[\s\-_/\\()[\]【】{}：:，,。·]/g, "");
}

export function whitelistIdentityKey(row: WhitelistRow) {
  const name = normalizeWhitelistName(row.dealerFull);
  return name ? `${row.customerType}:${name}` : "";
}

export function whitelistPhoneIsValid(value: string) {
  return /^1\d{10}$/.test(normalizePhone(value));
}

export function whitelistProfileEqual(a: WhitelistRow, b: WhitelistRow) {
  const fields: Array<keyof WhitelistRow> = ["customerType", "region", "branch", "dealerShort", "dealerFull", "dealerType", "dealerName", "confirmerName", "confirmerPhone"];
  return fields.every((field) => String(a[field] ?? "").trim() === String(b[field] ?? "").trim());
}

export function whitelistRowsEqual(a: WhitelistRow, b: WhitelistRow) {
  return whitelistProfileEqual(a, b) && normalizePhone(a.dealerPhone) === normalizePhone(b.dealerPhone) && a.status === b.status;
}

export function cloneWhitelistRows(rows: WhitelistRow[]) {
  return rows.map((row) => ({ ...row }));
}

export function replaceWhitelistImportRows(existingRows: WhitelistRow[], incomingRows: WhitelistRow[]) {
  const rows: WhitelistRow[] = [];
  const stats: WhitelistImportStats = { ...emptyWhitelistImportStats };
  const warnings: string[] = [];
  const usedExistingIds = new Set<string>();
  const incomingNameCounts = new Map<string, number>();
  incomingRows.forEach((row) => {
    const key = whitelistIdentityKey(row);
    if (key) incomingNameCounts.set(key, (incomingNameCounts.get(key) ?? 0) + 1);
  });

  incomingRows.forEach((incomingRow) => {
    const identityKey = whitelistIdentityKey(incomingRow);
    const incomingPhoneValid = whitelistPhoneIsValid(incomingRow.dealerPhone);
    const incomingPhonePending = !incomingPhoneValid || incomingRow.status !== "有效";
    const nameIsMissing = !identityKey;
    const nameIsDuplicated = Boolean(identityKey && (incomingNameCounts.get(identityKey) ?? 0) > 1);

    if (nameIsMissing || nameIsDuplicated) {
      rows.push({ ...incomingRow, source: "excel", status: "待处理", identityKey: identityKey || undefined, importAction: nameIsMissing ? "名称待处理" : "名称重复" });
      stats.added += 1;
      if (nameIsMissing) stats.pendingName += 1;
      else stats.duplicateName += 1;
      if (incomingPhonePending) stats.pendingPhone += 1;
      return;
    }

    const candidates = existingRows.filter((row) => !usedExistingIds.has(row.id) && whitelistIdentityKey(row) === identityKey);
    if (candidates.length > 1) {
      rows.push({ ...incomingRow, source: "excel", status: "待处理", identityKey, importAction: "名称重复" });
      stats.added += 1;
      stats.duplicateName += 1;
      if (incomingPhonePending) stats.pendingPhone += 1;
      return;
    }

    if (candidates.length === 1) {
      const current = candidates[0];
      usedExistingIds.add(current.id);
      const nextStatus: WhitelistRow["status"] = incomingPhonePending ? "待处理" : "有效";
      const nextRow: WhitelistRow = {
        ...incomingRow,
        id: current.id,
        source: "excel",
        sourceSheet: incomingRow.sourceSheet,
        identityKey,
        status: nextStatus,
        importAction: undefined,
        manuallyEdited: undefined,
      };
      if (incomingPhonePending) {
        nextRow.importAction = "电话待处理";
        stats.pendingPhone += 1;
      } else if (normalizePhone(current.dealerPhone) !== normalizePhone(incomingRow.dealerPhone)) {
        nextRow.importAction = "电话已更新";
        stats.phoneUpdated += 1;
      } else if (whitelistRowsEqual(current, nextRow)) {
        nextRow.importAction = "未变更";
        stats.unchanged += 1;
      } else {
        nextRow.importAction = "信息已更新";
        stats.updated += 1;
      }
      rows.push(nextRow);
      return;
    }

    const nextRow: WhitelistRow = { ...incomingRow, source: "excel", identityKey, status: incomingPhonePending ? "待处理" : "有效", importAction: incomingPhonePending ? "电话待处理" : "新增" };
    rows.push(nextRow);
    stats.added += 1;
    if (incomingPhonePending) stats.pendingPhone += 1;
  });

  stats.removed = existingRows.filter((row) => !usedExistingIds.has(row.id)).length;

  if (stats.duplicateName > 0) warnings.push(`有 ${stats.duplicateName} 条白名单客户在同一客户类型下名称全称重复，已标记为“名称重复”。`);
  if (stats.pendingName > 0) warnings.push(`有 ${stats.pendingName} 条白名单客户缺少经销商名称全称，已标记为“名称待处理”。`);
  if (stats.pendingPhone > 0) warnings.push(`有 ${stats.pendingPhone} 条白名单客户电话为空、格式异常或存在重复，已标记为“电话待处理”。`);
  if (stats.removed > 0) warnings.push(`本次 Excel 未包含上次的 ${stats.removed} 名客户，确认后将从当前有效白名单中移除；已有订单不会被删除。`);
  return { rows, stats, warnings };
}

export function clearWhitelistImportAction(row: WhitelistRow) {
  const cleanRow = { ...row };
  delete cleanRow.importAction;
  return cleanRow;
}

export type AttendanceFieldKey = "dealerName" | "gender" | "contactPhone" | "branch" | "participantType" | "dealerCompany";

export type AttendanceImportParseResult = {
  rows: AttendanceRow[];
  warnings: string[];
  sheetCounts: Array<{ name: string; count: number }>;
};

export type AttendanceImportDraft = AttendanceImportParseResult & { fileName: string };

let localImportRowId = 0;
export const createImportRowId = (prefix: string) => {
  localImportRowId += 1;
  return `${prefix}-${localImportRowId}`;
};

export function normalizeProductIdentityText(value: string) {
  return normalizeSearchText(value).replace(/[\s\-_/\\()[\]【】{}：:，,。·×xX*]/g, "");
}

export function productChannelKey(row: ProductImportRow) {
  return `${row.customerType}|${row.rebate}`;
}

export function productCodeKey(row: ProductImportRow) {
  const code = normalizeMaterialCode(row.materialCode);
  return code ? `${productChannelKey(row)}|${code}` : "";
}

export function productNoCodeKey(row: ProductImportRow) {
  return `${productChannelKey(row)}|${normalizeProductIdentityText(row.materialName)}|${normalizeProductIdentityText(row.spec)}|${normalizeProductIdentityText(row.casePack)}`;
}

export function productNameKey(row: ProductImportRow) {
  return `${productChannelKey(row)}|${normalizeProductIdentityText(row.materialName)}`;
}

export function productRowsEqual(a: ProductImportRow, b: ProductImportRow) {
  const fields: Array<keyof ProductImportRow> = ["customerType", "rebate", "category", "line", "materialCode", "materialName", "brand", "variety", "spec", "casePack", "unitPrice", "casePrice", "conversion", "gift", "branchScope", "status"];
  return fields.every((field) => String(a[field] ?? "").trim() === String(b[field] ?? "").trim());
}

export function replaceProductImportRows(existingRows: ProductImportRow[], incomingRows: ProductImportRow[]) {
  const rows: ProductImportRow[] = [];
  const stats: ProductImportStats = { ...emptyProductImportStats };
  const warnings: string[] = [];
  const usedExistingIds = new Set<string>();

  incomingRows.forEach((incomingRow) => {
    const code = productCodeKey(incomingRow);
    const legacyKey = productNoCodeKey(incomingRow);
    const incomingKeyRows = incomingRows.filter((row) => code ? productCodeKey(row) === code : !row.materialCode.trim() && productNoCodeKey(row) === legacyKey);
    let candidates = existingRows.filter((row) => !usedExistingIds.has(row.id) && (code ? productCodeKey(row) === code : !row.materialCode.trim() && productNoCodeKey(row) === legacyKey));

    // 首次没有物料代码、后续补上物料代码时，允许唯一的无代码旧记录被识别为同一商品。
    if (candidates.length === 0 && code) {
      candidates = existingRows.filter((row) => !usedExistingIds.has(row.id) && !row.materialCode.trim() && productNoCodeKey(row) === legacyKey);
    }

    if (incomingKeyRows.length > 1 || candidates.length > 1) {
      stats.pending += 1;
      rows.push({ ...incomingRow, source: "excel", importAction: "待确认" });
      return;
    }

    if (candidates.length === 1) {
      const current = candidates[0];
      usedExistingIds.add(current.id);
      const manualImages = current.images?.filter((image) => image.source === "manual") ?? [];
      const same = productRowsEqual(current, incomingRow);
      rows.push({
        ...incomingRow,
        id: current.id,
        source: "excel",
        images: manualImages.length > 0 ? manualImages : incomingRow.images,
        imageStatus: manualImages.length > 0 ? "手动维护" : incomingRow.imageStatus,
        manuallyEdited: undefined,
        importAction: same ? "未变更" : "更新",
      });
      if (same) stats.unchanged += 1;
      else stats.updated += 1;
      return;
    }

    const sameNameExists = rows.some((row) => productNameKey(row) === productNameKey(incomingRow));
    const importAction: ProductImportAction = sameNameExists ? "疑似重复" : "新增";
    rows.push({ ...incomingRow, source: "excel", importAction });
    if (importAction === "疑似重复") stats.suspected += 1;
    else stats.added += 1;
  });

  stats.removed = existingRows.filter((row) => !usedExistingIds.has(row.id)).length;

  if (stats.suspected > 0) warnings.push(`有 ${stats.suspected} 条商品名称相同但未能按物料代码唯一匹配，已标记为“疑似重复”，请确认后再导入。`);
  if (stats.pending > 0) warnings.push(`有 ${stats.pending} 条商品存在多个候选匹配，已标记为“待确认”，请编辑或删除异常行。`);
  if (stats.removed > 0) warnings.push(`本次 Excel 未包含上次的 ${stats.removed} 条商品，确认后将从当前有效商品中移除；已有订单不会被删除。`);
  return { rows, stats, warnings };
}

export function clearProductImportAction(row: ProductImportRow) {
  const cleanRow = { ...row };
  delete cleanRow.importAction;
  return cleanRow;
}

export function cloneProductRows(rows: ProductImportRow[]) {
  return rows.map((row) => ({ ...row, images: row.images ? [...row.images] : undefined }));
}

export const attendanceFieldConfig: Array<{ key: AttendanceFieldKey; label: string; aliases: string[] }> = [
  { key: "branch", label: "分公司", aliases: ["分公司", "分公司名称", "所属分公司"] },
  { key: "dealerName", label: "参会人姓名", aliases: ["参会人姓名", "经销商姓名", "联系人姓名", "客户姓名", "姓名"] },
  { key: "gender", label: "性别", aliases: ["性别"] },
  { key: "contactPhone", label: "参会人电话", aliases: ["参会人电话", "联系电话", "经销商电话", "手机号", "手机号码", "电话"] },
  { key: "participantType", label: "参会人员类型", aliases: ["参会人员类型", "客户类型", "客户类别", "订货通道", "渠道类型"] },
  { key: "dealerCompany", label: "经销商名称", aliases: ["经销商名称", "经销商名称（全）", "经销商全称", "客户名称", "单位名称"] },
];

export function attendanceCustomerType(participantType: string): AttendanceCustomerType | "" {
  const normalized = normalizeSearchText(participantType);
  if (normalized.includes("特渠")) return "特渠专业客户";
  if (normalized.includes("综合")) return "综合客户";
  return "";
}

export function attendancePhoneIsValid(value: string) {
  return /^1\d{10}$/.test(normalizePhone(value));
}

export function findAttendanceFieldIndex(header: string[], aliases: string[]) {
  const normalized = header.map(normalizedHeader);
  const normalizedAliases = aliases.map(normalizedHeader);
  const exactIndex = normalized.findIndex((value) => normalizedAliases.includes(value));
  if (exactIndex >= 0) return exactIndex;
  return normalized.findIndex((value) => normalizedAliases.some((alias) => value.includes(alias)));
}

export async function parseAttendanceWorkbook(file: File): Promise<AttendanceImportParseResult> {
  const sheetNames = await readSheetNames(file);
  const rows: AttendanceRow[] = [];
  const warnings: string[] = [];
  const sheetCounts: Array<{ name: string; count: number }> = [];
  for (const sheetName of sheetNames) {
    const matrix = await readXlsxFile(file, { sheet: sheetName });
    const headerIndex = matrix.findIndex((values) => values.filter((value) => textCell(value) !== "").length >= 2);
    if (headerIndex < 0) {
      warnings.push(`${sheetName} 没有识别到表头，已跳过。`);
      continue;
    }
    const header = (matrix[headerIndex] ?? []).map((value) => textCell(value));
    const indexes = Object.fromEntries(attendanceFieldConfig.map((field) => [field.key, findAttendanceFieldIndex(header, field.aliases)])) as Record<AttendanceFieldKey, number>;
    const missingFields = attendanceFieldConfig.filter((field) => indexes[field.key] < 0).map((field) => field.label);
    if (missingFields.length > 0) throw new Error(`${sheetName} 缺少必需字段：${missingFields.join("、")}。请按“现场参会名单.xlsx”模板整理后重新导入。`);
    let sheetCount = 0;
    for (let index = headerIndex + 1; index < matrix.length; index += 1) {
      const values = matrix[index] ?? [];
      if (values.every((value) => textCell(value) === "")) continue;
      const get = (field: AttendanceFieldKey) => indexes[field] >= 0 ? textCell(values[indexes[field]]) : "";
      const participantType = get("participantType");
      const contactPhone = get("contactPhone");
      const dealerCompany = get("dealerCompany");
      if (!contactPhone) warnings.push(`${sheetName} 第 ${index + 1} 行未填写参会人电话，该行不会进入现场抽奖候选池。`);
      else if (!attendancePhoneIsValid(contactPhone)) warnings.push(`${sheetName} 第 ${index + 1} 行参会人电话格式异常：${contactPhone}，发布时将改用经销商全称或简称尝试关联。`);
      if (!dealerCompany) warnings.push(`${sheetName} 第 ${index + 1} 行未填写经销商名称，该行不会进入现场抽奖候选池。`);
      if (participantType && !attendanceCustomerType(participantType)) warnings.push(`${sheetName} 第 ${index + 1} 行参会人员类型“${participantType}”未识别客户类型，请人工确认。`);
      rows.push({
        id: createImportRowId("attendance"),
        sequence: rows.length + 1,
        dealerName: get("dealerName"),
        gender: get("gender"),
        contactPhone,
        branch: get("branch"),
        dealerCompany,
        participantType,
        customerType: attendanceCustomerType(participantType),
        sourceSheet: sheetName,
        sourceRowNumber: index + 1,
      });
      sheetCount += 1;
    }
    sheetCounts.push({ name: sheetName, count: sheetCount });
  }
  if (rows.length === 0) throw new Error("Excel 中没有找到可展示的数据行，请检查文件内容。" );
  const duplicatePhones = Array.from(new Set(rows.map((row) => normalizePhone(row.contactPhone)).filter(Boolean).filter((phone, index, phones) => phones.indexOf(phone) !== index)));
  if (duplicatePhones.length > 0) warnings.push(`发现 ${duplicatePhones.length} 个重复参会人电话，请确认是否应保留多条记录；抽奖候选将按经销商名称去重。`);
  const duplicateCompanies = rows.map((row) => attendanceCompanyKey(row.dealerCompany)).filter(Boolean).filter((key, index, keys) => keys.indexOf(key) !== index);
  if (duplicateCompanies.length > 0) warnings.push(`发现 ${new Set(duplicateCompanies).size} 个重复经销商名称；抽奖候选将按经销商名称合并为一家。`);
  return { rows, warnings, sheetCounts };
}


export type DeleteTarget = {
  ids: string[];
  labels: string[];
  kind: "商品" | "白名单客户" | "现场到场客户";
  label?: string;
  description?: string;
  summary?: string;
};

export const productSheetOrder = new Map(productSheetConfig.map((item, index) => [item.name, index]));
export const whitelistSheetOrder = new Map(whitelistSheetConfig.map((item, index) => [item.name, index]));

export function compareProductRows(a: ProductImportRow, b: ProductImportRow) {
  return (productSheetOrder.get(a.sourceSheet ?? "") ?? 99) - (productSheetOrder.get(b.sourceSheet ?? "") ?? 99)
    || a.sequence - b.sequence
    || a.customerType.localeCompare(b.customerType, "zh-CN")
    || a.rebate.localeCompare(b.rebate, "zh-CN")
    || a.id.localeCompare(b.id);
}

export function compareWhitelistRows(a: WhitelistRow, b: WhitelistRow) {
  return (whitelistSheetOrder.get(a.sourceSheet ?? "") ?? 99) - (whitelistSheetOrder.get(b.sourceSheet ?? "") ?? 99)
    || a.sequence - b.sequence
    || a.id.localeCompare(b.id);
}
