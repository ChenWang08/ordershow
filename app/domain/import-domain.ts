import readXlsxFile, { readSheetNames } from "read-excel-file";
import type { ImportStagingRow } from "../api";

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeSearchText(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
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
  status: "有效" | "待核对" | "待完善";
  manuallyEdited?: boolean;
  source?: "excel" | "manual";
  sourceSheet?: string;
  sourceRowNumber?: number;
  serverRowId?: number;
  images?: ProductImageAsset[];
  imageStatus?: ProductImageStatus;
};

export type ProductImportStats = {
  total: number;
  valid: number;
  review: number;
  incomplete: number;
};

export const emptyProductImportStats: ProductImportStats = { total: 0, valid: 0, review: 0, incomplete: 0 };

export type ProductImageStatus = "已匹配" | "待确认" | "未匹配";

export type ProductImageSource = "zip" | "manual";

export type ProductImageRelationStatus = "CONFIRMED" | "CANDIDATE";

export function productMaterialCodeKey(value: string) {
  return value.trim().replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

export type ProductImageAsset = {
  id: string;
  fileName: string;
  file?: File;
  archivePath?: string;
  url: string;
  normalizedName: string;
  matchingNames?: string[];
  matchStatus?: "已匹配" | "待确认" | "未匹配";
  /** 当前商品行与该图片之间的关系；ZIP 图片不能依赖共享资源的全局匹配状态。 */
  relationStatus?: ProductImageRelationStatus;
  reviewCandidateId?: number;
  source?: ProductImageSource;
};

export type ProductImageStats = {
  totalProducts: number;
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
};

export type WhitelistImportStats = {
  total: number;
  valid: number;
  pending: number;
};

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
    const status: ProductImportRow["status"] = server.validationStatus === "BLOCKED" ? "待核对"
      : server.validationStatus === "WARNING" ? "待完善" : "有效";
    return { ...row, serverRowId: server.id, status };
  }).filter((row) => !bySource.get(stagingRowKey(row.sourceSheet, row.sourceRowNumber))?.deleted);
}

export function bindWhitelistStaging(rows: WhitelistRow[], staging: ImportStagingRow[]) {
  const bySource = new Map(staging.map((row) => [stagingRowKey(row.sheetName, row.sourceRowNumber), row]));
  return rows.map((row) => {
    const server = bySource.get(stagingRowKey(row.sourceSheet, row.sourceRowNumber));
    if (!server) return row;
    const edited = server.editedData ?? {};
    const customerType = edited.customerType === "GENERAL" ? "综合客户" : edited.customerType === "SPECIAL" ? "特渠专业客户" : row.customerType;
    return { ...row, serverRowId: server.id, customerType,
      region: String(edited.regionName ?? row.region), branch: String(edited.branchName ?? row.branch),
      dealerShort: String(edited.dealerShortName ?? row.dealerShort), dealerFull: String(edited.dealerFullName ?? row.dealerFull),
      dealerType: String(edited.dealerCategory ?? row.dealerType), dealerName: String(edited.contactName ?? row.dealerName),
      confirmerName: String(edited.confirmerName ?? row.confirmerName),
      status: server.validationStatus === "BLOCKED" ? "待处理" as const : "有效" as const };
  }).filter((row) => !bySource.get(stagingRowKey(row.sourceSheet, row.sourceRowNumber))?.deleted);
}

export function bindAttendanceStaging(rows: AttendanceRow[], staging: ImportStagingRow[]) {
  const bySource = new Map(staging.map((row) => [stagingRowKey(row.sheetName, row.sourceRowNumber), row]));
  return rows.map((row) => {
    const server = bySource.get(stagingRowKey(row.sourceSheet, row.sourceRowNumber));
    if (!server) return row;
    const edited = server.editedData ?? {};
    const participantType = String(edited.participantType ?? row.participantType);
    return { ...row, serverRowId: server.id, participantType, customerType: attendanceCustomerType(participantType),
      dealerName: String(edited.participantName ?? row.dealerName), gender: String(edited.gender ?? row.gender),
      branch: String(edited.branchName ?? row.branch), dealerCompany: String(edited.dealerFullName ?? row.dealerCompany) };
  }).filter((row) => !bySource.get(stagingRowKey(row.sourceSheet, row.sourceRowNumber))?.deleted);
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

export function cloneWhitelistRows(rows: WhitelistRow[]) {
  return rows.map((row) => ({ ...row }));
}

export function summarizeWhitelistRows(rows: WhitelistRow[]): WhitelistImportStats {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.status === "有效").length,
    pending: rows.filter((row) => row.status === "待处理").length,
  };
}

