import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";
import { hookHarness } from "./helpers/hook-harness.mjs";

const activity = { id: 1, code: "A", name: "活动", status: "ACTIVE", configuredStatus: "ACTIVE",
  startsAt: "2026-01-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z", regions: [] };
const snapshot = (version = "1", changes = {}, time = "2026-10-31T01:00:00Z") => ({
  activityId: 1, version, serverTime: time, heartbeatIntervalMs: 30_000, activity: { ...activity, ...changes },
});

function fixture(supported = true) {
  let now = 0, sequence = 0;
  const timers = new Map(), sources = [], updates = [], states = [];
  function surface() {
    const listeners = new Map();
    return { listeners,
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      emit(type) { for (const fn of listeners.get(type) ?? []) fn({ type }); },
    };
  }
  const document = { ...surface(), visibilityState: "visible" };
  const window = { ...surface(),
    setTimeout(fn, delay) { timers.set(++sequence, { fn, due: now + delay }); return sequence; },
    clearTimeout(id) { timers.delete(id); },
  };
  class Source {
    constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; sources.push(this); }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    close() { this.closed = true; }
    emit(type, value) { this.listeners.get(type)?.({ data: JSON.stringify(value) }); }
    fail() { this.onerror?.(); }
  }
  const stream = loadModule("app/services/api/activity-info-stream.ts", { "./client": { apiBase: () => "http://fixture/api/v1" } }, {
    document, window, EventSource: supported ? Source : undefined, Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
  });
  const stop = stream.subscribeActivityInfo("A", { onActivity: value => updates.push(value), onState: value => states.push(value) });
  const advance = milliseconds => {
    const end = now + milliseconds;
    for (;;) {
      const next = [...timers].filter(([, task]) => task.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      now = next[1].due; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  };
  return { sources, updates, states, timers, window, document, stop, advance };
}

test("one public connection supplies the initial snapshot; heartbeats and unrelated events never fetch data", () => {
  const f = fixture(), source = f.sources[0];
  assert.equal(source.url, "http://fixture/api/v1/public/activities/A/events");
  assert.equal(f.updates.length, 0);
  source.emit("activity", snapshot());
  assert.equal(f.updates[0].name, "活动");
  assert.equal(f.states.at(-1), "connected");
  for (let i = 0; i < 8; i++) {
    f.advance(30_000); source.emit("heartbeat", { heartbeatIntervalMs: 30_000 });
    source.emit("invalidate", { eventType: "ORDER_SUBMITTED" });
    source.emit("catalog-changed", { activityId: 1 });
  }
  assert.equal(f.sources.length, 1); assert.equal(f.updates.length, 1);
  f.stop(); assert.equal(source.closed, true); assert.equal(f.timers.size, 0);
});

test("BIGINT versions, duplicates, late snapshots and time-derived statuses never restore stale data", () => {
  const f = fixture(), source = f.sources[0];
  source.emit("activity", snapshot("9007199254740993", { name: "最新" }));
  source.emit("activity", snapshot("9007199254740992", { name: "旧" }, "2026-10-31T02:00:00Z"));
  source.emit("activity", snapshot("9007199254740993", { name: "最新" }));
  assert.equal(f.updates.length, 1);
  source.emit("activity", snapshot("9007199254740993", { name: "最新", status: "CLOSED" }, "2026-10-31T01:01:00Z"));
  source.emit("activity", snapshot("9007199254740993", { name: "最新" }, "2026-10-31T01:00:30Z"));
  assert.equal(f.updates.length, 2); assert.equal(f.updates.at(-1).status, "CLOSED");
  source.emit("activity", snapshot("9007199254740994", { liveRoomUrl: "https://example.com/new" }));
  assert.equal(f.updates.length, 3); assert.equal(f.updates.at(-1).liveRoomUrl, "https://example.com/new");
  f.stop();
});

test("network/500/503 failures back off, share retries and retain the last snapshot until recovery", () => {
  const f = fixture();
  f.sources[0].emit("activity", snapshot());
  f.sources[0].fail(); f.sources[0].fail();
  assert.equal(f.updates.length, 1); assert.equal(f.states.at(-1), "connecting");
  f.advance(1999); assert.equal(f.sources.length, 1);
  f.advance(1); assert.equal(f.sources.length, 2); f.sources[1].fail();
  f.window.emit("focus"); f.window.emit("pageshow");
  f.advance(3999); assert.equal(f.sources.length, 2);
  f.advance(1); assert.equal(f.sources.length, 3); f.sources[2].fail();
  f.advance(8000); assert.equal(f.sources.length, 4);
  f.sources[3].emit("activity", snapshot("2", { name: "恢复" }));
  assert.equal(f.updates.at(-1).name, "恢复");
  f.sources[0].emit("activity", snapshot("999", { name: "旧连接" }));
  assert.equal(f.updates.at(-1).name, "恢复");
  f.sources[3].fail(); f.advance(2000); assert.equal(f.sources.length, 5);
  f.stop(); f.advance(1_000_000); assert.equal(f.sources.length, 5);
});

test("a silent connection is closed by the watchdog; configurable heartbeat intervals are respected", () => {
  const f = fixture(); f.sources[0].emit("activity", { ...snapshot(), heartbeatIntervalMs: 60_000 });
  f.advance(90_000); assert.equal(f.sources[0].closed, false);
  f.advance(90_000); assert.equal(f.sources[0].closed, true);
  f.advance(2000); assert.equal(f.sources.length, 2);
  f.stop();
});

test("hidden pages and bfcache release the stream; visibility/focus/pageshow resume only once", () => {
  const f = fixture(); f.sources[0].emit("activity", snapshot());
  f.document.visibilityState = "hidden"; f.document.emit("visibilitychange");
  assert.equal(f.sources[0].closed, true); assert.equal(f.timers.size, 0);
  f.advance(600_000); assert.equal(f.sources.length, 1);
  f.document.visibilityState = "visible"; f.document.emit("visibilitychange");
  f.window.emit("focus"); f.window.emit("pageshow");
  assert.equal(f.sources.length, 2);
  f.sources[1].emit("activity", snapshot("2", { status: "ACTIVE", endsAt: "2099-01-02T00:00:00Z" }));
  f.window.emit("pagehide"); assert.equal(f.sources[1].closed, true);
  f.window.emit("pageshow"); assert.equal(f.sources.length, 3);
  f.stop();
  for (const surface of [f.window, f.document]) for (const listeners of surface.listeners.values()) assert.equal(listeners.size, 0);
});

test("unavailable activities and unsupported browsers do not create retry storms or polling fallbacks", () => {
  const f = fixture(); f.sources[0].emit("unavailable", { code: "ACTIVITY_NOT_FOUND" });
  f.advance(600_000); f.window.emit("focus");
  assert.equal(f.sources.length, 1); assert.equal(f.states.at(-1), "unavailable"); f.stop();
  const unsupported = fixture(false);
  assert.equal(unsupported.states.at(-1), "unsupported"); assert.equal(unsupported.timers.size, 0); unsupported.stop();
});

test("a malformed or cross-activity snapshot is rejected and retried, never displayed", () => {
  const f = fixture(); f.sources[0].emit("activity", snapshot("1", { code: "OTHER" }));
  assert.equal(f.updates.length, 0); assert.equal(f.sources[0].closed, true);
  f.advance(2000); f.sources[1].emit("activity", snapshot()); assert.equal(f.updates.length, 1); f.stop();
});

test("public activity/H5 initialization never loads lottery data and disconnection preserves the loaded activity", async () => {
  let handlers, cleanups = 0, lotteryReads = 0;
  const h = hookHarness("app/features/workspace/useActivityRuntime.ts", "useActivityRuntime", [], {
    "../../api": { getActiveActivityCode: () => "A", subscribeActiveActivityCode: () => () => {},
      loadPublicLottery: async () => { lotteryReads++; return { rules: [] }; } },
    "../../services/api/activity-info-stream": { subscribeActivityInfo: (_code, value) => { handlers = value; return () => cleanups++; } },
    "../lottery/Lottery": { initialLotteryRounds: [], mapLotteryRule: () => [] },
  });
  await h.flush(); handlers.onActivity(activity); handlers.onState("connected"); await h.flush();
  const current = h.model.runtimeActivity;
  assert.equal(h.model.runtimeLoaded, true); assert.equal(h.model.runtimeConnected, true);
  handlers.onState("connecting"); await h.flush();
  assert.equal(h.model.runtimeActivity, current); assert.equal(h.model.runtimeLoaded, true);
  assert.match(h.model.runtimeMessage, /重新同步/); assert.equal(h.intervals.size, 0);
  assert.equal(lotteryReads, 0);
  h.unmount(); assert.equal(cleanups, 1);
});

test("activity switching disposes the previous stream and ignores its late callbacks", async () => {
  let code = "A", changed, lotteryReads = 0;
  const subscriptions = [];
  const h = hookHarness("app/features/workspace/useActivityRuntime.ts", "useActivityRuntime", [], {
    "../../api": { getActiveActivityCode: () => code, subscribeActiveActivityCode: fn => { changed = fn; return () => {}; },
      loadPublicLottery: async () => { lotteryReads++; return { rules: [] }; } },
    "../../services/api/activity-info-stream": { subscribeActivityInfo: (key, handlers) => {
      const subscription = { key, handlers, closed: false }; subscriptions.push(subscription); return () => { subscription.closed = true; };
    } }, "../lottery/Lottery": { initialLotteryRounds: [], mapLotteryRule: () => [] },
  });
  await h.flush(); subscriptions[0].handlers.onActivity(activity); await h.flush();
  code = "B"; changed(); await h.flush();
  assert.equal(subscriptions[0].closed, true); assert.equal(h.model.runtimeActivity, null);
  subscriptions[1].handlers.onActivity({ ...activity, id: 2, code: "B", name: "新活动" });
  subscriptions[0].handlers.onActivity(activity); await h.flush();
  assert.equal(h.model.runtimeActivity.code, "B"); assert.equal(lotteryReads, 0); h.unmount();
});

test("the legacy H5 entry still resolves /current while the unused activity GET helper is absent", async () => {
  const calls = [];
  const api = loadModule("app/services/api/activity.ts", {
    "./client": { api: async path => { calls.push(path); return { data: activity }; } },
  });
  assert.equal(await api.loadCurrentActivity(), activity);
  assert.deepEqual(calls, ["/public/activities/current"]);
  assert.equal(Object.hasOwn(api, "loadActivity"), false);
});
