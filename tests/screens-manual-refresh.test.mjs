import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/load-ts-module.mjs";

const activity = { id: 1, status: "ACTIVE", regions: [{ code: "EAST", name: "华东" }], availableCustomerTypes: ["GENERAL", "SPECIAL"] };
function rankingData(amount = 100, status = "ACTIVE") {
  return { activityId: 1, status, totals: { total_amount: amount, total_tons: 2 },
    companies: [{ rank: 1, name: "测试客户", amount, tons: 2 }], branches: [], productLines: [], latestOrders: [], generatedAt: "2026-10-29T08:00:00Z" };
}
function reportData(amount = 100, status = "ACTIVE") {
  return { dashboard: rankingData(amount, status), customerTypes: [], regions: [], generalProductLines: [], specialProductLines: [],
    giftCustomerTypes: [], topGeneral: [{ rank: 1, name: "测试客户", amount }], topSpecial: [], trend: [], regionProductLines: [], generalRegions: [] };
}

function findElement(node, predicate) {
  if (Array.isArray(node)) return node.map(child => findElement(child, predicate)).find(Boolean);
  if (!React.isValidElement(node)) return null;
  return predicate(node) ? node : findElement(node.props.children, predicate);
}

// Keep hook state and dependency tracking across renders, while controlling real API promises.
function screenHarness(screen) {
  const slots = [];
  const effects = [];
  const requests = [];
  const timers = [];
  const subscriptions = [];
  let cursor = 0;
  let currentActivity = activity;
  let tree;
  let writes = 0;
  function memo(factory, dependencies) {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      slots[index] = { value: factory(), dependencies };
    }
    return slots[index].value;
  }
  const react = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, value => {
        writes++;
        slots[index].value = typeof value === "function" ? value(slots[index].value) : value;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo: memo,
    useCallback: (callback, dependencies) => memo(() => callback, dependencies),
    useEffect(callback, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[index] = { dependencies, cleanup: callback() };
        });
      }
    },
  };
  const request = (...args) => new Promise((resolve, reject) => {
    const signal = args.at(-1);
    requests.push({ args, signal, resolve, reject });
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  const api = { ApiError: class extends Error {}, loadOrderDashboard: request, loadDashboard: request, loadDashboardReport: request,
    apiBase: () => "http://test/api", getActiveActivityCode: () => "fixture" };
  const globals = {
    window: { setInterval: (...args) => timers.push(args), clearInterval() {}, addEventListener: (...args) => subscriptions.push(args) },
    EventSource: class { constructor(...args) { subscriptions.push(args); } addEventListener() {} close() {} },
  };
  const filename = screen === "dashboard" ? "useOrderDashboard.ts" : screen === "ranking" ? "RankingBoard.tsx" : "ReportBoard.tsx";
  const loaded = loadModule(`app/features/screens/${filename}`, { react, "../../api": api }, globals);
  const component = screen === "dashboard" ? value => loaded.useOrderDashboard(value) : value => loaded[screen === "ranking" ? "RankingBoard" : "ReportBoard"]({ activity: value });
  function render(value = currentActivity) {
    currentActivity = value;
    cursor = 0;
    tree = component(value);
    while (effects.length) effects.shift()();
    return tree;
  }
  function refresh() {
    return screen === "dashboard" ? tree.refresh() : findElement(tree, node => node.type.name === "ScreenRefreshControls").props.onRefresh();
  }
  return { requests, timers, subscriptions, render, refresh,
    response: screen === "ranking" ? rankingData : reportData,
    get model() { return tree; },
    get html() { return renderToStaticMarkup(tree); },
    get writes() { return writes; },
    find: predicate => findElement(tree, predicate),
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

for (const screen of ["dashboard", "ranking", "report"]) {
  for (const status of ["ACTIVE", "FINISHED", "ARCHIVED"]) {
    test(`${screen}: ${status} loads once and reads again only on manual refresh`, async () => {
      const harness = screenHarness(screen);
      harness.render({ ...activity, status });
      await settle();
      assert.equal(harness.requests.length, 1);
      harness.requests[0].resolve(harness.response(100, status));
      await settle();
      harness.render();
      assert.equal(harness.timers.length, 0);
      assert.equal(harness.subscriptions.length, 0);
      harness.render({ ...activity, status, name: "更新活动资料" });
      await settle();
      assert.equal(harness.requests.length, 1);
      harness.refresh();
      await settle();
      assert.equal(harness.requests.length, 2);
      harness.requests[1].resolve(harness.response(200, status));
      await settle();
      harness.render();
      if (screen === "dashboard") assert.equal(harness.model.data.dashboard.totals.total_amount, 200);
      else assert.match(harness.html, /200/);
      harness.cleanup();
    });
  }

  test(`${screen}: waits for activity metadata and cancels reads when switching activities`, async () => {
    const harness = screenHarness(screen);
    harness.render(null);
    await settle();
    assert.equal(harness.requests.length, 0);
    harness.render(activity);
    await settle();
    assert.equal(harness.requests.length, 1);
    harness.render({ ...activity, id: 2 });
    assert.equal(harness.requests[0].signal.aborted, true);
    await settle();
    assert.equal(harness.requests.length, 2);
    harness.requests[1].resolve(harness.response(200));
    await settle();
    harness.render();
    const writes = harness.writes;
    harness.requests[0].resolve(harness.response(999));
    await settle();
    assert.equal(harness.writes, writes);
    harness.cleanup();
  });

  test(`${screen}: repeated clicks share a request without scheduling a trailing read`, async () => {
    const harness = screenHarness(screen);
    harness.render();
    await settle();
    harness.refresh(); harness.refresh(); harness.refresh();
    assert.equal(harness.requests.length, 1);
    harness.requests[0].resolve(harness.response());
    await settle();
    harness.render();
    assert.equal(harness.requests.length, 1);
    harness.refresh(); harness.refresh(); harness.refresh();
    await settle();
    assert.equal(harness.requests.length, 2);
    harness.requests[1].resolve(harness.response());
    await settle();
    assert.equal(harness.requests.length, 2);
    harness.cleanup();
  });

  test(`${screen}: failed refresh retains data and last success time, then supports retry`, async () => {
    const harness = screenHarness(screen);
    harness.render();
    await settle();
    harness.requests[0].resolve(harness.response(12345));
    await settle();
    harness.render();
    const controls = () => harness.find(node => node.type.name === "ScreenRefreshControls").props;
    const refreshedAt = screen === "dashboard" ? harness.model.refreshedAt : controls().refreshedAt;
    assert.ok(refreshedAt);
    harness.refresh();
    await settle();
    harness.requests[1].reject(new Error("offline"));
    await settle();
    harness.render();
    if (screen === "dashboard") {
      assert.equal(harness.model.data.dashboard.totals.total_amount, 12345);
      assert.equal(harness.model.refreshedAt, refreshedAt);
      assert.equal(harness.model.refreshing, false);
      assert.ok(harness.model.error);
    } else {
      assert.match(harness.html, /12,345/);
      assert.match(harness.html, /当前显示上次成功加载的数据/);
      assert.equal(controls().refreshedAt, refreshedAt);
      assert.equal(controls().refreshing, false);
    }
    harness.refresh();
    await settle();
    assert.equal(harness.requests.length, 3);
    harness.requests[2].resolve(harness.response(200));
    await settle();
    harness.render();
    if (screen === "dashboard") assert.equal(harness.model.error, "");
    else assert.doesNotMatch(harness.html, /刷新失败/);
    harness.cleanup();
  });

  test(`${screen}: unmount aborts an in-flight read without writing state`, async () => {
    const harness = screenHarness(screen);
    harness.render();
    await settle();
    harness.cleanup();
    const writes = harness.writes;
    await settle();
    assert.equal(harness.requests[0].signal.aborted, true);
    assert.equal(harness.writes, writes);
    harness.refresh();
    await settle();
    assert.equal(harness.requests.length, 1);
  });
}

test("ranking filters stay pending until refresh succeeds, with old headings retained on failure", async () => {
  const harness = screenHarness("ranking");
  harness.render();
  await settle();
  harness.requests[0].resolve(rankingData());
  await settle();
  harness.render();
  harness.find(node => node.props.role === "tab" && node.props.children === "吨数排行").props.onClick();
  harness.render();
  harness.find(node => node.type === "select").props.onChange({ target: { value: "GENERAL:EAST" } });
  harness.render();
  await settle();
  assert.equal(harness.requests.length, 1);
  assert.match(harness.html, /筛选待应用/);
  assert.match(harness.html, /公司订单金额排行/);
  assert.match(harness.html, /全部客户订货排行/);
  harness.refresh();
  await settle();
  assert.deepEqual({ ...harness.requests[1].args[0] }, { customerType: "GENERAL", regionCode: "EAST", metric: "TONS" });
  harness.requests[1].reject(new Error("busy"));
  await settle();
  harness.render();
  assert.match(harness.html, /公司订单金额排行/);
  assert.match(harness.html, /筛选待应用/);
  harness.refresh();
  await settle();
  harness.requests[2].resolve(rankingData(200));
  await settle();
  harness.render();
  assert.match(harness.html, /公司订货吨数排行/);
  assert.match(harness.html, /综合华东订货吨数排行/);
  assert.doesNotMatch(harness.html, /筛选待应用/);
  harness.cleanup();
});

test("report switching displays the loaded dataset without creating subscriptions or reads", async () => {
  const harness = screenHarness("report");
  harness.render();
  await settle();
  harness.requests[0].resolve(reportData());
  await settle();
  harness.render();
  harness.find(node => node.type === "select").props.onChange({ target: { value: "综合客户 TOP5" } });
  harness.render();
  await settle();
  assert.equal(harness.requests.length, 1);
  assert.match(harness.html, /测试客户/);
  assert.match(harness.html, /top-five/);
  harness.refresh();
  await settle();
  assert.equal(harness.requests.length, 2);
  assert.equal(harness.requests[1].args[0], "综合客户 TOP5");
  harness.cleanup();
  await settle();
});

test("untyped activity report remains unavailable without requesting data", async () => {
  const harness = screenHarness("report");
  harness.render({ ...activity, whitelistCustomerTypeMode: "UNSPECIFIED" });
  await settle();
  harness.refresh();
  await settle();
  assert.equal(harness.requests.length, 0);
  assert.match(harness.html, /暂不展示专题战报数据/);
  assert.equal(harness.find(node => node.type.name === "ScreenRefreshControls").props.disabled, true);
  harness.cleanup();
});

test("refresh controls show Beijing time, disable during reads, and avoid realtime labels", () => {
  const { ScreenRefreshControls } = loadModule("app/features/screens/ScreenRefreshControls.tsx");
  const html = renderToStaticMarkup(React.createElement(ScreenRefreshControls, {
    refreshing: true, refreshedAt: "2026-10-29T08:00:00Z", historical: false, onRefresh() {},
  }));
  assert.match(html, /手动更新/);
  assert.match(html, /刷新中/);
  assert.match(html, /disabled/);
  assert.match(html, /16:00:00/);
  assert.doesNotMatch(html, /LIVE|实时/);
});
