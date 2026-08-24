export const ACTIVITY_CODE = process.env.NEXT_PUBLIC_ACTIVITY_CODE || "2026-mid-autumn";

let activeActivityCode = ACTIVITY_CODE;
const activeActivityListeners = new Set<() => void>();

/** Set by routed pages before their client data loading begins. */
export function setActiveActivityCode(activityCode: string) {
  const normalized = activityCode.trim();
  if (!normalized || normalized === activeActivityCode) return;
  activeActivityCode = normalized;
  activeActivityListeners.forEach((listener) => listener());
}

export function getActiveActivityCode() {
  return activeActivityCode;
}

/** Subscribe to activity changes for components that must wait before loading data. */
export function subscribeActiveActivityCode(listener: () => void) {
  activeActivityListeners.add(listener);
  return () => activeActivityListeners.delete(listener);
}

function activeActivityPath() {
  return encodeURIComponent(activeActivityCode);
}

export function apiBase() {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE.replace(/\/$/, "");
  if (typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname}:8080/api/v1`;
  return "http://127.0.0.1:8080/api/v1";
}

export function apiAssetUrl(path?: string) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("blob:") || path.startsWith("data:")) return path;
  return `${apiBase().replace(/\/api\/v1$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function cookie(name: string) {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((part) => part.startsWith(`${name}=`))?.split("=").slice(1).join("=") || "";
}

export async function api<T>(path: string, init: RequestInit = {}, csrfKind?: "admin" | "h5"): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (csrfKind) {
    const value = decodeURIComponent(cookie(csrfKind === "admin" ? "ORDER_SHOW_ADMIN_CSRF" : "ORDER_SHOW_H5_CSRF"));
    if (value) headers.set("X-CSRF-Token", value);
  }
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers, credentials: "include" });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("json") ? await response.json() : await response.text();
  if (!response.ok) throw new ApiError(response.status, body?.code || "REQUEST_FAILED", body?.detail || body?.message || "请求失败");
  return body as T;
}

export type Envelope<T> = { data: T; traceId: string };
export type PageEnvelope<T> = { data: T[]; page: { number: number; size: number; totalElements: number; totalPages: number }; traceId: string };

export type RuntimeActivity = {
  id: number; code: string; name: string; description?: string; status: string; configuredStatus: string;
  timezone: string; startsAt: string; endsAt: string; customerScope: string; companyRankingTopN: number;
  branchRankingTopN: number; tonDisplayScale: number; version: number;
  regions: Array<{ code: string; name: string; sortNo: number }>;
};

export type RuntimeIdentity = {
  sessionId: number; activityId: number; customerId: number; activityCode: string; customerType: "GENERAL" | "SPECIAL";
  regionCode?: string; branchName?: string; dealerShortName?: string; dealerFullName: string; phoneMasked: string;
};

export type RuntimeProduct = {
  id: number; materialCode?: string; materialName: string; categoryName?: string; productLine?: string; brandName?: string;
  varietyName?: string; specification?: string; casePack?: string; bottlePrice?: number; casePrice?: number;
  tonCaseFactor?: number; customerType: "GENERAL" | "SPECIAL"; rebateStatus: "PARTICIPATING" | "NOT_PARTICIPATING";
  giftBox: boolean; visible: boolean; orderable: boolean; dataStatus: string; sortNo: number; version: number; branchScope: string[];
  images: Array<{ id: number; fileId: number; url: string; primary: boolean; sortNo: number }>;
};

export type RuntimeOrder = {
  id: number; activityId: number; orderNo: string; status: "SUBMITTED" | "WITHDRAWN"; customerType: string;
  regionCode?: string; branchName?: string; dealerShortName?: string; dealerFullName: string; phoneMasked: string;
  currentVersion: number; totalQuantity: number; totalTons?: number; totalAmount: number; firstSubmittedAt: string;
  lastSubmittedAt: string; lastModifiedAt: string; withdrawnAt?: string; withdrawnReason?: string;
  items: Array<{ id: number; productId: number; lineNo: number; materialCode?: string; materialName: string; productLine?: string;
    specification?: string; casePack?: string; quantity: number; casePrice: number; lineAmount: number; tonCaseFactor?: number; lineTons?: number }>;
  versions: Array<{ id: number; version: number; totalQuantity: number; totalTons?: number; totalAmount: number; submittedAt: string; submittedSource: string;
    items?: Array<{ id: number; productId?: number; lineNo: number; materialCode?: string; materialName: string; productLine?: string;
      specification?: string; casePack?: string; quantity: number; casePrice: number; lineAmount: number; tonCaseFactor?: number; lineTons?: number }> }>;
  operations: Array<{ type: string; source: string; orderVersion?: number; reason?: string; occurredAt: string }>;
};

