import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";

const { ApiError } = loadModule("app/services/api/client.ts");
const context = { customerCount: 20, customersByType: { GENERAL: 15, SPECIAL: 5 }, customerTypeMode: "TYPED", attendeeCount: 4, whitelistPublished: true };
const dashboard = { totals: { order_count: 10, total_amount: 100, total_quantity: 20, total_tons: 2 } };
const overview = { ...dashboard, ...context, submittedByType: { GENERAL: 8, SPECIAL: 2 } };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test("overview is never auto-loaded, shares repeated clicks, and commits all statistics and counts together", async () => {
  const calls = [], counts = deferred();
  const h = hookHarness("app/features/admin/useActivityOverview.ts", "useActivityOverview", ["1", true], {
    "../../api": {
      loadActivityOverview: (id, signal) => { calls.push({ id, signal }); return counts.promise; },
    },
  });
  await h.flush();
  assert.equal(calls.length, 0);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.model.loaded, false);
  assert.ok(h.model.adminStats.every(row => row[1] === "—"));
  const first = h.model.refresh();
  assert.equal(h.model.refresh(), first);
  await h.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 1);
  assert.equal(calls[0].signal.aborted, false);
  assert.equal(h.model.loaded, false, "statistics and counts must publish together");
  counts.resolve(overview); await first; await h.flush();
  assert.equal(h.model.loaded, true);
  assert.equal(h.model.progressRows[0].total, 20);
  assert.equal(h.model.progressRows[0].submitted, 10);
  assert.equal(h.model.progressRows[1].submitted, 8);
  assert.equal(h.model.progressRows[2].submitted, 2);
  const time = h.model.updatedAt;
  for (let i = 0; i < 10; i++) h.render();
  await h.flush();
  assert.equal(calls.length, 1, "tab switches/rerenders must not reload the snapshot");
  assert.equal(h.model.updatedAt, time);
  h.unmount();
});

test("overview failure preserves the last complete snapshot and timestamp; activity switch hides old data", async () => {
  let fail = false;
  const h = hookHarness("app/features/admin/useActivityOverview.ts", "useActivityOverview", ["1", true], {
    "../../api": { loadActivityOverview: async () => { if(fail) throw new Error("503"); return overview; } },
  });
  await h.model.refresh(); await h.flush();
  const time = h.model.updatedAt;
  fail = true; await h.model.refresh(); await h.flush();
  assert.equal(h.model.loaded, true);
  assert.equal(h.model.updatedAt, time);
  assert.match(h.model.error, /503|加载失败/);
  h.render(["2", true]);
  assert.equal(h.model.loaded, false);
  assert.equal(h.model.updatedAt, null);
  h.unmount();
});

for (const type of ["GENERAL", "SPECIAL", "ALL"]) {
  test(`overview preserves single-channel and unspecified progress: ${type}`, async () => {
    const h = hookHarness("app/features/admin/useActivityOverview.ts", "useActivityOverview", ["1", true], {
      "../../api": { loadActivityOverview: async () => ({ ...dashboard, customerCount: 20,
        customersByType: { [type]: 20 }, submittedByType: { [type]: 10 },
        customerTypeMode: type === "ALL" ? "UNSPECIFIED" : "TYPED" }) },
    });
    await h.model.refresh(); await h.flush();
    assert.equal(h.model.progressRows[0].submitted, 10);
    assert.equal(h.model.progressRows[0].percentage, 50);
    assert.deepEqual(Array.from(h.model.progressRows.slice(1), row => [row.total, row.submitted]),
      type === "GENERAL" ? [[20,10],[0,0]] : type === "SPECIAL" ? [[0,0],[20,10]] : [[0,0],[0,0]]);
    h.unmount();
  });
}

test("obsolete activity reads are cancelled and cannot overwrite the next activity or unmounted state", async () => {
  const pending = [], loader = (key, signal) => { const d = deferred(); pending.push({ key, signal, ...d }); return d.promise; };
  const h = hookHarness("app/features/admin/useAdminQuery.ts", "useAdminQuery", ["1", loader]);
  void h.model.refresh(); await h.flush();
  h.render(["2", loader]);
  assert.equal(pending[0].signal.aborted, true);
  void h.model.refresh(); await h.flush();
  pending[1].resolve("new"); await h.flush();
  pending[0].resolve("old"); await h.flush();
  assert.equal(h.model.data, "new");
  void h.model.refresh(); await h.flush();
  h.unmount(); const writes = h.writes;
  pending[2].resolve("late"); await h.flush();
  assert.equal(h.writes, writes);
});

