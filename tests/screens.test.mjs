import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/load-ts-module.mjs";

const domain = loadModule("app/features/screens/dashboard-domain.ts");
const activity = { id: 1, startsAt: "2026-09-07T09:30:00Z", endsAt: "2026-09-07T13:30:00Z", timezone: "Asia/Shanghai", regions: [] };

test("smoothed trends do not overshoot a zero-value valley", () => {
  const path = domain.dashboardSmoothPath([{ x: 36, y: 20 }, { x: 98, y: 112 }, { x: 160, y: 20 }]);
  const coordinates = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const heights = coordinates.filter((_, index) => index % 2 === 1);
  assert.ok(heights.every((height) => height >= 20 && height <= 112));
  assert.doesNotMatch(path, /NaN|Infinity/);
});

test("hourly trends fill missing hours only inside the activity window", () => {
  const rows = [{ bucket: "2026-09-07 10:00:00", amount: 120, orders: 1 }, { bucket: "2026-09-07 08:00:00", amount: 999, orders: 9 }];
  const trend = domain.dashboardHourlyTrend(rows, activity, "2026-09-07T12:15:00Z");
  assert.equal(trend.length, 4);
  assert.equal(trend[0].bucket, "2026-09-07T09:00:00.000Z");
  assert.equal(trend[0].amount, 0);
  assert.equal(trend[1], rows[0]);
  assert.equal(trend[3].orders, 0);
  assert.equal(trend.some((row) => row.amount === 999), false);
});

test("trend timestamps preserve explicit offsets and treat unzoned values as UTC", () => {
  assert.equal(domain.dashboardTrendTimestamp("2026-09-07 10:00:00"), Date.parse("2026-09-07T10:00:00Z"));
  assert.equal(domain.dashboardTrendTimestamp("2026-09-07T18:00:00+08:00"), Date.parse("2026-09-07T10:00:00Z"));
  assert.equal(domain.dashboardHourlyTrend([], activity, "2026-09-07T08:00:00Z").length, 0);
  assert.equal(domain.dashboardHourlyTrend([], null).length, 0);
});

test("trend range stops at actual close time", () => {
  const trend = domain.dashboardHourlyTrend([], { ...activity, closedAt: "2026-09-07T10:30:00Z" }, "2026-09-07T12:00:00Z");
  assert.equal(trend.length, 2);
  assert.equal(trend.at(-1).bucket, "2026-09-07T10:00:00.000Z");
});

test("project group colors remain consistent across dashboard sections", () => {
  const data = {
    dashboard: { totals: { total_amount: 120, total_tons: null }, productLines: [{ productLine: "酱油", amount: 120 }], branches: [], companies: [], generatedAt: "2026-09-07T10:00:00Z" },
    customerTypes: [], regions: [], trend: [], specialProductLines: [],
    generalProductLines: [{ productLine: "酱油", amount: 120 }],
    generalRegions: [{ regionCode: "EAST", regionName: "东区", amount: 120, orderCount: 1, productLines: [{ productLine: "酱油", amount: 120 }] }],
  };
  const model = domain.dashboardMetrics(data, activity);
  assert.equal(model.productLineRows[0].color, model.generalChannelProductRows[0].color);
  assert.equal(model.productLineRows[0].color, model.regionProductCards[0].rows[0].color);
  assert.equal(model.cards[1].value, "0");
  assert.equal(model.cards[1].unit, "吨");
  assert.equal(model.regionProductMax, 120);
});

test("zero-value bars have no artificial visible width", () => {
  const { DashboardBars } = loadModule("app/features/screens/DashboardCharts.tsx");
  const html = renderToStaticMarkup(React.createElement(DashboardBars, { rows: [{ name: "零订单", amount: 0 }] }));
  assert.match(html, /width:0%/);
  assert.doesNotMatch(html, /width:2%/);
});

test("untyped activities retain the all-customer donut and hide channel sections", () => {
  const { OrderDashboard } = loadModule("app/features/screens/OrderDashboard.tsx", {
    "./useOrderDashboard": { useOrderDashboard: () => ({ data: null, error: "", refreshing: false, historical: false, refresh: () => {} }) },
  });
  const html = renderToStaticMarkup(React.createElement(OrderDashboard, { activity: { ...activity, whitelistCustomerTypeMode: "UNSPECIFIED" } }));
  assert.match(html, /订单额占比/);
  assert.match(html, /全部客户/);
  assert.doesNotMatch(html, /渠道订单额占比|各渠道项目组订单额对比|综合渠道 · 各大区/);
});