export type ImportTask = {
  id: number; activityId: number; importType: "PRODUCT" | "WHITELIST" | "ATTENDANCE"; status: string;
  sourceFilename: string; inputCount: number; addedCount: number; updatedCount: number; unchangedCount: number;
  deactivatedCount: number; warningCount: number; errorCount: number; failureCode?: string; failureMessage?: string;
};

export type ImportStagingRow = {
  id: number; sheetName: string; sourceRowNumber: number; diffType: "ADDED" | "UPDATED" | "UNCHANGED" | "DEACTIVATED" | "POSSIBLE_DUPLICATE" | "PENDING_CONFIRMATION";
  validationStatus: "VALID" | "WARNING" | "BLOCKED"; normalizedData: Record<string, unknown>;
  editedData: Record<string, unknown>; deleted: boolean;
};

export type AdminOrderSummary = Omit<RuntimeOrder, "items" | "versions" | "operations" | "dealerShortName" | "withdrawnAt" | "withdrawnReason">;

export type DashboardData = {
  activityId: number; activityName: string; status: string;
  totals: { order_count?: number; total_quantity?: number; total_amount?: number; total_tons?: number; branch_count?: number };
  companies: Array<{ rank: number; name: string; branch?: string; amount: number; quantity: number; tons?: number }>;
  branches: Array<{ rank: number; name: string; branch?: string; amount: number; quantity: number; tons?: number }>;
  productLines: Array<{ productLine: string; amount: number; quantity: number }>;
  latestOrders: Array<{ orderNo: string; dealerName: string; branchName?: string; amount: number; submittedAt: string }>;
  version: string; generatedAt: string;
};

export type DashboardReport = {
  reportCode: string; dashboard: DashboardData;
  customerTypes: Array<{ customerType: string; orderCount: number; amount: number; quantity: number }>;
  regions: Array<{ regionCode: string; amount: number; orderCount: number }>;
  generalProductLines: Array<{ productLine: string; amount: number; quantity: number }>;
  specialProductLines: Array<{ productLine: string; amount: number; quantity: number }>;
  giftCustomerTypes: Array<{ customerType: string; orderCount: number; amount: number; quantity: number }>;
  topGeneral: Array<{ rank: number; name: string; branch?: string; amount: number; quantity: number; tons?: number }>;
  topSpecial: Array<{ rank: number; name: string; branch?: string; amount: number; quantity: number; tons?: number }>;
  trend: Array<{ bucket: string; amount: number; orders: number }>;
};

export type LotteryRoundApi = {
  id: number; activityId: number; ruleId: number; roundNo: number; name: string; prizeName: string;
  winnerCount: number; candidateScope: "ALL_CUSTOMERS" | "ATTENDEES" | "VALID_ORDERS";
  customerType: "ALL" | "GENERAL" | "SPECIAL"; minimumOrderAmount: number; qualificationCutoffAt?: string;
  excludePreviousWinners: boolean; displayNameType: "SHORT_NAME" | "FULL_NAME"; status: string;
  currentAttemptNo: number; candidateCount?: number; resultHash?: string; drawnAt?: string; completedAt?: string; lockVersion: number;
};

export type LotteryRuleApi = { id: number; activityId: number; name: string; status: string; createdAt: string; updatedAt: string; rounds: LotteryRoundApi[] };
export type LotteryWinnerApi = { roundId: number; position: number; activityCustomerId: number; dealerDisplayName: string; customerType: string; regionCode?: string; branchName?: string; phoneMasked: string };
export type LotteryDrawResult = { roundId: number; attemptId: number; attemptNo: number; candidateCount: number; winners: LotteryWinnerApi[]; resultHash: string; drawnAt: string };

export type AdminCustomer = {
  id: number; customerType: "GENERAL" | "SPECIAL"; regionCode?: string; branchName?: string; dealerShortName?: string;
  dealerFullName: string; dealerCategory?: string; contactName?: string; phone: string; phoneMasked: string; confirmerName?: string;
  confirmerPhone?: string; confirmerPhoneMasked?: string; excelSequence?: number; active: boolean; lockVersion: number; updatedAt: string;
};