test("module counts load only in a relevant module, on mutation or on explicit refresh", async () => {
  let reads = 0;
  const h = hookHarness("app/features/admin/useModuleContext.ts", "useModuleContext", ["1", null, 0], {
    "../../api": { loadModuleContext: async () => { reads++; return context; } },
  });
  await h.flush(); assert.equal(reads, 0);
  h.render(["1", "白名单", 0]); await h.flush(); assert.equal(reads, 1);
  h.render(); await h.flush(); assert.equal(reads, 1);
  h.render(["1", "白名单", 1]); await h.flush(); assert.equal(reads, 2);
  h.render(["1", "现场到场", 1]); await h.flush(); assert.equal(reads, 2);
  h.render(["1", null, 2]); await h.flush(); assert.equal(reads, 2);
  h.render(["1", "商品导入", 2]); await h.flush(); assert.equal(reads, 3);
  await h.model.refresh(); await h.flush(); assert.equal(reads, 4);
  assert.equal(h.intervals.size, 0); h.unmount();
});

test("review queries only start on entry/filter/manual refresh and re-read after approval", async () => {
  let reads = 0, changed = 0;
  const onChanged = () => { changed++; };
  const h = hookHarness("app/components/orders/useOrderChangeRequests.ts", "useOrderChangeRequests", [1, onChanged, false], {
    "../../api": { ApiError,
      loadOrderChangePage: async () => { reads++; return { data: [], page: { totalElements: 1 } }; },
      loadPendingOrderChanges: async () => [{ id: 3, orderId: 4 }],
      approveAdminOrderChangeRequest: async () => ({ id: 3, status: "APPROVED" }),
    },
  });
  await h.runTimers(); assert.equal(reads, 0); assert.equal(h.model.loaded, false);
  h.render([1, onChanged, true]); await h.runTimers(); assert.equal(reads, 1);
  h.model.setFilters({ ...h.model.filters, page: 2 }); await h.flush(); await h.runTimers(); assert.equal(reads, 2);
  await h.model.reload(); await h.flush(); assert.equal(reads, 3);
  h.model.setSelected({ id: 3 }); await h.flush(); await h.model.review(true); await h.flush();
  assert.equal(reads, 4); assert.equal(changed, 1);
  h.render([1, onChanged, false]); await h.runTimers(); assert.equal(reads, 4);
  assert.equal(h.intervals.size, 0); h.unmount();
});

test("admin runtime remains on-demand; public runtime opens only the independent activity stream", async () => {
  const activity = { id: 1, name: "活动", status: "ACTIVE", startsAt: "2099-01-01T00:00:00Z", endsAt: "2099-01-02T00:00:00Z" };
  for (const admin of [true, false]) {
    let reads = 0, connections = 0;
    const h = hookHarness("app/features/workspace/useActivityRuntime.ts", "useActivityRuntime", admin ? [activity] : [], {
      "../../api": { getActiveActivityCode: () => "A", subscribeActiveActivityCode: () => () => {},
        loadActivity: async () => { reads++; return activity; }, loadPublicLottery: async () => ({ rules: [] }) },
      "../../services/api/activity-info-stream": { subscribeActivityInfo: (_code, handlers) => {
        connections++; handlers.onActivity(activity); handlers.onState("connected"); return () => {};
      } },
      "../lottery/Lottery": { initialLotteryRounds: [], mapLotteryRule: () => [] },
    });
    await h.flush();
    assert.equal(h.intervals.size, 0);
    assert.equal(reads, 0); assert.equal(connections, admin ? 0 : 1);
    h.unmount(); assert.equal(h.intervals.size, 0);
  }
});

test("the four admin-only hooks contain no interval polling", () => {
  for (const path of ["useActivityOverview.ts", "useModuleContext.ts", "AdminGateway.tsx"]) {
    assert.doesNotMatch(readFileSync(new URL(`../app/features/admin/${path}`, import.meta.url), "utf8"), /setInterval/);
  }
  assert.doesNotMatch(readFileSync(new URL("../app/components/orders/useOrderChangeRequests.ts", import.meta.url), "utf8"), /setInterval/);
});