test("single customer type hides channel comparison and expands the trend", () => {
  const singleTypeReport = {
    ...regionalReport,
    customerTypes: [{ customerType: "SPECIAL", amount: 80 }],
    generalProductLines: [],
    specialProductLines: [{ productLine: "酱油", amount: 80 }],
    generalRegions: [],
  };
  const { OrderDashboard } = loadModule("app/features/screens/OrderDashboard.tsx", {
    "./useOrderDashboard": { useOrderDashboard: () => ({ data: singleTypeReport, error: "", refreshing: false, historical: false, refresh: () => {} }) },
  });
  const html = renderToStaticMarkup(React.createElement(OrderDashboard, { activity: { ...activity, availableCustomerTypes: ["SPECIAL"] } }));
  assert.doesNotMatch(html, /渠道订单额占比|各渠道项目组订单额对比|综合客户 · 大区订单额分布/);
  assert.match(html, /订单额占比|特渠专业客户/);
  assert.match(html, /order-dashboard-channel-summary/);
  assert.match(html, /order-dashboard-product-line/);
  assert.match(html, /order-dashboard-trend-full/);
});

const regionalReport = {
  dashboard: { totals: { total_amount: 220, total_tons: 1 }, productLines: [{ productLine: "酱油", amount: 140 }], branches: [], companies: [], generatedAt: "2026-09-07T10:00:00Z" },
  customerTypes: [{ customerType: "GENERAL", amount: 140 }, { customerType: "SPECIAL", amount: 80 }],
  regions: [], trend: [], specialProductLines: [],
  generalProductLines: [{ productLine: "酱油", amount: 140 }],
  generalRegions: [
    { regionCode: "EAST", regionName: "华东", amount: 120, orderCount: 1, productLines: [{ productLine: "酱油", amount: 120 }] },
    { regionCode: "UNASSIGNED", regionName: "未分大区", amount: 20, orderCount: 1, productLines: [{ productLine: "酱油", amount: 20 }] },
  ],
};

test("order dashboard uses district terminology without changing region rows", () => {
  const { OrderDashboard } = loadModule("app/features/screens/OrderDashboard.tsx", {
    "./useOrderDashboard": { useOrderDashboard: () => ({ data: regionalReport, error: "", refreshing: false, historical: false, refresh: () => {} }) },
  });
  const html = renderToStaticMarkup(React.createElement(OrderDashboard, { activity }));
  assert.match(html, /综合客户 · 大区订单额分布/);
  assert.match(html, /综合渠道 · 各大区项目组订单额明细/);
  assert.match(html, /华东/);
  assert.match(html, /未分大区/);
  assert.doesNotMatch(html, /片区/);
});

for (const types of [["GENERAL"], ["SPECIAL"], ["GENERAL", "SPECIAL"], ["ALL"]]) {
  for (const submitted of [false, true]) {
    test(`dedicated dashboard payload preserves whitelist layout: ${types.join("+")}, submitted=${submitted}`, () => {
      const dual = types.length === 2;
      const unspecified = types[0] === "ALL";
      const data = { ...regionalReport,
        dashboard: { ...regionalReport.dashboard, totals: { total_amount: submitted ? 140 : 0 }, latestOrders: [] },
        customerTypes: submitted ? [{ customerType: types[0], amount: 140 }] : [],
        giftCustomerTypes: [], topGeneral: [], topSpecial: [],
      };
      const { OrderDashboard } = loadModule("app/features/screens/OrderDashboard.tsx", {
        "./useOrderDashboard": { useOrderDashboard: () => ({ data, error: "", refreshing: false, historical: false, refresh: () => {} }) },
      });
      const html = renderToStaticMarkup(React.createElement(OrderDashboard, { activity: { ...activity,
        availableCustomerTypes: types, whitelistCustomerTypeMode: unspecified ? "UNSPECIFIED" : "TYPED" } }));
      assert.equal(html.includes("各渠道项目组订单额对比"), dual);
      assert.equal(html.includes("综合客户 · 大区订单额分布"), types.includes("GENERAL"));
      assert.equal(html.includes("order-dashboard-trend-full"), !dual);
      assert.match(html, /分公司订单额排名 TOP 15/);
      assert.match(html, /经销商订单额排名 TOP 15/);
      assert.doesNotMatch(html, /NaN|Infinity/);
      if (unspecified) assert.match(html, /全部客户/);
    });
  }
}

test("ranking board exposes amount and tonnage ranking modes", () => {
  const { RankingBoard } = loadModule("app/features/screens/RankingBoard.tsx", {
    "../../api": {
      ApiError: class ApiError extends Error {}, apiBase: () => "http://test/api", getActiveActivityCode: () => "fixture",
      loadDashboard: async () => null,
    },
  });
  const html = renderToStaticMarkup(React.createElement(RankingBoard, { activity: { ...activity, status: "ACTIVE", availableCustomerTypes: ["GENERAL", "SPECIAL"] } }));
  assert.match(html, /金额排行/);
  assert.match(html, /吨数排行/);
  assert.match(html, /公司订单金额排行/);
  assert.match(html, /分公司订货榜/);
});

