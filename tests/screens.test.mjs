import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/load-ts-module.mjs";

const domain = loadModule("app/features/screens/dashboard-domain.ts");
const activity = { startsAt: "2026-09-07T09:30:00Z", endsAt: "2026-09-07T13:30:00Z", timezone: "Asia/Shanghai", regions: [] };

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
  assert.equal(model.cards[1].value, "待完善");
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

for (const selected of ["综合客户各大区金额及合计", "综合客户大区金额与项目组金额同屏展示"]) {
  test(`report selection renders district amounts: ${selected}`, () => {
    const { ReportBoard } = loadModule("app/features/screens/ReportBoard.tsx", {
      react: { ...React, useState: (initial) => [initial === "总战绩" ? selected : initial === null ? regionalReport : initial, () => {}] },
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

function refreshHarness(status) {
  let effect;
  let calls = 0;
  const timers = [];
  const events = [];
  const { useOrderDashboard } = loadModule("app/features/screens/useOrderDashboard.ts", {
    react: { useState: (initial) => [initial, () => {}], useRef: (initial) => ({ current: initial }), useCallback: (callback) => callback, useEffect: (callback) => { effect = callback; } },
    "../../api": { ApiError: class ApiError extends Error {}, loadOrderDashboard: async () => { calls++; return null; }, apiBase: () => "http://test/api", getActiveActivityCode: () => "fixture" },
  }, {
    window: { setInterval: (callback, delay) => { timers.push({ callback, delay, cleared: false }); return 0; }, clearInterval: (id) => { timers[id].cleared = true; } },
    EventSource: class {
      constructor(url) { this.url = url; this.listeners = {}; this.closed = false; events.push(this); }
      addEventListener(name, listener) { this.listeners[name] = listener; }
      close() { this.closed = true; }
    },
  });
  function useMount() { const model = useOrderDashboard({ status }); return { model, cleanup: effect() }; }
  return { timers, events, get calls() { return calls; }, mount: useMount };
}

test("live dashboard refreshes initially, by timer and by SSE, and cleans up", async () => {
  const harness = refreshHarness("ACTIVE");
  const { cleanup } = harness.mount();
  await settle();
  assert.equal(harness.calls, 1);
  assert.equal(harness.timers[0].delay, 15000);
  await harness.timers[0].callback();
  harness.events[0].listeners.invalidate(); await settle();
  assert.equal(harness.calls, 3);
  harness.events[0].listeners.open(); await settle();
  assert.equal(harness.calls, 4);
  cleanup();
  assert.equal(harness.timers[0].cleared, true);
  assert.equal(harness.events[0].closed, true);
});

test("historical dashboard loads once without subscriptions and still supports manual refresh", async () => {
  const harness = refreshHarness("FINISHED");
  const { model } = harness.mount();
  await settle();
  assert.equal(harness.calls, 1);
  assert.equal(harness.timers.length, 0);
  assert.equal(harness.events.length, 0);
  await model.refresh();
  assert.equal(harness.calls, 2);
});

test("dashboard ignores a response after effect cleanup", async () => {
  let effect, release;
  const updates=[];
  const {useOrderDashboard}=loadModule("app/features/screens/useOrderDashboard.ts", {
    react: {
      useState: initial=>[initial,value=>updates.push(value)], useRef: initial=>({current:initial}),
      useCallback: callback=>callback, useEffect: callback=>{effect=callback;},
    },
    "../../api": {ApiError:class extends Error{},loadOrderDashboard:()=>new Promise(resolve=>{release=resolve;}),apiBase:()=>"http://test/api",getActiveActivityCode:()=>"fixture"},
  });
  useOrderDashboard({id:1,status:"FINISHED"});
  const cleanup=effect();await settle();
  cleanup();const count=updates.length;release({stale:true});await settle();
  assert.equal(updates.length,count);
});
