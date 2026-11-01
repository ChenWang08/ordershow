import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { loadModule } from "./helpers/load-ts-module.mjs";
import { hookHarness } from "./helpers/hook-harness.mjs";

const activity = { id: 1, code: "A", name: "活动", status: "ACTIVE", configuredStatus: "ACTIVE",
  startsAt: "2026-01-01T00:00:00Z", endsAt: "2099-01-01T00:00:00Z", regions: [] };
const response = (value = activity, tag = 'W/"1-ACTIVE"', status = 200) => ({ status, ok: status === 200,
  headers: new Headers({ ETag: tag }), json: async () => ({ data: value }) });

function fixture() {
  let now = 0, sequence = 0;
  const timers = new Map(), calls = [], updates = [], states = [], replies = [];
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
  const http = loadModule("app/services/api/activity-info-http.ts", { "./client": { apiBase: () => "http://fixture/api/v1" } }, {
    document, window, fetch: async (url, options) => {
      calls.push({ url, options }); const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return reply === undefined ? response() : await reply;
    }, EventSource: class { constructor() { throw new Error("Activity SSE is forbidden"); } },
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
  });
  const stop = http.subscribeActivityInfo("A", { onActivity: value => updates.push(value), onState: value => states.push(value) });
  const advance = async milliseconds => {
    const end = now + milliseconds;
    for (;;) {
      const next = [...timers].filter(([, task]) => task.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      now = next[1].due; timers.delete(next[0]); next[1].fn(); await settle();
    }
    now = end; await settle();
  };
  return { calls, updates, states, timers, window, document, replies, stop, advance };
}

test("initial HTTP JSON is immediate; later 30s conditional checks use ETag and 304 preserves object identity", async () => {
  const f = fixture(); await settle();
  assert.equal(f.calls[0].url, "http://fixture/api/v1/public/activities/A");
  assert.equal(f.calls[0].options.headers["If-None-Match"], undefined);
  assert.equal(f.states.at(-1), "connected"); assert.equal(f.updates.length, 1);
  f.replies.push(response(null, 'W/"1-ACTIVE"', 304));
  await f.advance(29_999); assert.equal(f.calls.length, 1);
  await f.advance(1); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].options.headers["If-None-Match"], 'W/"1-ACTIVE"'); assert.equal(f.updates.length, 1);
  f.replies.push(response({ ...activity, name: "更新", status: "CLOSED" }, 'W/"2-CLOSED"'));
  await f.advance(30_000); assert.equal(f.updates.at(-1).name, "更新");
  f.stop(); assert.equal(f.timers.size, 0);
});

test("failures retain metadata, expose error and retry with backoff; online and user retry coalesce", async () => {
  const f = fixture(); await settle(); const original = f.updates[0];
  f.replies.push(new Error("offline")); await f.advance(30_000);
  assert.equal(f.states.at(-1), "error"); assert.equal(f.updates[0], original);
  f.replies.push(new Error("503")); await f.advance(2000); assert.equal(f.calls.length, 3);
  await f.advance(3999); assert.equal(f.calls.length, 3);
  f.window.emit("online"); f.stop.retry(); await settle();
  assert.equal(f.calls.length, 4); assert.equal(f.states.at(-1), "connected"); f.stop();
});

test("10s timeout covers stalled JSON and manual retry works without an infinite loading state", async () => {
  const f = fixture(); await settle();
  f.replies.push({ ...response(), json: () => new Promise(() => {}) });
  await f.advance(30_000); const stalled = f.calls.at(-1);
  await f.advance(10_000); assert.equal(stalled.options.signal.aborted, true);
  assert.equal(f.states.at(-1), "error"); assert.equal(f.updates.length, 1);
  f.stop.retry(); await settle(); assert.equal(f.states.at(-1), "connected"); f.stop();
});

