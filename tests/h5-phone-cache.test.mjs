import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";
import { memoryStorage } from "./helpers/memory-storage.mjs";

const { h5PhoneCacheKey } = loadModule("app/features/h5/h5-phone-cache.ts");
const { ApiError } = loadModule("app/services/api/client.ts");
const activity = code => ({ id: code === "A" ? 1 : 2, code, endsAt: "2099-01-01T00:00:00Z",
  whitelistCustomerTypeMode: "TYPED", availableCustomerTypes: ["GENERAL", "SPECIAL"], regions: [] });

function harness(storage = memoryStorage(), code = "A", storageError = null) {
  const calls = [];
  const state = { reject: false, choice: false, catalogError: false };
  const h = hookHarness("app/features/h5/useH5OrderFlow.ts", "useH5OrderFlow",
    [{ activityStatus: "running", runtimeActivity: activity(code) }], {
      "../../api": {
        ApiError, apiAssetUrl: value => value,
        verifyPhone: async (phone, type) => {
          calls.push(["verify", phone, type]);
          if (state.reject) throw new ApiError(404, "WHITELIST_IDENTITY_NOT_FOUND", "手机号无效");
          if (state.choice && !type) return { selectionRequired: true, customerTypes: ["GENERAL", "SPECIAL"] };
          return { selectionRequired: false, customer: { activityId: 1, customerId: 2,
            customerType: type ?? "GENERAL", dealerFullName: "合成客户" } };
        },
        loadH5Products: async () => {
          calls.push(["products"]);
          if (state.catalogError) throw new Error("catalog unavailable");
          return [];
        },
        loadH5Order: async () => { calls.push(["order"]); return null; },
      },
      "./h5-submission": { createH5SubmissionManager: () => ({ recover: async () => null }) },
      "./useH5Draft": { useH5Draft: () => ({ draftMessage: "", setDraftMessage() {}, restoreDraft: () => null,
        flushDraft: () => true, discardDraft: () => true, resetDraft: () => true, hasDraftChanges: () => false }) },
    }, {
      window: { get localStorage() { if (storageError) throw storageError; return storage; }, addEventListener() {}, removeEventListener() {} },
      document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    });
  return { ...h, get model() { return h.model; }, state, calls, storage,
    async verify(phone, type) {
      if (phone !== undefined) { h.model.setPhone(phone); await h.flush(); }
      await h.model.verifyIdentity(type); await h.flush();
    },
  };
}

test("verified phones survive returning home and remounts without automatic verification or order reads", async () => {
  const storage = memoryStorage(), h = harness(storage);
  assert.equal(h.model.phone, "");
  assert.equal(h.calls.length, 0);
  await h.verify("139 0000 0001");
  assert.equal(storage.getItem(h5PhoneCacheKey("A")), "13900000001");
  const calls = h.calls.length;
  await h.model.resetEntry(); await h.flush();
  assert.equal(h.model.phone, "13900000001");
  assert.equal(h.model.visibleStep, "verify");
  assert.equal(h.model.runtimeOrder, null);
  assert.equal(h.calls.length, calls);
  h.unmount();

  const reopened = harness(storage); await reopened.flush();
  assert.equal(reopened.model.phone, "13900000001");
  assert.equal(reopened.model.visibleStep, "verify");
  assert.equal(reopened.calls.length, 0);
  reopened.unmount();
});

test("editing and rejected numbers keep the last verified phone until a replacement succeeds", async () => {
  const h = harness();
  await h.verify("13900000001");
  await h.model.resetEntry(); await h.flush();
  h.model.setPhone(""); await h.flush();
  assert.equal(h.model.phone, "");
  await h.verify("123");
  assert.equal(h.calls.filter(call => call[0] === "verify").length, 1);
  h.state.reject = true;
  await h.verify("13900000002");
  assert.equal(h.storage.getItem(h5PhoneCacheKey("A")), "13900000001");
  assert.equal(h.model.visibleStep, "verify");
  assert.notEqual(h.model.verifyError, "");
  h.state.reject = false;
  await h.verify();
  await h.model.resetEntry(); await h.flush();
  assert.equal(h.model.phone, "13900000002");
  assert.equal(h.storage.getItem(h5PhoneCacheKey("A")), "13900000002");
  h.unmount();
});