export type AdminAttendee = {
  id: number; activityCustomerId?: number; participantName?: string; gender?: string; participantType?: string;
  dealerName: string; branchName?: string; phone?: string; phoneMasked?: string;
  matchStatus: "MATCHED" | "PENDING_CONFIRMATION" | "UNMATCHED";
  matchMethod?: "PHONE" | "FULL_NAME" | "SHORT_NAME" | "MANUAL";
  matchReasonCode?: string; matchedDealerName?: string; lotteryEligible: boolean;
  createdAt: string; updatedAt: string;
};
export type AuditLogApi = { id: number; actorType: string; actorName?: string; actionCode: string; objectType: string;
  objectId?: string; reason?: string; result: string; errorCode?: string; traceId: string; occurredAt: string };

export async function loadActivity() { return (await api<Envelope<RuntimeActivity>>(`/public/activities/${activeActivityPath()}`)).data; }

export async function verifyPhone(customerType: "GENERAL" | "SPECIAL", regionCode: string, phone: string) {
  return (await api<Envelope<{ customer: RuntimeIdentity; csrfToken: string }>>(`/public/activities/${activeActivityPath()}/verify-phone`, {
    method: "POST", body: JSON.stringify({ customerType, regionCode: regionCode || null, phone }),
  })).data.customer;
}

export async function loadH5Products() {
  return (await api<Envelope<RuntimeProduct[]>>(`/h5/activities/${activeActivityPath()}/products`)).data;
}

export async function loadH5Order() {
  try { return (await api<Envelope<RuntimeOrder>>(`/h5/activities/${activeActivityPath()}/order`)).data; }
  catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
}

export async function saveH5Order(expectedVersion: number, items: Array<{ productId: number; quantity: number }>) {
  return (await api<Envelope<RuntimeOrder>>(`/h5/activities/${activeActivityPath()}/order`, {
    method: "PUT", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ expectedVersion, items }),
  }, "h5")).data;
}

export async function withdrawH5Order(expectedVersion: number) {
  return (await api<Envelope<RuntimeOrder>>(`/h5/activities/${activeActivityPath()}/order/withdraw`, {
    method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ expectedVersion }),
  }, "h5")).data;
}

export async function adminLogin(username: string, password: string) {
  return (await api<Envelope<{ id: number; username: string; displayName: string; mustChangePassword: boolean; csrfToken: string }>>("/admin/auth/login", {
    method: "POST", body: JSON.stringify({ username, password }),
  })).data;
}

export async function adminMe() {
  return (await api<Envelope<{ id: number; username: string; displayName: string; mustChangePassword: boolean; csrfToken: string }>>("/admin/me")).data;
}

export async function changeAdminPassword(currentPassword: string, newPassword: string) {
  return api<Envelope<boolean>>("/admin/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }, "admin");
}

export async function uploadImport(activityId: number, importType: "PRODUCT" | "WHITELIST" | "ATTENDANCE", file: File) {
  const body = new FormData(); body.append("importType", importType); body.append("file", file);
  return (await api<Envelope<ImportTask>>(`/admin/activities/${activityId}/imports`, { method: "POST", body }, "admin")).data;
}

export async function confirmImport(activityId: number, taskId: number) {
  return (await api<Envelope<ImportTask>>(`/admin/activities/${activityId}/imports/${taskId}/confirm`, { method: "POST" }, "admin")).data;
}

export async function loadImportTask(activityId: number, taskId: number) {
  return (await api<Envelope<ImportTask>>(`/admin/activities/${activityId}/imports/${taskId}`)).data;
}

export async function loadImportRows(activityId: number, taskId: number, validationStatus?: string) {
  const query = validationStatus ? `?validationStatus=${encodeURIComponent(validationStatus)}` : "";
  return (await api<Envelope<ImportStagingRow[]>>(`/admin/activities/${activityId}/imports/${taskId}/rows${query}`)).data;
}

export async function updateImportRow(activityId: number, taskId: number, rowId: number, changes: Record<string, unknown>, deleted = false) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/imports/${taskId}/rows/${rowId}`, {
    method: "PATCH", body: JSON.stringify({ changes, deleted }),
  }, "admin")).data;
}
export async function cancelImport(activityId: number, taskId: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/imports/${taskId}`, { method: "DELETE" }, "admin")).data;
}

