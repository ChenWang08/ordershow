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
function screenHarness(screen, optionLoader) {
  const slots = [];
  const effects = [];
  const requests = [];
  const timers = [];
  const subscriptions = [];
  const optionRequests = [];
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
  const defaultOptions = { customers: [
    { customerType: "GENERAL", regionCode: "EAST", regionName: "华东" },
    { customerType: "SPECIAL", regionCode: "WEST", regionName: "西区" },
    { customerType: "ALL", regionName: "未填写" },
  ], products: [{ productLine: "项目A", varietyName: "品种A" }, { productLine: "项目A", varietyName: "品种,B" },
    {}] };
  const api = { loadRankingOptions: (signal, filters) => {
    optionRequests.push({ signal, filters });
    return optionLoader ? optionLoader(signal, filters) : Promise.resolve(defaultOptions);
  },
    ApiError: class extends Error {}, loadOrderDashboard: request, loadDashboard: request, loadDashboardReport: request,
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
  return { requests, optionRequests, timers, subscriptions, render, refresh,
    response: screen === "ranking" ? rankingData : reportData,
    get model() { return tree; },
    get html() { return renderToStaticMarkup(tree); },
    get writes() { return writes; },
    find: predicate => findElement(tree, predicate),
    cleanup() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

for (const screen of ["dashboard", "report"]) {
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

const rankingConfirm = harness => harness.find(node => node.type === "button" && node.props.children === "确认查询").props.onClick();
const selectRanking = async (harness, index, value) => {
  let seen = 0;
  harness.find(node => node.type === "select" && seen++ === index).props.onChange({ target: { value } });
  harness.render();
  await settle(); harness.render();
};
async function openRanking(status = "ACTIVE") {
  const harness = screenHarness("ranking");
  harness.render({ ...activity, status });
  await settle(); harness.render();
  return harness;
}
for (const status of ["ACTIVE", "FINISHED", "ARCHIVED"]) {
  test(`ranking: ${status} reads options on entry and statistics only after confirmation`, async () => {
    const harness = await openRanking(status);
    assert.equal(harness.requests.length, 0);
    assert.match(harness.html, /尚未查询/);
    assert.match(harness.html, /西区/);
    assert.match(harness.html, /品种,B/);
    assert.equal(harness.find(node => node.type.name === "ScreenRefreshControls").props.disabled, true);
    rankingConfirm(harness); rankingConfirm(harness);
    await settle();
    assert.equal(harness.requests.length, 1);
    harness.requests[0].resolve(rankingData(100, status));
    await settle(); harness.render();
    assert.match(harness.html, /当前结果：全部客户/);
    harness.refresh(); await settle();
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.timers.length, 0);
    harness.cleanup();
  });
}
test("ranking: pending edits never affect refresh and failed confirmation retains old results", async () => {
  const harness = await openRanking();
  rankingConfirm(harness); await settle();
  harness.requests[0].resolve(rankingData()); await settle(); harness.render();
  await selectRanking(harness, 0, "SPECIAL");
  await selectRanking(harness, 1, "value:WEST");
  await selectRanking(harness, 2, "value:项目A");
  harness.find(node => node.props.role === "tab" && node.props.children === "吨数排行").props.onClick(); harness.render();
  assert.equal(harness.requests.length, 1);
  assert.match(harness.html, /条件待确认/);
  harness.refresh(); await settle();
  assert.deepEqual({ ...harness.requests[1].args[0] }, { customerType: "ALL", metric: "AMOUNT" });
  harness.requests[1].resolve(rankingData(150)); await settle(); harness.render();
  rankingConfirm(harness); await settle();
  assert.deepEqual({ ...harness.requests[2].args[0] }, { customerType: "SPECIAL", regionCode: "WEST", productLine: "项目A", metric: "TONS" });
  harness.requests[2].reject(new Error("busy")); await settle(); harness.render();
  assert.match(harness.html, /公司订单金额排行/);
  assert.match(harness.html, /当前结果：全部客户/);
  assert.match(harness.html, /150.00/);
  rankingConfirm(harness); await settle();
  harness.requests[3].resolve(rankingData(200)); await settle(); harness.render();
  assert.match(harness.html, /公司订货吨数排行/);
  assert.match(harness.html, /当前结果：特渠专业客户/);
  assert.doesNotMatch(harness.html, /条件待确认/);
  harness.cleanup();
});
test("ranking: option scope changes cancel stale reads, block confirmation on failure and never query statistics", async () => {
  const pending=[];
  const harness=screenHarness("ranking",(signal,filters)=>new Promise((resolve,reject)=>pending.push({signal,filters,resolve,reject})));
  const customers=[{customerType:"GENERAL",regionCode:"EAST",regionName:"华东"},
    {customerType:"SPECIAL",regionCode:"WEST",regionName:"西区"},{customerType:"SPECIAL",regionName:"未填写"}];
  harness.render(); await settle();
  pending[0].resolve({customers,products:[{productLine:"初始项目",varietyName:"初始品种"}]});
  await settle(); harness.render();
  rankingConfirm(harness); await settle();
  harness.requests[0].resolve(rankingData(100)); await settle(); harness.render();
  await selectRanking(harness,0,"GENERAL");
  const general=pending.at(-1);
  assert.equal(harness.find(node=>node.type==="button" && node.props.children==="确认查询").props.disabled,true);
  await selectRanking(harness,0,"SPECIAL");
  assert.equal(general.signal.aborted,true);
  assert.equal(pending.at(-1).filters.customerType,"SPECIAL");
  pending.at(-1).resolve({customers,products:[{productLine:"特渠项目",varietyName:"特渠品种"}]});
  await settle(); harness.render();
  general.resolve({customers,products:[{productLine:"过期综合项目",varietyName:"过期综合品种"}]});
  await settle(); harness.render();
  assert.match(harness.html,/特渠品种/); assert.doesNotMatch(harness.html,/过期综合品种/);
  const requestCount=pending.length;
  await selectRanking(harness,2,"value:特渠项目");
  assert.equal(pending.length,requestCount);
  await selectRanking(harness,1,"empty");
  assert.equal(pending.at(-1).filters.regionUnassigned,true);
  pending.at(-1).reject(new Error("failed options")); await settle(); harness.render();
  assert.equal(harness.find(node=>node.type==="button" && node.props.children==="确认查询").props.disabled,true);
  assert.match(harness.html,/筛选选项加载失败/); assert.match(harness.html,/当前结果：全部客户/);
  assert.equal(harness.requests.length,1);
  harness.find(node=>node.type==="button" && node.props.children==="重试选项").props.onClick(); await settle();
  pending.at(-1).resolve({customers:customers.filter(customer=>customer.regionCode),products:[{}]}); await settle(); harness.render();
  assert.equal(harness.find(node=>node.type==="button" && node.props.children==="确认查询").props.disabled,true);
  assert.match(harness.html,/部分筛选选项已变化/);
  assert.equal(harness.optionRequests.at(-1).filters.regionUnassigned,true);
  await selectRanking(harness,1,"all");
  pending.at(-1).resolve({customers,products:[{}]}); await settle(); harness.render();
  assert.equal(harness.find(node=>node.type==="button" && node.props.children==="确认查询").props.disabled,false);
  assert.equal(harness.requests.length,1);
  harness.cleanup();
});
test("ranking: multi-variety is one request, empty selection is invalid, reset waits for confirmation", async () => {
  const harness = await openRanking();
  harness.find(node => node.type === "input" && node.props.type === "checkbox").props.onChange({ target: { checked: false } }); harness.render();
  assert.equal(harness.find(node => node.type === "button" && node.props.children === "确认查询").props.disabled, true);
  for (const label of ["品种A", "品种,B", "未填写"]) {
    harness.find(node => node.type === "label" && Array.isArray(node.props.children) && node.props.children.includes(label))
      .props.children[0].props.onChange({ target: { checked: true } }); harness.render();
  }
  rankingConfirm(harness); await settle();
  assert.equal(harness.requests.length, 1);
  assert.deepEqual(Array.from(harness.requests[0].args[0].varieties), ["品种A", "品种,B"]);
  assert.equal(harness.requests[0].args[0].includeUnspecifiedVariety, true);
  harness.requests[0].resolve(rankingData()); await settle(); harness.render();
  harness.find(node => node.type === "button" && node.props.children === "重置").props.onClick(); harness.render(); await settle();
  assert.equal(harness.requests.length, 1);
  assert.match(harness.html, /条件待确认/);
  harness.cleanup();
});
test("ranking: changing activity aborts statistics and resets filters without auto-loading", async () => {
  const harness = await openRanking();
  await selectRanking(harness, 0, "GENERAL"); rankingConfirm(harness); await settle();
  harness.render({ ...activity, id: 2 }); await settle(); harness.render();
  assert.equal(harness.requests[0].signal.aborted, true);
  assert.equal(harness.requests.length, 1);
  assert.match(harness.html, /尚未查询/);
  assert.equal(harness.find(node => node.type === "select").props.value, "ALL");
  harness.cleanup();
});

test("ranking: revisiting an activity still waits for confirmation and does not restore old filters or results", async () => {
  const harness = await openRanking();
  await selectRanking(harness, 0, "GENERAL"); rankingConfirm(harness); await settle();
  harness.requests[0].resolve(rankingData(987)); await settle(); harness.render();
  harness.render({ ...activity, id: 2 }); await settle(); harness.render();
  harness.render(activity); await settle(); harness.render();
  assert.equal(harness.requests.length, 1);
  assert.match(harness.html, /尚未查询/);
  assert.doesNotMatch(harness.html, /987.00/);
  assert.equal(harness.find(node => node.type === "select").props.value, "ALL");
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
