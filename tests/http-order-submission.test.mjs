import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { loadModule } from "./helpers/load-ts-module.mjs";

// HTTP IP origins expose getRandomValues, but not the secure-context randomUUID API.
const httpCrypto = { getRandomValues: values => webcrypto.getRandomValues(values) };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("HTTP IP order submission sends a UUID and preserves it after a lost response", async () => {
  const { ApiError } = loadModule("app/services/api/client.ts");
  const { createH5SubmissionManager } = loadModule("app/features/h5/h5-submission.ts", {
    "../../services/api/client": { ApiError },
  }, { crypto: httpCrypto, setTimeout, clearTimeout, AbortController });
  const calls = [], data = new Map();
  const result = { id: 9, currentVersion: 1 };
  const manager = createH5SubmissionManager({
    storage: () => ({ getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }),
    sleep: async () => {},
    send: async pending => {
      calls.push(JSON.parse(JSON.stringify(pending)));
      if (calls.length === 1) throw new TypeError("response lost");
      return result;
    },
  });
  assert.equal(await manager.submit({ activityCode: "A", customerId: 7 }, {
    expectedVersion: 0, items: [{ productId: 2, quantity: 5 }],
  }), result);
  assert.equal(calls.length, 2);
  assert.match(calls[0].key, uuidPattern);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(data.size, 0);
});

test("HTTP IP keys have UUID v4 version and variant bits and fresh random bytes", () => {
  const { createIdempotencyKey } = loadModule("app/services/api/idempotency-key.ts", {}, { crypto: httpCrypto });
  const keys = Array.from({ length: 128 }, () => createIdempotencyKey());
  for (const key of keys) assert.match(key, uuidPattern);
  assert.equal(new Set(keys).size, keys.length);
});

test("HTTPS and localhost retain the native UUID generator and its receiver", () => {
  const crypto = { randomUUID() { assert.equal(this, crypto); return "native-uuid"; } };
  const { createIdempotencyKey } = loadModule("app/services/api/idempotency-key.ts", {}, { crypto });
  assert.equal(createIdempotencyKey(), "native-uuid");
});

test("HTTP IP H5 change and withdrawal requests reach the API with valid keys", async () => {
  const calls = [];
  const orders = loadModule("app/services/api/h5-orders.ts", {
    "./client": { api: async (...args) => { calls.push(args); return { data: {} }; } },
    "./context": { activeActivityPath: () => "A" },
  }, { crypto: httpCrypto });
  await orders.withdrawH5Order(1);
  await orders.createH5OrderChangeRequest("A", 7, 1, "MODIFY", [{ productId: 2, quantity: 3 }]);
  for (const [, init] of calls) assert.match(init.headers["Idempotency-Key"], uuidPattern);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0][1].headers["Idempotency-Key"], calls[1][1].headers["Idempotency-Key"]);
  await orders.createH5OrderChangeRequest("A", 7, 1, "WITHDRAW", [], "", "existing-attempt-key");
  assert.equal(calls[2][1].headers["Idempotency-Key"], "existing-attempt-key");
});

test("HTTP IP admin order mutations all send valid idempotency keys", async () => {
  const calls = [];
  const orders = loadModule("app/services/api/orders.ts", {
    "./client": { api: async (...args) => { calls.push(args); return { data: {} }; } },
  }, { crypto: httpCrypto });
  await orders.createAdminOrder(1, 7, [{ productId: 2, quantity: 3 }], "test");
  await orders.adjustAdminOrder(1, 9, 1, 1, [{ productId: 2, quantity: 4 }], "test");
  await orders.voidAdminOrder(1, 9, 1, 1, "test");
  await orders.approveAdminOrderChangeRequest(1, 3);
  await orders.rejectAdminOrderChangeRequest(1, 3, "test");
  assert.equal(calls.length, 5);
  for (const [, init] of calls) assert.match(init.headers["Idempotency-Key"], uuidPattern);
  assert.equal(new Set(calls.map(([, init]) => init.headers["Idempotency-Key"])).size, calls.length);
});