export async function waitForImport(activityId: number, taskId: number) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const task = (await api<Envelope<Record<string, unknown>>>(`/admin/activities/${activityId}/imports/${taskId}`)).data;
    if (task.status === "COMPLETED") return task;
    if (task.status === "FAILED" || task.status === "CANCELLED") throw new ApiError(422, String(task.failureCode || "IMPORT_FAILED"), String(task.failureMessage || "导入发布失败"));
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new ApiError(408, "IMPORT_TIMEOUT", "导入仍在处理中，请稍后刷新查看");
}

export async function uploadProductImages(activityId: number, file: File, confirm: boolean) {
  const body = new FormData(); body.append("file", file); body.append("confirm", String(confirm));
  return (await api<Envelope<Record<string, unknown>>>(`/admin/activities/${activityId}/product-images/zip`, { method: "POST", body }, "admin")).data;
}

export async function updateActivity(activity: RuntimeActivity, changes: { name: string; startsAt: string; endsAt: string }) {
  const body = {
    code: activity.code, name: changes.name, description: activity.description || "", timezone: activity.timezone,
    startsAt: new Date(changes.startsAt).toISOString(), endsAt: new Date(changes.endsAt).toISOString(),
    customerScope: activity.customerScope, companyRankingTopN: activity.companyRankingTopN,
    branchRankingTopN: activity.branchRankingTopN, tonDisplayScale: activity.tonDisplayScale, regions: activity.regions,
  };
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${activity.id}`, {
    method: "PUT", headers: { "If-Match": String(activity.version) }, body: JSON.stringify(body),
  }, "admin")).data;
}

export async function transitionActivity(activity: RuntimeActivity, targetStatus: string) {
  return (await api<Envelope<RuntimeActivity>>(`/admin/activities/${activity.id}/transition`, {
    method: "POST", headers: { "If-Match": String(activity.version) }, body: JSON.stringify({ targetStatus }),
  }, "admin")).data;
}

export async function loadAdminOrders(activityId: number, filters: { status?: string; customerType?: string; keyword?: string; page?: number; size?: number } = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== "") query.set(key, String(value)); });
  return api<PageEnvelope<AdminOrderSummary>>(`/admin/activities/${activityId}/orders?${query.toString()}`);
}

export async function loadAdminOrder(activityId: number, orderId: number) {
  return (await api<Envelope<RuntimeOrder>>(`/admin/activities/${activityId}/orders/${orderId}`)).data;
}

export async function exportAdminOrders(activityId: number, filters: { status?: string; customerType?: string; keyword?: string } = {}) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  const response = await fetch(`${apiBase()}/admin/activities/${activityId}/orders/export?${query.toString()}`, { credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, "EXPORT_FAILED", "订单导出失败");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `订单导出-${new Date().toISOString().slice(0, 10)}.xlsx`; link.click(); URL.revokeObjectURL(url);
}

export async function loadDashboard(filters: { customerType?: string; regionCode?: string } = {}) {
  const query = new URLSearchParams();
  if (filters.customerType) query.set("customerType", filters.customerType);
  if (filters.regionCode) query.set("regionCode", filters.regionCode);
  return (await api<Envelope<DashboardData>>(`/screen/activities/${activeActivityPath()}/ranking?${query.toString()}`)).data;
}
export async function loadDashboardReport(reportCode: string) { return (await api<Envelope<DashboardReport>>(`/screen/activities/${activeActivityPath()}/reports/${encodeURIComponent(reportCode)}`)).data; }

export async function loadLotteryRules(activityId: number) { return (await api<Envelope<LotteryRuleApi[]>>(`/admin/activities/${activityId}/lottery/rules`)).data; }
export async function loadPublicLottery() { return (await api<Envelope<{ rules: LotteryRuleApi[]; winners: LotteryWinnerApi[] }>>(`/public/activities/${activeActivityPath()}/lottery`)).data; }
export async function createLotteryRule(activityId: number, body: { name: string; rounds: Array<Record<string, unknown>> }) {
  return (await api<Envelope<LotteryRuleApi>>(`/admin/activities/${activityId}/lottery/rules`, { method: "POST", body: JSON.stringify(body) }, "admin")).data;
}
export async function updateLotteryRule(activityId: number, ruleId: number, body: { name: string; rounds: Array<Record<string, unknown>> }) {
  return (await api<Envelope<LotteryRuleApi>>(`/admin/activities/${activityId}/lottery/rules/${ruleId}`, { method: "PUT", body: JSON.stringify(body) }, "admin")).data;
}
export async function publishLotteryRule(activityId: number, ruleId: number) { return (await api<Envelope<LotteryRuleApi>>(`/admin/activities/${activityId}/lottery/rules/${ruleId}/publish`, { method: "POST" }, "admin")).data; }
export async function drawLotteryRound(activityId: number, roundId: number) { return (await api<Envelope<LotteryDrawResult>>(`/admin/activities/${activityId}/lottery/rounds/${roundId}/draw`, { method: "POST" }, "admin")).data; }
export async function completeLotteryRound(activityId: number, roundId: number) { return (await api<Envelope<LotteryRoundApi>>(`/admin/activities/${activityId}/lottery/rounds/${roundId}/complete`, { method: "POST" }, "admin")).data; }
export async function resetLotteryRound(activityId: number, roundId: number, reason: string) { return (await api<Envelope<LotteryRoundApi>>(`/admin/activities/${activityId}/lottery/rounds/${roundId}/reset`, { method: "POST", body: JSON.stringify({ reason }) }, "admin")).data; }

export async function loadAdminProducts(activityId: number) { return (await api<Envelope<RuntimeProduct[]>>(`/admin/activities/${activityId}/products`)).data; }
export async function createAdminProduct(activityId: number, body: Record<string, unknown>) {
  return (await api<Envelope<RuntimeProduct>>(`/admin/activities/${activityId}/products`, { method: "POST", body: JSON.stringify(body) }, "admin")).data;
}
export async function updateAdminProduct(activityId: number, productId: number, version: number, body: Record<string, unknown>) {
  return (await api<Envelope<RuntimeProduct>>(`/admin/activities/${activityId}/products/${productId}`, {
    method: "PATCH", headers: { "If-Match": String(version) }, body: JSON.stringify(body),
  }, "admin")).data;
}
export async function deleteAdminProduct(activityId: number, productId: number, version: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/products/${productId}`, {
    method: "DELETE", headers: { "If-Match": String(version) },
  }, "admin")).data;
}
async function loadAllPages<T>(path: string) {
  const rows: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await api<PageEnvelope<T>>(`${path}${separator}page=${page}&size=200`);
    rows.push(...response.data);
    if (page >= response.page.totalPages) break;
  }
  return rows;
}
export async function loadAdminCustomers(activityId: number) { return loadAllPages<AdminCustomer>(`/admin/activities/${activityId}/customers`); }
export async function loadAdminAttendees(activityId: number) { return loadAllPages<AdminAttendee>(`/admin/activities/${activityId}/attendees`); }
export async function createAdminCustomer(activityId: number, body: Record<string, unknown>) {
  return (await api<Envelope<AdminCustomer>>(`/admin/activities/${activityId}/customers`, { method: "POST", body: JSON.stringify(body) }, "admin")).data;
}
export async function updateAdminCustomer(activityId: number, customerId: number, body: Record<string, unknown>) {
  return (await api<Envelope<AdminCustomer>>(`/admin/activities/${activityId}/customers/${customerId}`, { method: "PUT", body: JSON.stringify(body) }, "admin")).data;
}
export async function deleteAdminCustomer(activityId: number, customerId: number, expectedVersion: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/customers/${customerId}`, {
    method: "DELETE", headers: { "If-Match": String(expectedVersion) },
  }, "admin")).data;
}
export async function createAdminAttendee(activityId: number, body: Record<string, unknown>) {
  return (await api<Envelope<AdminAttendee>>(`/admin/activities/${activityId}/attendees`, { method: "POST", body: JSON.stringify(body) }, "admin")).data;
}
export async function updateAdminAttendee(activityId: number, attendeeId: number, body: Record<string, unknown>) {
  return (await api<Envelope<AdminAttendee>>(`/admin/activities/${activityId}/attendees/${attendeeId}`, { method: "PUT", body: JSON.stringify(body) }, "admin")).data;
}
export async function deleteAdminAttendee(activityId: number, attendeeId: number) {
  return (await api<Envelope<boolean>>(`/admin/activities/${activityId}/attendees/${attendeeId}`, { method: "DELETE" }, "admin")).data;
}
export async function loadAuditLogs(activityId: number) {
  return (await api<PageEnvelope<AuditLogApi>>(`/admin/activities/${activityId}/audit-logs?page=1&size=50`)).data;
}
