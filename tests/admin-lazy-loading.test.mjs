import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as settle } from "node:timers/promises";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const hook = "app/features/admin/useLazyAdminQuery.ts";

test("unopened modules do not read; every entry reads again without idle polling", async () => {
  let reads = 0;
  const loader = async () => ++reads;
  const h = hookHarness(hook, "useLazyAdminQuery", ["one", false, loader]);
  await h.flush(); assert.equal(reads, 0);
  h.render(["one", true, loader]); await h.flush(); assert.equal(h.model.data, 1);
  h.render(["one", false, loader]); h.render(["one", true, loader]); await h.flush(); assert.equal(reads, 2);
  for (let i = 0; i < 5; i++) h.render();
  await h.flush(); assert.equal(reads, 2); assert.equal(h.intervals.size, 0);
  h.render(["one", false, loader]); h.model.invalidate(); await h.flush(); assert.equal(reads, 2);
  h.render(["one", true, loader]); await h.flush(); assert.equal(h.model.data, 3);
  await Promise.all([h.model.refresh(), h.model.refresh()]); await h.flush(); assert.equal(reads, 4);
  h.unmount();
});

test("an invalidated module preserves unfinished edits and previews when reopened", async () => {
  let reads = 0;
  const loader = async () => ++reads;
  const h = hookHarness(hook, "useLazyAdminQuery", ["one", true, loader]); await h.flush();
  h.render(["one", false, loader, undefined, true]); h.model.invalidate(); await h.flush();
  h.render(["one", true, loader, undefined, true]); await h.flush();
  assert.equal(reads, 1); assert.equal(h.model.stale, true); assert.equal(h.model.loading, false);
  await h.model.refresh(); await h.flush(); assert.equal(reads, 1, "retry cannot overwrite an edit");
  h.render(["one", true, loader, undefined, false]); await h.flush();
  assert.equal(h.model.data, 2); assert.equal(h.model.stale, false);
  h.unmount();
});

test("hiding or changing activity aborts reads and discards late responses", async () => {
  const calls = [], commits = [];
  const loader = signal => { const d = deferred(); calls.push({ ...d, signal }); return d.promise; };
  const onLoaded = value => commits.push(value);
  const h = hookHarness(hook, "useLazyAdminQuery", ["one", true, loader, onLoaded]); await h.flush();
  h.render(["one", false, loader, onLoaded]); await h.flush();
  assert.equal(calls[0].signal.aborted, true); assert.equal(h.model.loading, false);
  h.render(["one", true, loader, onLoaded]); await h.flush();
  h.render(["two", true, loader, onLoaded]); await h.flush();
  assert.equal(calls[1].signal.aborted, true);
  calls[2].resolve("new activity"); await h.flush();
  calls[0].resolve("hidden"); calls[1].resolve("old activity"); await h.flush();
  assert.equal(h.model.data, "new activity"); assert.deepEqual(commits, ["new activity"]); h.unmount();
});

test("starting an edit cancels a pending reload and resumes only when editing ends", async () => {
  const calls = [], commits = [];
  const loader = signal => { const d = deferred(); calls.push({ ...d, signal }); return d.promise; };
  const commit = value => commits.push(value);
  const h = hookHarness(hook, "useLazyAdminQuery", ["one", true, loader, commit]); await h.flush();
  calls[0].resolve("original"); await h.flush();
  h.render(["one", false, loader, commit]); h.render(["one", true, loader, commit]); await h.flush();
  h.render(["one", true, loader, commit, true]); await h.flush();
  assert.equal(calls[1].signal.aborted, true);
  calls[1].resolve("late server response"); await h.flush();
  assert.deepEqual(commits, ["original"]); assert.equal(h.model.data, "original");
  h.render(["one", true, loader, commit, false]); await h.flush();
  calls[2].resolve("after save or cancel"); await h.flush();
  assert.deepEqual(commits, ["original", "after save or cancel"]); h.unmount();
});

test("post-save invalidation cancels pre-save reads; failed refresh keeps the last successful snapshot", async () => {
  const calls = [], loader = signal => { const d = deferred(); calls.push({ ...d, signal }); return d.promise; };
  const h = hookHarness(hook, "useLazyAdminQuery", ["one", true, loader]); await h.flush();
  calls[0].resolve("original"); await h.flush();
  void h.model.refresh(); await h.flush(); h.model.invalidate();
  void h.model.refresh(); await h.flush(); assert.equal(calls[1].signal.aborted, true);
  calls[2].resolve("after save"); calls[1].resolve("before save"); await h.flush();
  assert.equal(h.model.data, "after save");
  void h.model.refresh(); await h.flush(); calls[3].reject(new Error("offline")); await h.flush();
  assert.equal(h.model.data, "after save"); assert.equal(h.model.loaded, true); assert.equal(h.model.loading, false);
  assert.match(h.model.error, /offline|加载失败/); h.unmount();
});

