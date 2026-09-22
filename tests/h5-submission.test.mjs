import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

const { ApiError } = loadModule("app/services/api/client.ts");
const { createH5SubmissionManager } = loadModule("app/features/h5/h5-submission.ts", {
  "../../services/api/client": { ApiError },
}, { setTimeout, clearTimeout, AbortController });
const scope = { activityCode: "A", customerId: 7 };
const body = { expectedVersion: 0, items: [{ productId: 2, quantity: 3 }, { productId: 1, quantity: 4 }] };
const result = { id: 9, currentVersion: 1 };
function harness(send) {
  const data = new Map(), calls = [], delays = [];
  let sequence = 0, time = 1000;
  const options = { send: async (pending, signal) => { calls.push(JSON.parse(JSON.stringify(pending))); return send(pending, signal); },
    storage: () => ({ getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }),
    uuid: () => "key-" + ++sequence, now: () => time, sleep: async ms => { delays.push(ms); } };
  return { create: () => createH5SubmissionManager(options), calls, delays, data, advance: ms => { time += ms; } };
}

test("lost response retries the identical key and payload and clears only on success", async () => {
  let count = 0;
  const h = harness(async () => { if (++count === 1) throw new TypeError("response lost after commit"); return result; });
  assert.equal(await h.create().submit(scope,body),result);
  assert.equal(h.calls.length,2);
  assert.deepEqual(h.calls[0],h.calls[1]);
  assert.equal(h.data.size,0);
});

test("503 honors Retry-After and manual recovery after reload retains the original request", async () => {
  let offline = true;
  const h = harness(async () => { if (offline) throw new ApiError(503,"H5_WRITE_BUSY","busy",undefined,2000); return result; });
  await assert.rejects(h.create().submit(scope,body));
  assert.deepEqual(h.delays,[2000]);
  assert.equal(h.calls.length,2);
  offline = false;
  assert.equal(await h.create().recover(scope),result);
  assert.deepEqual(h.calls[2],h.calls[0]);
});

test("unresolved submission blocks edited payload until the previous result is recovered", async () => {
  let fail = true;
  const h = harness(async () => { if (fail) throw new TypeError("offline"); return result; });
  const manager = h.create();
  await assert.rejects(manager.submit(scope,body));
  assert.throws(() => manager.submit(scope,{ ...body, expectedVersion: 1 }),e => e.code === "SUBMISSION_PENDING");
  fail = false;
  await manager.recover(scope);
  await manager.submit(scope,{ ...body, expectedVersion: 1 });
  assert.equal(h.calls.at(-1).key,"key-2");
});

test("parallel clicks share one in-flight request, even when product order differs", async () => {
  let release;
  const h = harness(() => new Promise(resolve => { release = resolve; }));
  const manager = h.create();
  const a = manager.submit(scope,body);
  const b = manager.submit(scope,{ ...body, items: [...body.items].reverse() });
  assert.equal(a,b);
  assert.equal(h.calls.length,1);
  release(result); await a;
});

test("definitive version conflicts are not auto-retried and release the old key", async () => {
  let conflict = true;
  const h = harness(async () => { if (conflict) throw new ApiError(409,"ORDER_VERSION_CONFLICT","refresh"); return result; });
  const manager = h.create();
  await assert.rejects(manager.submit(scope,body));
  assert.equal(h.calls.length,1); assert.equal(h.data.size,0);
  conflict = false;
  await manager.submit(scope,{ ...body, expectedVersion: 1 });
  assert.equal(h.calls[1].key,"key-2");
});

test("recovery is isolated by activity/customer and expires before server retention", async () => {
  const h = harness(async () => { throw new TypeError("offline"); });
  await assert.rejects(h.create().submit(scope,body));
  const manager = h.create();
  assert.equal(await manager.recover({ ...scope, customerId: 8 }),null);
  assert.equal(await manager.recover({ ...scope, activityCode: "B" }),null);
  h.advance(24*60*60*1000+1);
  await assert.rejects(manager.recover(scope),e => e.code === "SUBMISSION_RECOVERY_EXPIRED");
  assert.equal(h.calls.length,2);
});

test("long Retry-After requires manual retry with the original key", async () => {
  const h = harness(async () => { throw new ApiError(503,"H5_WRITE_BUSY","busy",undefined,60000); });
  const manager = h.create();
  await assert.rejects(manager.submit(scope,body));
  assert.equal(h.calls.length,1); assert.equal(h.delays.length,0);
  await assert.rejects(manager.recover(scope));
  assert.equal(h.calls[0].key,h.calls[1].key);
});

test("timeout followed by in-progress keeps the request available for manual confirmation", async () => {
  let count = 0;
  const h = harness(async () => {
    if (++count === 1) throw Object.assign(new Error("timed out"),{ name: "AbortError" });
    if (count === 2) throw new ApiError(409,"REQUEST_IN_PROGRESS","wait");
    return result;
  });
  const manager = h.create();
  await assert.rejects(manager.submit(scope,body));
  assert.equal(await manager.recover(scope),result);
  assert.deepEqual(h.calls[0],h.calls[2]);
});

test("expired login preserves the pending request until the same customer signs in again", async () => {
  let authorized = false;
  const h = harness(async () => { if (!authorized) throw new ApiError(401,"UNAUTHORIZED","login"); return result; });
  await assert.rejects(h.create().submit(scope,body));
  assert.equal(h.calls.length,1);
  authorized = true;
  assert.equal(await h.create().recover(scope),result);
  assert.deepEqual(h.calls[0],h.calls[1]);
});

test("HTTP retry pins activity and expected customer even if the global activity has switched", async () => {
  let call;
  const api = loadModule("app/services/api/h5-orders.ts", {
    "./client": { ApiError, api: async (...args) => { call = args; return { data: result }; } },
    "./context": { activeActivityPath: () => "OTHER" },
  });
  await api.saveH5Order(0,body.items,"original-key","A",7);
  assert.equal(call[0],"/h5/activities/A/order?includeHistory=false");
  assert.equal(call[1].headers["Idempotency-Key"],"original-key");
  assert.equal(call[1].headers["X-H5-Customer-Id"],"7");
  assert.deepEqual(JSON.parse(call[1].body),body);
});