for (const metric of ["AMOUNT", "TONS"]) {
  for (const count of [0, 1, 2, 20, 22, 90]) {
    test(`ranking board renders every returned company: ${metric}, ${count} companies`, () => {
      const dashboard = {
        totals: { total_amount: 1234, total_tons: 12 }, branches: [],
        companies: Array.from({ length: count }, (_, index) => ({ rank: index + 1, name: `排行客户${index + 1}`, amount: 1000 - index, tons: count - index })),
      };
      const { RankingBoard } = loadModule("app/features/screens/RankingBoard.tsx", {
        "./useManualScreenData": { useManualScreenData: (_id, loader) => ({ data: loader.name === "readOptions" ? { customers: [], products: [] } : dashboard, parameters: { customerType: "ALL", region: "all", productLine: "all", varieties: null, metric }, error: "", refreshing: false, refreshedAt: null, refresh: () => {} }) },
        "../../api": {},
      });
      const html = renderToStaticMarkup(React.createElement(RankingBoard, { activity: { ...activity, status: "FINISHED" } }));
      assert.equal((html.match(/class="rank-row\b/g) ?? []).length, count);
      assert.equal((html.match(/class="rank-column"/g) ?? []).length, Math.max(1, Math.min(count, 3)));
      if (count) assert.match(html, new RegExp(`>排行客户${count}<`));
      assert.match(html, /1,234\.00/);
    });
  }

}

for (const selected of ["综合客户各大区金额及合计", "综合客户大区金额与项目组金额同屏展示"]) {
  test(`report selection renders district amounts: ${selected}`, () => {
    const { ReportBoard } = loadModule("app/features/screens/ReportBoard.tsx", {
      react: { ...React, useState: (initial) => [initial === "总战绩" ? selected : initial, () => {}] },
      "./useManualScreenData": { useManualScreenData: () => ({ data: regionalReport, error: "", refreshing: false, refreshedAt: null, refresh: () => {} }) },
      "../../api": {},
    });
    const html = renderToStaticMarkup(React.createElement(ReportBoard, { activity }));
    assert.match(html, /metric-table-area/);
    assert.match(html, /<span>华东<\/span><b>120<\/b>/);
    assert.match(html, /<span>未分大区<\/span><b>20<\/b>/);
    assert.match(html, /<span>合计<\/span><b>140<\/b>/);
    assert.doesNotMatch(html, /metric-table-category|片区|区域/);
    if (selected.includes("同屏")) {
      assert.match(html, /综合客户 · 大区/);
      assert.match(html, /metric-table-product/);
      assert.match(html, /<span>酱油<\/span><b>140<\/b>/);
    }
  });
}

test("all public statistics requests forward cancellation without changing URLs or response data", async () => {
  const calls = [];
  const data = { fixture: true };
  const api = loadModule("app/services/api/dashboard.ts", {
    "./client": { api: async (path, init) => { calls.push({ path, init }); return { data }; } },
    "./context": { activeActivityPath: () => "fixture" },
  }, { URLSearchParams });
  const controller = new AbortController();
  assert.equal(await api.loadOrderDashboard(controller.signal), data);
  assert.equal(await api.loadDashboard({ customerType: "GENERAL", regionCode: "NORTH", metric: "TONS" }, controller.signal), data);
  assert.equal(await api.loadDashboardReport("总战绩", controller.signal), data);
  assert.equal(calls[0].path, "/screen/activities/fixture/dashboard");
  assert.equal(calls[1].path, "/screen/activities/fixture/ranking?customerType=GENERAL&regionCode=NORTH&metric=TONS");
  assert.equal(calls[2].path, `/screen/activities/fixture/reports/${encodeURIComponent("总战绩")}`);
  assert.equal(await api.loadActivityOverview(123, controller.signal), data);
  assert.equal(calls[3].path, "/admin/activities/123/overview");
  assert.ok(calls.every(call => call.init.signal === controller.signal));
});

test("ranking sends large multi-variety selections as a read-only JSON query to avoid URL limits", async () => {
  const calls = [];
  const api = loadModule("app/services/api/dashboard.ts", {
    "./client": { api: async (path, init) => { calls.push({ path, init }); return { data: {} }; } },
    "./context": { activeActivityPath: () => "fixture" },
  }, { URLSearchParams });
  const filters = { varieties: Array.from({ length: 200 }, (_,i) => `品种,${i}长名称`), includeUnspecifiedVariety: true, metric: "TONS" };
  const controller = new AbortController();
  await api.loadDashboard(filters, controller.signal);
  assert.equal(calls[0].path, "/screen/activities/fixture/ranking");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), filters);
  assert.equal(calls[0].init.signal, controller.signal);
});