test("hidden and bfcache pages pause; resume is immediate and duplicate lifecycle events do not issue extra checks", async () => {
  const f = fixture(); await settle();
  f.document.visibilityState = "hidden"; f.document.emit("visibilitychange");
  await f.advance(120_000); assert.equal(f.calls.length, 1); assert.equal(f.timers.size, 0);
  f.document.visibilityState = "visible"; f.document.emit("visibilitychange");
  f.window.emit("pageshow"); f.window.emit("focus"); await settle(); assert.equal(f.calls.length, 2);
  f.window.emit("pagehide"); await f.advance(120_000); assert.equal(f.calls.length, 2);
  f.window.emit("pageshow"); await settle(); assert.equal(f.calls.length, 3);
  f.stop();
  for (const target of [f.window, f.document]) for (const listeners of target.listeners.values()) assert.equal(listeners.size, 0);
});

test("late hidden or disposed requests cannot publish data; requests never overlap", async () => {
  const f = fixture(); await settle(); let release;
  f.replies.push(new Promise(resolve => { release = resolve; })); await f.advance(30_000);
  f.stop.retry(); f.window.emit("online"); assert.equal(f.calls.length, 2);
  f.document.visibilityState = "hidden"; f.document.emit("visibilitychange");
  release(response({ ...activity, name: "迟到" })); await settle(); assert.equal(f.updates.length, 1);
  f.stop(); await f.advance(100_000); assert.equal(f.calls.length, 2);
});

test("wrong activity and missing activities are never displayed; unavailable waits for explicit retry", async () => {
  const f = fixture(); await settle();
  f.replies.push(response({ ...activity, code: "B" })); await f.advance(30_000);
  assert.equal(f.states.at(-1), "error"); assert.equal(f.updates.length, 1);
  f.replies.push(response(null, "none", 404)); await f.advance(2000);
  assert.equal(f.states.at(-1), "unavailable"); await f.advance(300_000); assert.equal(f.calls.length, 3);
  f.stop.retry(); await settle(); assert.equal(f.states.at(-1), "connected"); f.stop();
});

test("workspace never loads lottery and preserves activity on HTTP errors; retry is exposed", async () => {
  let handlers, cleanups = 0, retries = 0;
  const h = hookHarness("app/features/workspace/useActivityRuntime.ts", "useActivityRuntime", [], {
    "../../api": { getActiveActivityCode: () => "A", subscribeActiveActivityCode: () => () => {} },
    "../../services/api/activity-info-http": { subscribeActivityInfo: (_code, value) => {
      handlers = value; const stop = () => cleanups++; stop.retry = () => retries++; return stop;
    } }, "../lottery/Lottery": { initialLotteryRounds: [] },
  });
  await h.flush(); handlers.onActivity(activity); handlers.onState("connected"); await h.flush();
  const original = h.model.runtimeActivity;
  handlers.onState("error"); await h.flush(); assert.equal(h.model.runtimeActivity, original);
  assert.match(h.model.runtimeMessage, /上次资料/); h.model.retryActivity(); assert.equal(retries, 1);
  h.unmount(); assert.equal(cleanups, 1);
});

test("workspace activity switch disposes old checks and ignores late old responses", async () => {
  let code = "A", changed; const subscriptions = [];
  const h = hookHarness("app/features/workspace/useActivityRuntime.ts", "useActivityRuntime", [], {
    "../../api": { getActiveActivityCode: () => code, subscribeActiveActivityCode: fn => { changed = fn; return () => {}; } },
    "../../services/api/activity-info-http": { subscribeActivityInfo: (key, handlers) => {
      const sub = { key, handlers, closed: false }; subscriptions.push(sub); return () => { sub.closed = true; };
    } }, "../lottery/Lottery": { initialLotteryRounds: [] },
  });
  await h.flush(); subscriptions[0].handlers.onActivity(activity); await h.flush();
  code = "B"; changed(); await h.flush(); assert.equal(subscriptions[0].closed, true); assert.equal(h.model.runtimeActivity, null);
  subscriptions[1].handlers.onActivity({ ...activity, id: 2, code: "B" });
  subscriptions[0].handlers.onActivity(activity); await h.flush(); assert.equal(h.model.runtimeActivity.code, "B"); h.unmount();
});