test("type selection is required again and saves a new phone only after successful confirmation", async () => {
  const h = harness();
  await h.verify("13900000001");
  await h.model.resetEntry(); await h.flush();
  h.state.choice = true;
  await h.verify("13900000009");
  assert.equal(h.storage.getItem(h5PhoneCacheKey("A")), "13900000001");
  h.model.cancelIdentityChoice(); await h.flush();
  assert.equal(h.model.identityChoice, null);
  await h.verify();
  h.state.reject = true;
  await h.verify(undefined, "SPECIAL");
  assert.equal(h.storage.getItem(h5PhoneCacheKey("A")), "13900000001");
  h.state.reject = false;
  await h.verify(undefined, "SPECIAL");
  assert.equal(h.storage.getItem(h5PhoneCacheKey("A")), "13900000009");
  await h.model.resetEntry(); await h.flush();
  await h.verify();
  assert.equal(h.model.phone, "13900000009");
  assert.equal(h.model.visibleStep, "verify");
  assert.equal(h.model.identityChoice.types.length, 2);
  h.unmount();
});

test("activities keep separate phone caches and do not carry manually edited numbers to another activity", async () => {
  const storage = memoryStorage(), a = harness(storage);
  await a.verify("13900000001"); a.unmount();
  const b = harness(storage, "B"); await b.flush();
  assert.equal(b.model.phone, "");
  await b.verify("13900000002"); b.unmount();
  const reopened = harness(storage); await reopened.flush();
  assert.equal(reopened.model.phone, "13900000001");
  reopened.model.setPhone("13900000003"); await reopened.flush();
  reopened.render([{ activityStatus: "running", runtimeActivity: activity("B") }]); await reopened.flush();
  assert.equal(reopened.model.phone, "13900000002");
  assert.equal(reopened.calls.length, 0);
  reopened.unmount();
});

test("invalid or cleared cache contents leave the phone input empty", async () => {
  for (const value of ["invalid", "139****0001", "123", ""]) {
    const storage = memoryStorage(); storage.setItem(h5PhoneCacheKey("A"), value);
    const h = harness(storage); await h.flush();
    assert.equal(h.model.phone, ""); assert.equal(h.calls.length, 0); h.unmount();
  }
  const storage = memoryStorage(), h = harness(storage);
  await h.verify("13900000001");
  storage.removeItem(h5PhoneCacheKey("A"));
  await h.model.resetEntry(); await h.flush();
  assert.equal(h.model.phone, ""); h.unmount();
});

test("blocked storage and full storage allow verification and remember replacements within the current page", async () => {
  for (const blocked of [true, false]) {
    const storage = memoryStorage(); storage.setItem(h5PhoneCacheKey("A"), "13900000001");
    storage.setItem = () => { throw new Error("storage full"); };
    const h = harness(storage, "A", blocked ? new Error("storage denied") : null);
    await h.flush();
    await h.verify("13900000002");
    assert.equal(h.model.visibleStep, "order");
    await h.model.resetEntry(); await h.flush();
    assert.equal(h.model.phone, "13900000002");
    assert.equal(h.model.visibleStep, "verify");
    h.unmount();
  }
});

test("a valid phone is remembered even if loading products later fails", async () => {
  const h = harness(); h.state.catalogError = true;
  await h.verify("13900000001");
  assert.equal(h.storage.getItem(h5PhoneCacheKey("A")), "13900000001");
  assert.equal(h.model.visibleStep, "verify");
  assert.notEqual(h.model.verifyError, "");
  h.unmount();
});