test("manual activity refresh confirms dirty fields, never reads statistics, and preserves drafts on failure", async () => {
  let allow = false, fail = false, reads = 0;
  const confirmations = [], applied = [], notices = [];
  const options = { activityId: "1", activityCode: "A", activityName: "旧活动", activityStatus: "draft",
    activityStartAt: "2099-01-01T08:00", activityEndAt: "2099-01-02T08:00", activityEventEndAt: "2099-01-03T08:00",
    onActivityNameChange: () => {}, onActivityStartAtChange: () => {}, onActivityEndAtChange: () => {},
    onActivityEventEndAtChange: () => {}, onActivityStatusChange: () => {},
    setActionNotice: value => notices.push(value), onActivityLoaded: value => applied.push(value),
  };
  const h = hookHarness("app/features/admin/useActivitySettings.ts", "useActivitySettings", [options], {
    "../../api": { ApiError, loadAdminActivity: async () => {
      reads++; if(fail) throw new ApiError(503, "BUSY", "服务繁忙");
      return { id: 1, name: "新活动", status: "CLOSED", startsAt: "2099-01-01T00:00:00Z", endsAt: "2099-01-02T00:00:00Z", eventEndsAt: "2099-01-03T00:00:00Z" };
    } },
  }, { window: { confirm: message => { confirmations.push(message); return allow; } } });
  await h.flush(); assert.equal(reads, 0);
  h.model.setActivityNameDraft("未保存修改"); await h.flush();
  await h.model.refreshActivity(); await h.flush();
  assert.equal(reads, 0); assert.equal(h.model.activityNameDraft, "未保存修改");
  allow = true; fail = true;
  await h.model.refreshActivity(); await h.flush();
  assert.equal(reads, 1); assert.equal(h.model.activityNameDraft, "未保存修改");
  assert.ok(h.model.activityRefreshError);
  fail = false;
  await Promise.all([h.model.refreshActivity(), h.model.refreshActivity()]); await h.flush();
  assert.equal(reads, 2); assert.equal(h.model.activityNameDraft, "新活动");
  assert.equal(applied.length, 1); assert.ok(confirmations.length >= 2);
  assert.equal(h.intervals.size, 0); h.unmount();
});

test("force refresh after mutation aborts a pre-mutation query and ignores its late result", async () => {
  const pending = [], loader = (_key, signal) => { const d = deferred(); pending.push({ signal, ...d }); return d.promise; };
  const h = hookHarness("app/features/admin/useAdminQuery.ts", "useAdminQuery", ["1", loader]);
  void h.model.refresh(); await h.flush();
  void h.model.refresh(true); await h.flush();
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve("after mutation"); await h.flush();
  pending[0].resolve("before mutation"); await h.flush();
  assert.equal(h.model.data, "after mutation"); h.unmount();
});

test("admin access events distinguish expired login, revoked permission, missing activity and business denial", async () => {
  const events = [];
  const { api } = loadModule("app/services/api/client.ts", {}, {
    process: { env: { NEXT_PUBLIC_API_BASE: "http://fixture/api/v1" } }, Headers, Event, FormData,
    window: { dispatchEvent: event => events.push(event.type) }, document: { cookie: "" },
    fetch: async (_url, init) => {
      const { status, code } = JSON.parse(init.body);
      return { status, ok: false, headers: new Headers({ "Content-Type": "application/json" }), json: async () => ({ code }) };
    },
  });
  for (const [path, status, code, expected] of [
    ["/admin/activities/1/orders", 401, "UNAUTHORIZED", ["admin-session-invalid"]],
    ["/admin/activities/1/orders", 403, "MODULE_PERMISSION_REQUIRED", ["admin-permissions-changed"]],
    ["/admin/activities/1/orders", 404, "ACTIVITY_NOT_FOUND", ["admin-access-invalid"]],
    ["/admin/activities/1/orders", 403, "BUSINESS_DENIED", []],
    ["/admin/activities/1/orders", 500, "INTERNAL_ERROR", []],
    ["/admin/activities/1/orders", 503, "BUSY", []],
    ["/h5/activities/1/order", 401, "UNAUTHORIZED", []],
    ["/admin/auth/login", 401, "UNAUTHORIZED", []],
  ]) {
    events.length = 0;
    await assert.rejects(api(path, { method: "POST", body: JSON.stringify({ status, code }) }));
    assert.deepEqual(events, expected);
  }
});