function importHarness() {
  const timers = new Map(), calls = []; let visible = false, next = 0, response = { status: "COMPLETED" };
  const { waitForImport } = loadModule("app/services/api/imports.ts", { "./client": {
    api: async (_path, options) => { calls.push(options); return { data: await response }; }, ApiError: Error,
  } }, { setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id) });
  return { waitForImport, calls, timers, set visible(value) { visible = value; }, isVisible: () => visible,
    set response(value) { response = value; }, async tick() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); await settle(); } };
}

test("import progress pauses while hidden without exhausting its retry budget, then resumes", async () => {
  const h = importHarness(); let completed = false;
  const task = h.waitForImport(1, 2, { isVisible: h.isVisible }).then(() => { completed = true; });
  for (let i = 0; i < 95; i++) await h.tick();
  assert.equal(h.calls.length, 0); assert.equal(completed, false);
  h.visible = true; await h.tick(); await task; assert.equal(h.calls.length, 1);
});

test("import completion arriving after navigation waits for the module before reading its results", async () => {
  const h = importHarness(), d = deferred(); h.visible = true; h.response = d.promise;
  let completed = false;
  const task = h.waitForImport(1, 2, { isVisible: h.isVisible }).then(() => { completed = true; });
  h.visible = false; d.resolve({ status: "COMPLETED" }); await settle(); await h.tick();
  assert.equal(completed, false); assert.equal(h.calls.length, 1);
  h.visible = true; await h.tick(); await task; assert.equal(h.calls.length, 1);
});

test("leaving an activity cancels its paused import progress reads", async () => {
  const h = importHarness(), controller = new AbortController();
  const task = h.waitForImport(1, 2, { signal: controller.signal, isVisible: h.isVisible });
  const rejected = assert.rejects(task, { name: "AbortError" }); controller.abort(); await rejected;
  assert.equal(h.timers.size, 0); assert.equal(h.calls.length, 0);
});


test("entry policy retains local rows when drawers save or cancel, with explicit and entry refreshes", async () => {
  let reads = 0; const commits = [], loader = async () => ++reads, commit = n => commits.push(n);
  const args = (enabled, editing = false, key = "account:activity") => [key, enabled, loader, commit, editing, key, "entry"];
  const h = hookHarness(hook, "useLazyAdminQuery", args(true)); await h.flush();
  for (const save of [false, true]) {
    h.render(args(true, true)); await h.flush();
    if (save) h.model.acceptLocal();
    h.render(args(true)); await h.flush();
    assert.equal(reads, 1, "closing a drawer must not reread the directory");
  }
  h.render(args(false)); h.model.invalidate(); h.render(args(true, true)); await h.flush();
  assert.equal(reads, 1, "module entry protects ongoing edits");
  h.render(args(true)); await h.flush(); assert.equal(reads, 2);
  await Promise.all([h.model.refresh(), h.model.refresh()]); await h.flush(); assert.equal(reads, 3);
  h.render(args(true, false, "different-account:activity")); await h.flush(); assert.equal(reads, 4);
  assert.deepEqual(commits, [1, 2, 3, 4]); h.unmount();
});

test("accepting a local mutation aborts an older read and discards its late result", async () => {
  const calls = [], commits = [];
  const loader = signal => { const d = deferred(); calls.push({ ...d, signal }); return d.promise; };
  const h = hookHarness(hook, "useLazyAdminQuery", ["one", true, loader, value => commits.push(value), false, "one", "entry"]);
  await h.flush(); h.model.acceptLocal(); await h.flush();
  assert.equal(calls[0].signal.aborted, true); assert.equal(h.model.loaded, true);
  calls[0].resolve("outdated"); await h.flush(); assert.deepEqual(commits, []);
  assert.equal(h.model.loading, false); assert.equal(h.model.stale, false); h.unmount();
});


test("post-import readback failure stays visible until an explicit successful refresh",async()=>{
  let reads=0;const loader=async()=>++reads;
  const args=editing=>["one",true,loader,undefined,editing,"one","entry"];
  const h=hookHarness(hook,"useLazyAdminQuery",args(false));await h.flush();
  h.render(args(true));h.model.acceptLocal();h.model.markRefreshError("已导入，请刷新");
  h.render(args(false));await h.flush();assert.equal(reads,1);assert.equal(h.model.stale,true);assert.match(h.model.error,/请刷新/);
  await h.model.refresh();await h.flush();assert.equal(reads,2);assert.equal(h.model.error,"");assert.equal(h.model.stale,false);h.unmount();
});
