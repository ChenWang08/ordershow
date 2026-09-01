import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const frontendSourceFiles = [
  "../app/prototype.tsx",
  "../app/features/h5/H5Prototype.tsx",
  "../app/features/screens/ScreenBoards.tsx",
  "../app/features/lottery/Lottery.tsx",
  "../app/features/admin/AdminPrototype.tsx",
  "../app/features/admin/AdminComponents.tsx",
  "../app/features/admin/admin-utils.ts",
  "../app/features/shared/utils.ts",
];

const apiSourceFiles = [
  "../app/api.ts",
  "../app/services/api/context.ts",
  "../app/services/api/client.ts",
  "../app/services/api/types.ts",
  "../app/services/api/activity.ts",
  "../app/services/api/h5-orders.ts",
  "../app/services/api/auth.ts",
  "../app/services/api/imports.ts",
  "../app/services/api/orders.ts",
  "../app/services/api/dashboard.ts",
  "../app/services/api/lottery.ts",
  "../app/services/api/products.ts",
  "../app/services/api/customers.ts",
  "../app/services/api/audit.ts",
];

async function readSources(paths) {
  return (await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
}

function readFrontendSource() {
  return readSources(frontendSourceFiles);
}

function readApiSource() {
  return readSources(apiSourceFiles);
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost:3000" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ordering system shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>订货会管理系统<\/title>/);
  assert.match(html, /客户订货 H5、实时数据大屏、专题战报、幸运抽奖和管理后台/);
  assert.match(html, /订货 H5/);
  assert.match(html, /订单看板/);
  assert.match(html, /订货排行/);
  assert.match(html, /专题战报/);
  assert.match(html, /幸运抽奖/);
  assert.match(html, /管理后台/);
  assert.match(html, /选择您的订货通道/);
  assert.match(html, /综合客户订货/);
  assert.match(html, /特渠专业客户订货/);
  assert.match(html, /\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("keeps production assets and source wired", async () => {
  const [page, prototype, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFrontendSource(),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<Prototype \/>/);
  assert.match(prototype, /function H5Prototype/);
  assert.match(prototype, /function OrderDashboard/);
  assert.match(prototype, /function DashboardTopRanking/);
  assert.match(prototype, /\(p\.status === "有效" \|\| p\.status === "待完善"\)/);
  assert.match(prototype, /p\.materialCode.*includes\(normalizedProductSearch\)/s);
  assert.match(prototype, /function RankingBoard/);
  assert.match(prototype, /function ReportBoard/);
  assert.match(prototype, /function LotteryBoard/);
  assert.match(prototype, /function AdminPrototype/);
  assert.match(layout, /generateMetadata/);
  assert.match(css, /product-atlas\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await access(new URL("../public/product-atlas.png", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});

test("keeps product imports as independent full-replacement batches", async () => {
  const [prototype, domain, productImages, api, importService, importController, productService] = await Promise.all([
    readFrontendSource(),
    readFile(new URL("../app/domain/import-domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/product-images.ts", import.meta.url), "utf8"),
    readApiSource(),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/imports/ImportService.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/imports/ImportController.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/catalog/ProductService.java", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(domain, /ProductImportAction|"未上传"/);
  assert.match(domain, /"有效" \| "待核对" \| "待完善"/);
  assert.match(domain, /"已匹配" \| "待确认" \| "未匹配"/);
  assert.match(prototype, /上传只生成预览/);
  assert.match(prototype, /<span>价格状态<\/span>/);
  assert.match(prototype, /<option>价格有效<\/option><option>价格待完善<\/option>/);
  assert.match(api, /body\.append\("imageZip", imageZip\)/);
  assert.match(api, /body\.append\("imageDecisions", JSON\.stringify\(imageDecisions\)\)/);
  assert.match(api, /deleteAdminProductImage/);
  assert.match(api, /updateAdminProductImage/);
  assert.match(productImages, /pendingRows\.length > 0 \? "PENDING" : "UNMATCHED"/);
  assert.match(api, /loadProductImageReviews/);
  assert.match(prototype, /mergeProductImageReviews/);
  assert.match(prototype, /fileName: productImageBaseName\(candidate\.archivePath\)/);
  assert.match(productService, /product_image_review_candidate/);
  assert.match(domain, /ProductImageRelationStatus = "CONFIRMED" \| "CANDIDATE"/);
  assert.match(productImages, /缺少状态时必须待确认/);
  assert.match(productImages, /productImageRelationStatus\(image\) === "CONFIRMED"/);
  assert.match(prototype, /synchronizeProductImageAssetStatuses\(productImageAssets, productRows\)/);
  assert.doesNotMatch(prototype, /confirmedZipIds|savedProductKey|sameProduct/);
  assert.match(prototype, /选择此图/);
  assert.match(prototype, /排除候选/);
  assert.match(prototype, /每个商品只保留一张图片/);
  assert.match(productImages, /一个物料代码只能有一张图/);
  assert.match(importService, /IMAGE_DECISION_MULTIPLE_IMAGES/);
  assert.match(productService, /sameMaterialCodeProducts/);
  assert.match(prototype, /await deleteAdminProductImage/);
  assert.match(prototype, /const saved = await onSave/);
  assert.match(importController, /MultipartFile imageZip/);
  assert.match(importService, /auxiliary_file_id/);
  assert.match(importService, /image_decisions_json/);
  assert.match(importService, /attachZipToVersion/);
  assert.match(productService, /"CONFIRMED"\.equals\(decision\.status\(\)\)/);
  assert.doesNotMatch(importService, /inheritProductImages/);
});

test("supports manually configured whole-line volume pricing", async () => {
  const [frontend, importDomain, importService, workbookProcessor, orderService, migration] = await Promise.all([
    readFrontendSource(),
    readFile(new URL("../app/domain/import-domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/imports/ImportService.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/imports/ImportWorkbookProcessor.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/order/OrderService.java", import.meta.url), "utf8"),
    readFile(new URL("../db/migrations/V013__product_volume_price_tier.sql", import.meta.url), "utf8"),
  ]);

  assert.match(importDomain, /priceTierMinQuantity: string/);
  assert.match(frontend, /设置满箱整批优惠/);
  assert.match(frontend, /达到门槛后，本商品全部箱数按优惠箱价计算/);
  assert.match(frontend, /function effectiveCasePrice/);
  assert.match(frontend, /quantity >= product\.tierMinQuantity/);
  assert.match(importService, /activity_product_price_tier/);
  assert.match(workbookProcessor, /PRODUCT_PRICE_TIER_INVALID/);
  assert.match(orderService, /effectiveCasePrice/);
  assert.match(orderService, /applied_tier_min_quantity/);
  assert.match(migration, /CREATE TABLE activity_product_price_tier/);
});

test("keeps whitelist imports status-only with filtering", async () => {
  const [prototype, domain] = await Promise.all([
    readFrontendSource(),
    readFile(new URL("../app/domain/import-domain.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(domain, /WhitelistImportAction|replaceWhitelistImportRows/);
  assert.match(domain, /status: "有效" \| "待处理"/);
  assert.match(domain, /summarizeWhitelistRows/);
  assert.match(prototype, /<option>有效<\/option><option>待处理<\/option>/);
  assert.doesNotMatch(prototype, /\$\{row\.importAction\} · \$\{row\.status\}/);
});

test("keeps orders admin-read-only and wires the formal runtime APIs", async () => {
  const [api, prototype, orderController, openapi] = await Promise.all([
    readApiSource(),
    readFrontendSource(),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/order/OrderController.java", import.meta.url), "utf8"),
    readFile(new URL("../docs/design/openapi/order-show-api.yaml", import.meta.url), "utf8"),
  ]);

  assert.match(api, /saveH5Order/);
  assert.match(api, /withdrawH5Order/);
  assert.match(api, /loadAdminOrders/);
  assert.match(api, /drawLotteryRound/);
  assert.match(api, /loadOrderDashboard/);
  assert.match(api, /regionProductLines/);
  assert.match(prototype, /await drawLotteryRound\(activityId, currentRound\.id\)/);
  assert.match(orderController, /\/h5\/activities\/\{activityCode\}\/order\/withdraw/);
  assert.doesNotMatch(orderController, /\/admin\/.*withdraw/);
  assert.doesNotMatch(openapi, /\/admin\/activities\/\{activityId\}\/orders\/\{orderId\}\/withdraw/);
});

test("keeps the hourly order trend inside the activity window and timezone-safe", async () => {
  const [prototype, dashboardService] = await Promise.all([
    readFrontendSource(),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/dashboard/DashboardService.java", import.meta.url), "utf8"),
  ]);

  assert.match(dashboardService, /activity\.actualStartedAt\(\) == null \? activity\.startsAt\(\) : activity\.actualStartedAt\(\)/);
  assert.match(dashboardService, /last_submitted_at >= \? AND last_submitted_at <= \?/);
  assert.match(dashboardService, /DATE_FORMAT\(last_submitted_at, '%Y-%m-%dT%H:00:00'\), 'Z'/);
  assert.match(prototype, /activity\.actualStartedAt \?\? activity\.startsAt/);
  assert.match(prototype, /Math\.min\(liveEnd, activityEnd\)/);
  assert.match(prototype, /timeZone: activityTimeZone/);
  assert.match(prototype, /existing \?\? \{ bucket: new Date\(time\)\.toISOString\(\), amount: 0, orders: 0 \}/);
});

test("keeps an H5 draft only when the verified customer is unchanged", async () => {
  const [prototype, api, controller, service, migration] = await Promise.all([
    readFrontendSource(),
    readApiSource(),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/order/OrderController.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/order/OrderDraftService.java", import.meta.url), "utf8"),
    readFile(new URL("../db/migrations/V010__h5_order_draft.sql", import.meta.url), "utf8"),
  ]);

  assert.match(prototype, /const preserveDraft = runtimeIdentity\?\.activityId === identity\.activityId\s*&& runtimeIdentity\.customerId === identity\.customerId/);
  assert.match(prototype, /applyRuntimeOrder\(order, liveCatalog, preserveDraft\)/);
  assert.match(prototype, /if \(!preserveDraft\) setQuantities\(\{\}\)/);
  assert.match(prototype, /setOrderUpdatedAt\(""\).*setOrderWithdrawnAt\(""\).*setCartOpen\(false\).*setCancelConfirmOpen\(false\)/s);
  assert.match(prototype, /loadH5OrderDraft\(\)/);
  assert.match(prototype, /window\.addEventListener\("pagehide", flushOnPageHide\)/);
  assert.match(prototype, /setTimeout\(\(\) => void queueDraftSync\(snapshot\), 800\)/);
  assert.match(api, /saveH5OrderDraft/);
  assert.match(api, /deleteH5OrderDraft/);
  assert.match(controller, /\/order-draft/);
  assert.match(service, /DRAFT_CUSTOMER_MISMATCH/);
  assert.match(service, /DRAFT_BASE_ORDER_VERSION_CONFLICT/);
  assert.match(migration, /UNIQUE KEY uk_h5_order_draft_customer \(activity_id, activity_customer_id\)/);
});

test("supports one admin entry, current H5 resolution, paging, and fulfillment exports", async () => {
  const [api, prototype, routedPrototype, styles, orders, orderService, authService, activityService, activityController, activityRoute, h5Route] = await Promise.all([
    readApiSource(),
    readFrontendSource(),
    readFile(new URL("../app/routed-prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/orders/OrderManagement.tsx", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/order/OrderService.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/security/AuthService.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/activity/ActivityService.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/activity/ActivityController.java", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/[activityCode]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/h5/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(api, /loadAdminActivities/);
  assert.match(api, /createActivity/);
  assert.match(prototype, /切换活动/);
  assert.match(prototype, /创建后为草稿状态/);
  assert.match(prototype, /活动编号.*创建后自动生成/s);
  assert.doesNotMatch(prototype, /活动编码|newActivity\.code/);
  assert.match(activityService, /generateActivityNo\(id, now\(\), request\.timezone\(\)\)/);
  assert.match(activityService, /"HD" \+ date \+ String\.format\("%03d", id\)/);
  assert.match(api, /order-show\.admin\.activity-code/);
  assert.match(prototype, /window\.location\.assign\("\/admin"\)/);
  assert.doesNotMatch(prototype, /window\.location\.assign\(`\/admin\/\$\{/);
  assert.match(activityRoute, /LegacyAdminActivityRoute activityCode=\{activityCode\}/);
  assert.match(h5Route, /CurrentH5Route/);
  assert.match(routedPrototype, /loadCurrentActivity/);
  assert.match(activityController, /\/public\/activities\/current/);
  assert.match(activityService, /CURRENT_ACTIVITY_CONFLICT/);
  assert.match(activityService, /ACTIVITY_TIME_CONFLICT/);
  assert.doesNotMatch(styles, /admin-main > header > div:first-child/);
  assert.match(styles, /admin-main > header > div\.admin-heading[^}]*flex-direction: row/);
  assert.match(styles, /order-table \{ overflow-x: auto/);
  assert.match(orders, /admin-panel order-management-panel/);
  assert.match(orders, /size: 50/);
  assert.match(orders, /第 \{page\} \/ \{totalPages\} 页/);
  assert.match(orderService, /订单商品明细/);
  assert.match(orderService, /有效商品汇总/);
  assert.match(orderService, /有效分公司汇总/);
  assert.match(authService, /a\.status = 'CLOSED'.*a\.starts_at <= UTC_TIMESTAMP/s);
});

test("uses published, time-driven activity lifecycle controls", async () => {
  const [prototype, api, activityService, activityController] = await Promise.all([
    readFrontendSource(),
    readApiSource(),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/activity/ActivityService.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/activity/ActivityController.java", import.meta.url), "utf8"),
  ]);

  assert.match(prototype, />发布活动</);
  assert.match(prototype, />撤回发布</);
  assert.match(prototype, />立即截止订货</);
  assert.match(prototype, />结束整场活动</);
  assert.match(prototype, /整场活动结束时间/);
  assert.match(prototype, /历史回看/);
  assert.doesNotMatch(prototype, /立即开始并锁定导入|恢复为待开始|changeActivityStatus/);
  assert.match(prototype, /订货开始时间必须晚于当前时间/);
  assert.match(prototype, /活动进行中只能延长截止时间/);
  assert.match(api, /publishActivity/);
  assert.match(api, /withdrawActivityPublication/);
  assert.match(api, /closeActivityNow/);
  assert.match(api, /finishActivityNow/);
  assert.match(activityController, /\/publish/);
  assert.match(activityController, /\/withdraw-publication/);
  assert.match(activityController, /\/close/);
  assert.match(activityController, /\/finish/);
  assert.doesNotMatch(activityController, /\/transition/);
  assert.match(activityService, /status = 'ACTIVE'.*actual_started_at/s);
  assert.match(activityService, /ACTIVITY_END_CAN_ONLY_EXTEND/);
  assert.match(activityService, /ACTIVITY_EVENT_END_CAN_ONLY_EXTEND/);
  assert.match(activityService, /status = 'FINISHED'.*finished_at/s);
});

test("cancels superseded import previews and only blocks publication for newer pending work", async () => {
  const [prototype, api, activityService, importService, cleanupMigration] = await Promise.all([
    readFrontendSource(),
    readApiSource(),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/activity/ActivityService.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/imports/ImportService.java", import.meta.url), "utf8"),
    readFile(new URL("../db/migrations/V009__cancel_superseded_import_previews.sql", import.meta.url), "utf8"),
  ]);

  assert.match(api, /loadImportTasks/);
  assert.match(prototype, /await cancelImport\(Number\(activityId\), taskId\)/);
  assert.match(prototype, /已恢复服务器中尚未确认的导入预览/);
  assert.match(activityService, /t\.id > v\.source_import_task_id/);
  assert.match(activityService, /请确认或取消后再发布活动/);
  assert.match(importService, /cancelReplaceableTasks\(activityId, importType/);
  assert.match(cleanupMigration, /t\.id < v\.source_import_task_id/);
  assert.match(cleanupMigration, /SET t\.status = 'CANCELLED'/);
});

test("uses server-calculated lottery candidates and ordered, shortage-safe draws", async () => {
  const [prototype, api, service, controller] = await Promise.all([
    readFrontendSource(),
    readApiSource(),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/lottery/LotteryService.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/lottery/LotteryController.java", import.meta.url), "utf8"),
  ]);

  assert.match(api, /previewLotteryCandidates/);
  assert.match(controller, /lottery\/candidates\/preview/);
  assert.match(prototype, /按白名单客户 ID 去重/);
  assert.doesNotMatch(prototype, /资格截止时间|qualificationCutoffAt/);
  assert.match(prototype, /第一轮暂无历史中奖客户，无需设置/);
  assert.match(service, /Math\.min\(round\.winnerCount\(\), candidates\.size\(\)\)/);
  assert.match(service, /LOTTERY_ROUND_OUT_OF_ORDER/);
  assert.match(service, /deduplicationKey", "activity_customer\.id/);
  assert.match(service, /LOTTERY_PRIZE_REQUIRED/);
});

test("uses live overview data, full admin phones, Chinese regions, and linked attendance candidates", async () => {
  const [prototype, importDomain, api, importController, importService, migration, customerService] = await Promise.all([
    readFrontendSource(),
    readFile(new URL("../app/domain/import-domain.ts", import.meta.url), "utf8"),
    readApiSource(),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/imports/ImportController.java", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/imports/ImportService.java", import.meta.url), "utf8"),
    readFile(new URL("../db/migrations/V007__attendance_preview_whitelist_version.sql", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/customer/CustomerService.java", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(prototype, /19,457,005\.28|38,620|1,316\.0/);
  assert.match(prototype, /loadDashboard\(\{ customerType: "GENERAL" \}\)/);
  assert.match(prototype, /regionOptions\.find\(\(item\) => item\.value === identityRegionCode\)\?\.name/);
  assert.match(prototype, /row\.activityCustomerId !== null/);
  assert.match(prototype, /白名单实时试算/);
  assert.match(prototype, /确认替换当前到场名单/);
  assert.match(prototype, /待确认和未关联记录可以发布/);
  assert.match(prototype, /正在计算关联结果/);
    assert.match(prototype, /待确认和未关联记录不会进入抽奖候选池/);
    assert.match(prototype, /现场手机号仅作联系信息/);
  assert.match(prototype, /mergeAttendanceMatchPreview/);
  assert.match(prototype, /onSave: \(row: AttendanceRow\) => Promise<boolean>/);
  assert.match(prototype, /当前到场预览记录未绑定后端 staging/);
  assert.match(prototype, /当前白名单预览记录未绑定后端 staging/);
  assert.match(prototype, /const saved = await onSave/);
  assert.match(importDomain, /edited\.participantName/);
  assert.match(importDomain, /edited\.dealerFullName/);
  assert.match(api, /loadAttendanceMatchPreview/);
  assert.match(api, /attendanceWhitelistVersionId/);
  assert.match(importController, /attendance-match-preview/);
  assert.match(importService, /ATTENDANCE_WHITELIST_VERSION_CHANGED/);
    assert.match(importService, /matchedCustomerIds\.size\(\)/);
  assert.match(migration, /match_base_version_id/);
  assert.match(customerService, /decrypt\(rs\.getBytes\(9\)\)/);
  assert.match(customerService, /String phone, String phoneMasked/);
});