export function prepareWhitelistImportRows(incomingRows: WhitelistRow[]) {
  const warnings: string[] = [];
  const incomingNameCounts = new Map<string, number>();
  const incomingPhoneCounts = new Map<string, number>();
  incomingRows.forEach((row) => {
    const key = whitelistIdentityKey(row);
    if (key) incomingNameCounts.set(key, (incomingNameCounts.get(key) ?? 0) + 1);
    const phone = normalizePhone(row.dealerPhone);
    if (phone) {
      const phoneKey = `${row.customerType}:${phone}`;
      incomingPhoneCounts.set(phoneKey, (incomingPhoneCounts.get(phoneKey) ?? 0) + 1);
    }
  });
  let missingNames = 0;
  let duplicateNames = 0;
  let invalidPhones = 0;
  let duplicatePhones = 0;
  const rows = incomingRows.map((row) => {
    const identityKey = whitelistIdentityKey(row);
    const phone = normalizePhone(row.dealerPhone);
    const phoneKey = `${row.customerType}:${phone}`;
    const missingName = !identityKey;
    const duplicateName = Boolean(identityKey && (incomingNameCounts.get(identityKey) ?? 0) > 1);
    const invalidPhone = !whitelistPhoneIsValid(phone);
    const duplicatePhone = Boolean(phone && (incomingPhoneCounts.get(phoneKey) ?? 0) > 1);
    if (missingName) missingNames += 1;
    if (duplicateName) duplicateNames += 1;
    if (invalidPhone) invalidPhones += 1;
    if (duplicatePhone) duplicatePhones += 1;
    return { ...row, source: "excel" as const, identityKey: identityKey || undefined,
      status: missingName || duplicateName || invalidPhone || duplicatePhone ? "待处理" as const : "有效" as const };
  });
  if (missingNames > 0) warnings.push(`有 ${missingNames} 条白名单缺少经销商名称全称，已标记为待处理。`);
  if (duplicateNames > 0) warnings.push(`有 ${duplicateNames} 条白名单在同一客户类型下名称全称重复，已标记为待处理。`);
  if (invalidPhones > 0) warnings.push(`有 ${invalidPhones} 条白名单手机号为空或格式异常，已标记为待处理。`);
  if (duplicatePhones > 0) warnings.push(`有 ${duplicatePhones} 条白名单在同一客户类型下手机号重复，已标记为待处理。`);
  return { rows, stats: summarizeWhitelistRows(rows), warnings };
}

export type AttendanceFieldKey = "dealerName" | "gender" | "contactPhone" | "branch" | "participantType" | "dealerCompany";

export type AttendanceImportParseResult = {
  rows: AttendanceRow[];
  warnings: string[];
  sheetCounts: Array<{ name: string; count: number }>;
};

export type AttendanceImportDraft = AttendanceImportParseResult & { fileName: string; inputCount: number };

let localImportRowId = 0;
export const createImportRowId = (prefix: string) => {
  localImportRowId += 1;
  return `${prefix}-${localImportRowId}`;
};

export function summarizeProductImportRows(rows: ProductImportRow[]): ProductImportStats {
  return {
    total: rows.length,
    valid: rows.filter((row) => row.status === "有效").length,
    review: rows.filter((row) => row.status === "待核对").length,
    incomplete: rows.filter((row) => row.status === "待完善").length,
  };
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
  if (duplicatePhones.length > 0) warnings.push(`发现 ${duplicatePhones.length} 个重复参会人电话，请确认是否应保留多条记录；成功关联同一白名单客户 ID 后只计算一次抽奖资格。`);
  const duplicateCompanies = rows.map((row) => attendanceCompanyKey(row.dealerCompany)).filter(Boolean).filter((key, index, keys) => keys.indexOf(key) !== index);
  if (duplicateCompanies.length > 0) warnings.push(`发现 ${new Set(duplicateCompanies).size} 个重复经销商名称；成功关联后抽奖候选按白名单客户 ID 去重。`);
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
