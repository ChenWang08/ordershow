import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

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
    readFile(new URL("../app/prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<Prototype \/>/);
  assert.match(prototype, /function H5Prototype/);
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
    readFile(new URL("../app/prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/import-domain.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/product-images.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api.ts", import.meta.url), "utf8"),
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
  assert.match(productImages, /hasPendingCandidate \? "PENDING" : "UNMATCHED"/);
  assert.match(prototype, /确认绑定/);
  assert.match(prototype, /排除候选/);
  assert.match(prototype, /await deleteAdminProductImage/);
  assert.match(prototype, /const saved = await onSave/);
  assert.match(importController, /MultipartFile imageZip/);
  assert.match(importService, /auxiliary_file_id/);
  assert.match(importService, /image_decisions_json/);
  assert.match(importService, /attachZipToVersion/);
  assert.match(productService, /"CONFIRMED"\.equals\(decision\.status\(\)\)/);
  assert.doesNotMatch(importService, /inheritProductImages/);
});

test("keeps whitelist imports status-only with filtering", async () => {
  const [prototype, domain] = await Promise.all([
    readFile(new URL("../app/prototype.tsx", import.meta.url), "utf8"),
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
    readFile(new URL("../app/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/order/OrderController.java", import.meta.url), "utf8"),
    readFile(new URL("../docs/design/openapi/order-show-api.yaml", import.meta.url), "utf8"),
  ]);

  assert.match(api, /saveH5Order/);
  assert.match(api, /withdrawH5Order/);
  assert.match(api, /loadAdminOrders/);
  assert.match(api, /drawLotteryRound/);
  assert.match(prototype, /await drawLotteryRound\(activityId, currentRound\.id\)/);
  assert.match(orderController, /\/h5\/activities\/\{activityCode\}\/order\/withdraw/);
  assert.doesNotMatch(orderController, /\/admin\/.*withdraw/);
  assert.doesNotMatch(openapi, /\/admin\/activities\/\{activityId\}\/orders\/\{orderId\}\/withdraw/);
});

test("uses server-calculated lottery candidates and ordered, shortage-safe draws", async () => {
  const [prototype, api, service, controller] = await Promise.all([
    readFile(new URL("../app/prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api.ts", import.meta.url), "utf8"),
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
  const [prototype, customerService] = await Promise.all([
    readFile(new URL("../app/prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../backend/src/main/java/com/fengyi/ordershow/customer/CustomerService.java", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(prototype, /19,457,005\.28|38,620|1,316\.0/);
  assert.match(prototype, /loadDashboard\(\{ customerType: "GENERAL" \}\)/);
  assert.match(prototype, /regionOptions\.find\(\(item\) => item\.value === identityRegionCode\)\?\.name/);
  assert.match(prototype, /row\.activityCustomerId !== null/);
  assert.match(customerService, /decrypt\(rs\.getBytes\(9\)\)/);
  assert.match(customerService, /String phone, String phoneMasked/);
});
