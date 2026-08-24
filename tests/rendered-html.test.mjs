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
