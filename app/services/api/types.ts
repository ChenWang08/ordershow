export type Envelope<T> = { data: T; traceId: string };
export type PageEnvelope<T> = { data: T[]; page: { number: number; size: number; totalElements: number; totalPages: number }; traceId: string };
export type RankingMetric = "AMOUNT" | "TONS";

export type RuntimeActivity = {
  id: number; departmentId: number; departmentName?: string; code: string; name: string; description?: string; status: string; configuredStatus: string;
  timezone: string; startsAt: string; endsAt: string; customerScope: string; companyRankingTopN: number;
  branchRankingTopN: number; tonDisplayScale: number; version: number;
  regions: Array<{ code: string; name: string; sortNo: number }>;
  hasUnassignedGeneralCustomers?: boolean;
  whitelistCustomerTypeMode?: "TYPED" | "UNSPECIFIED";
  availableCustomerTypes?: Array<"GENERAL" | "SPECIAL">;
  eventEndsAt?: string; publishedAt?: string; actualStartedAt?: string; closedAt?: string; finishedAt?: string;
};

export type RuntimeIdentity = {
  sessionId: number; activityId: number; customerId: number; activityCode: string; customerType: "GENERAL" | "SPECIAL" | "ALL";
  regionCode?: string; branchName?: string; dealerShortName?: string; dealerFullName: string; phoneMasked: string;
};

export type RuntimeProduct = {
  dealerScope?: DealerScope[];
  effectiveDealerCount?: number;
  dealerScopeRestricted?: boolean;
  id: number; materialCode?: string; materialName: string; description?: string; categoryName?: string; productLine?: string; brandName?: string;
  varietyName?: string; specification?: string; casePack?: string; bottlePrice?: number; casePrice?: number;
  tonCaseFactor?: number; customerType: "GENERAL" | "SPECIAL" | "ALL"; rebateStatus: "PARTICIPATING" | "NOT_PARTICIPATING" | "ALL";
  giftBox: boolean; visible: boolean; orderable: boolean; dataStatus: string; sortNo: number; version: number; branchScope: string[];
  priceTier?: { minQuantity: number; casePrice: number; pricingMode: "WHOLE_ORDER" | "INCREMENTAL" };
  images: Array<{ id: number; fileId: number; url: string; primary: boolean; sortNo: number;
    sourceType: "ZIP_IMPORT" | "MANUAL"; matchStatus: "MATCHED" | "PENDING" | "UNMATCHED" | "CONFIRMED" }>;
};

export type DealerMember = { customerId: number; dealerFullName: string; customerType: string; active: boolean };
export type DealerScope = { branchName: string; members: DealerMember[] };
export type DealerScopeSummary = { scopes: DealerScope[]; effectiveCount: number; selectedCount: number; restricted: boolean };
export type DealerCandidate = { customerId: number; dealerFullName: string; dealerShortName?: string; branchName: string; customerType: string };

export type ProductImageReview = {
  id: number; fileId: number; url: string; archivePath: string; materialCode?: string; materialName: string; status: "PENDING";
};

export type RuntimeOrder = {
  id: number; activityId: number; activityCustomerId: number; orderNo: string; status: "SUBMITTED" | "WITHDRAWN" | "VOIDED";
  createdSource: "H5" | "ADMIN"; lastModifiedSource: "H5" | "ADMIN" | "SYSTEM"; lockVersion: number; customerType: string;
  regionCode?: string; branchName?: string; dealerShortName?: string; dealerFullName: string; phone?: string; phoneMasked: string;
  currentVersion: number; totalQuantity: number; totalTons?: number; totalAmount: number; firstSubmittedAt: string;
  lastSubmittedAt: string; lastModifiedAt: string; withdrawnAt?: string; withdrawnReason?: string;
  voidedAt?: string; voidedReason?: string;
  items: Array<{ id: number; productId: number; lineNo: number; materialCode?: string; materialName: string; productLine?: string;
    specification?: string; casePack?: string; quantity: number; casePrice: number; appliedTierMinQuantity?: number;
    baseCasePrice?: number; basePriceQuantity?: number; tierCasePrice?: number; tierMinQuantity?: number; tierPriceQuantity?: number;
    pricingMode?: "WHOLE_ORDER" | "INCREMENTAL"; lineAmount: number; tonCaseFactor?: number; lineTons?: number }>;
  versions: Array<{ id: number; version: number; totalQuantity: number; totalTons?: number; totalAmount: number; submittedAt: string; submittedSource: string;
    submittedByAdminName?: string; reason?: string;
    items?: Array<{ id: number; productId?: number; lineNo: number; materialCode?: string; materialName: string; productLine?: string;
      specification?: string; casePack?: string; quantity: number; casePrice: number; appliedTierMinQuantity?: number;
      baseCasePrice?: number; basePriceQuantity?: number; tierCasePrice?: number; tierMinQuantity?: number; tierPriceQuantity?: number;
      pricingMode?: "WHOLE_ORDER" | "INCREMENTAL"; lineAmount: number; tonCaseFactor?: number; lineTons?: number }> }>;
  operations: Array<{ type: string; source: string; adminName?: string; orderVersion?: number; reason?: string; occurredAt: string }>;
};

export type AdminOrderPreview = {
  totalQuantity: number; totalTons?: number; totalAmount: number;
  items: Array<{ productId: number; materialCode?: string; materialName: string; productLine?: string;
    specification?: string; casePack?: string; quantity: number; casePrice: number; appliedTierMinQuantity?: number;
    baseCasePrice?: number; basePriceQuantity: number; tierCasePrice?: number; tierMinQuantity?: number;
    tierPriceQuantity: number; pricingMode?: "WHOLE_ORDER" | "INCREMENTAL"; lineAmount: number; lineTons?: number }>;
};

