import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { memoryStorage } from "./helpers/memory-storage.mjs";

const { createH5LocalDraftStore, h5LocalDraftKey, H5_LOCAL_DRAFT_MAX_AGE_MS } = loadModule("app/features/h5/h5-local-draft.ts", { "../../api": { apiAssetUrl: x => x } });
const now = Date.parse("2026-10-31T01:00:00Z");
const context = { activityId: 1, activityCode: "A", customerId: 2, endsAt: "2099-01-01T00:00:00Z", order: null, request: null };
const items = [{ productId: 1, quantity: 4 }];

test("local carts survive a fresh store instance, isolate activity/customer and contain no prices or credentials", () => {
  const storage = memoryStorage();
  const first = createH5LocalDraftStore({ storage: () => storage, now: () => now });
  assert.equal(first.save({ ...context, phone: "private", token: "private" }, [{ ...items[0], price: 99 }]), true);
  const raw = storage.getItem(h5LocalDraftKey(context));
  assert.doesNotMatch(raw, /price|private|token|phone/);
  const second = createH5LocalDraftStore({ storage: () => storage, now: () => now });
  assert.equal(second.read(context).draft.items[0].quantity, 4);
  for (const other of [{ ...context, customerId: 3 }, { ...context, activityId: 2 }, { ...context, activityCode: "B" }]) {
    assert.equal(second.read(other).draft, null);
  }
  const pending = { ...context, request: { id: 1, orderId: 1, requestType: "MODIFY", status: "PENDING", baseVersion: 1,
    currentVersion: 1, requestedAt: "2026-10-31T00:00:00Z", items: [{ ...items[0], materialName: "Private material", casePrice: 99, lineAmount: 396 }] } };
  first.save(pending, items);
  assert.doesNotMatch(storage.getItem(h5LocalDraftKey(context)), /casePrice|lineAmount|Private material/);
});

test("malformed, unsupported, duplicate/invalid item, expired and deadline-shortened drafts are discarded", () => {
  const storage = memoryStorage();
  const store = createH5LocalDraftStore({ storage: () => storage, now: () => now });
  store.save(context, items);
  const valid = JSON.parse(storage.getItem(h5LocalDraftKey(context)));
  for (const raw of ["broken", "null", JSON.stringify({ ...valid, format: 0 }),
    JSON.stringify({ ...valid, scope: { ...valid.scope, customerId: 3 } }),
    JSON.stringify({ ...valid, items: [...items, ...items] }),
    ...[0, -1, 1.2, 1000000].map(quantity => JSON.stringify({ ...valid, items: [{ productId: 1, quantity }] })),
    JSON.stringify({ ...valid, expiresAt: now - 1, updatedAt: now - 1000 })]) {
    storage.setItem(h5LocalDraftKey(context), raw);
    assert.equal(store.read(context).draft, null);
    assert.equal(storage.getItem(h5LocalDraftKey(context)), null);
  }
  store.save(context, items);
  assert.equal(store.read({ ...context, endsAt: "2026-10-31T00:00:00Z" }).reason, "expired");
  store.save(context, items);
  const expiredStore = createH5LocalDraftStore({ storage: () => storage, now: () => now + H5_LOCAL_DRAFT_MAX_AGE_MS });
  assert.equal(expiredStore.read(context).reason, "expired");
});

test("blocked and full storage retain a session memory cart and can recover when storage works again", () => {
  const storage = memoryStorage(); let blocked = true;
  const store = createH5LocalDraftStore({ storage: () => { if (blocked) throw new Error("SecurityError"); return storage; }, now: () => now });
  assert.equal(store.save(context, items), false);
  assert.equal(store.read(context).draft.items[0].quantity, 4);
  assert.equal(store.read(context).persistent, false);
  blocked = false;
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(store.save(context, items), false);
  assert.equal(store.read(context).draft.items[0].quantity, 4);
  storage.setItem = (key, value) => storage.values.set(key, value);
  assert.equal(store.save(context, items), true);
  assert.equal(store.read(context).persistent, true);
  blocked = true;
  assert.equal(store.remove(context), false);
  blocked = false;
  assert.equal(store.read(context).draft, null);
  assert.equal(storage.getItem(h5LocalDraftKey(context)), null, "Failed removals are completed when browser storage is available again");
});

test("empty carts are intentional edits against existing orders and survive storage", () => {
  const storage = memoryStorage(), persistentStore = createH5LocalDraftStore({ storage: () => storage, now: () => now });
  const withOrder = { ...context, order: { id: 1, currentVersion: 1, lockVersion: 1, status: "SUBMITTED", items } };
  assert.equal(persistentStore.save(withOrder, []), true);
  assert.equal(persistentStore.read(withOrder).draft.items.length, 0);
});

test("local persistence debounces edits, flushes on hide/unmount, never writes HTTP and ignores other tabs while editing", async () => {
  const storage = memoryStorage(), listeners = new Map(); let hidden = false;
  const listen = (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); };
  const unlisten = (type, fn) => listeners.get(type)?.delete(fn);
  const options = { activityClosed: false, editing: true, paused: false, catalog: [{ id: "1", isOrderable: true }], quantities: {},
    runtimeActivity: { code: "A", endsAt: context.endsAt }, runtimeIdentity: context, runtimeOrder: null, request: null };
  const h = hookHarness("app/features/h5/useH5Draft.ts", "useH5Draft", [options], {
    "../../api": { apiAssetUrl: x => x, saveH5OrderDraft: () => assert.fail("No server drafts"), deleteH5OrderDraft: () => assert.fail("No server drafts") },
  }, { window: { localStorage: storage, addEventListener: listen, removeEventListener: unlisten },
    document: { get hidden() { return hidden; }, addEventListener: listen, removeEventListener: unlisten } });
  h.model.restoreDraft(context, options.catalog, true); await h.flush();
  for (const quantity of [1, 2, 4]) { options.quantities = { 1: quantity }; h.render([options]); }
  assert.equal(storage.values.size, 0); assert.equal(h.timers.size, 1);
  await h.runTimers(); assert.equal(storage.writes.length, 1);
  assert.match(h.model.draftMessage, /本机浏览器/);
  // Another tab's record does not change the in-memory snapshot.
  storage.setItem(h5LocalDraftKey(context), "another tab");
  for (const fn of listeners.get("storage") ?? []) fn({ key: h5LocalDraftKey(context) });
  assert.equal(h.model.hasDraftChanges(), true);
  options.quantities = { 1: 5 }; h.render([options]); hidden = true;
  for (const fn of listeners.get("visibilitychange")) fn();
  assert.equal(JSON.parse(storage.getItem(h5LocalDraftKey(context))).items[0].quantity, 5);
  options.quantities = { 1: 6 }; h.render([options]); h.unmount();
  assert.equal(JSON.parse(storage.getItem(h5LocalDraftKey(context))).items[0].quantity, 6);
  assert.equal(h.timers.size, 0);
  for (const set of listeners.values()) assert.equal(set.size, 0);
});