export type RuntimeOrderDraft = {
  id: number; activityId: number; customerId: number; baseOrderVersion: number; version: number;
  items: Array<{ productId: number; quantity: number }>;
  updatedAt: string; expiresAt: string;
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

export type AttendanceMatchPreview = {
  whitelistVersionId?: number; calculatedAt: string; totalCount: number; matchedCount: number;
  pendingCount: number; unmatchedCount: number; eligibleCustomerCount: number;
  rows: Array<{ stagingRowId: number; activityCustomerId?: number; matchStatus: "MATCHED" | "PENDING_CONFIRMATION" | "UNMATCHED";
    matchMethod?: "PHONE" | "FULL_NAME" | "FULL_NAME_BRANCH" | "SHORT_NAME" | "MANUAL"; matchReasonCode?: string;
    matchedDealerName?: string; lotteryEligible: boolean }>;
};

export type AdminOrderSummary = Omit<RuntimeOrder, "activityCustomerId" | "items" | "versions" | "operations" | "dealerShortName" | "withdrawnAt" | "withdrawnReason" | "voidedAt" | "voidedReason">;

export type DashboardData = {
  activityId: number; activityName: string; status: string;
  totals: { order_count?: number; dealer_count?: number; total_quantity?: number; total_amount?: number; total_tons?: number; branch_count?: number; sku_count?: number };
  companies: Array<{ rank: number; name: string; branch?: string; amount: number; quantity: number; tons?: number | null }>;
  branches: Array<{ rank: number; name: string; branch?: string; amount: number; quantity: number; tons?: number | null }>;
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
  regionProductLines: Array<{ regionCode: string; productLine: string; amount: number; quantity: number }>;
  generalRegions?: Array<{ regionCode: string; regionName: string; sortNo: number; orderCount: number; amount: number;
    productLines: Array<{ productLine: string; amount: number; quantity: number }> }>;
};

export type LotteryRoundApi = {
  id: number; activityId: number; ruleId: number; roundNo: number; name: string; prizeName: string;
  prizeImageFileId?: number | null; prizeImageUrl?: string | null;
  winnerCount: number; candidateScope: "ALL_CUSTOMERS" | "ATTENDEES" | "VALID_ORDERS";
  customerType: "ALL" | "GENERAL" | "SPECIAL"; minimumOrderAmount: number;
  qualificationMetric: "AMOUNT" | "BOX_COUNT"; minimumOrderBoxCount: number;
  excludePreviousWinners: boolean; displayNameType: "SHORT_NAME" | "FULL_NAME"; status: string;
  currentAttemptNo: number; candidateCount?: number; resultHash?: string; drawnAt?: string; completedAt?: string; lockVersion: number;
};
export type LotteryPrizeImageUpload = { fileId: number; url: string; filename: string; contentType: string; sizeBytes: number };

export type LotteryRuleApi = { id: number; activityId: number; name: string; status: string; createdAt: string; updatedAt: string; rounds: LotteryRoundApi[] };
export type LotteryWinnerApi = { roundId: number; position: number; activityCustomerId: number; dealerDisplayName: string; customerType: string; regionCode?: string; branchName?: string; phoneMasked: string };
export type LotteryDrawResult = { roundId: number; attemptId: number; attemptNo: number; candidateCount: number;
  configuredWinnerCount: number; actualWinnerCount: number; unawardedCount: number;
  winners: LotteryWinnerApi[]; resultHash: string; drawnAt: string };
export type LotteryCandidatePreviewItem = { activityCustomerId: number; dealerFullName: string; customerType: string;
  regionCode?: string; branchName?: string; phoneMasked?: string; qualificationSource: string;
  qualifyingOrderAmount?: number; qualifyingOrderBoxCount?: number };
export type LotteryCandidatePreview = { calculatedAt: string; candidateCount: number; configuredWinnerCount: number;
  actualWinnerCount: number; unawardedCount: number; candidates: LotteryCandidatePreviewItem[] };
export type LotteryWinnerStatistics = { validWinnerRecords: number; validWinnerCustomers: number; invalidatedWinnerRecords: number };

export type AdminCustomer = {
  id: number; customerType: "GENERAL" | "SPECIAL" | "ALL"; regionCode?: string; branchName?: string; dealerShortName?: string;
  dealerFullName: string; dealerCategory?: string; contactName?: string; phone: string; phoneMasked: string; confirmerName?: string;
  confirmerPhone?: string; confirmerPhoneMasked?: string; excelSequence?: number; active: boolean; lockVersion: number; updatedAt: string;
};

export type AdminAttendee = {
  id: number; activityCustomerId?: number; participantName?: string; gender?: string; participantType?: string;
  dealerName: string; branchName?: string; phone?: string; phoneMasked?: string;
  matchStatus: "MATCHED" | "PENDING_CONFIRMATION" | "UNMATCHED";
  matchMethod?: "PHONE" | "FULL_NAME" | "FULL_NAME_BRANCH" | "SHORT_NAME" | "MANUAL";
  matchReasonCode?: string; matchedDealerName?: string; lotteryEligible: boolean;
  createdAt: string; updatedAt: string;
};
export type AuditLogApi = { id: number; actorType: string; actorName?: string; actionCode: string; objectType: string;
  objectId?: string; reason?: string; result: string; errorCode?: string; traceId: string; occurredAt: string };
