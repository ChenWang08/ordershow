import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/load-ts-module.mjs";

function harness(initial, resolve = async () => login("GENERAL")) {
  let activity = initial, cursor = 0;
  const slots = [], requests = [], reads = [];
  const { useH5OrderFlow } = loadModule("app/features/h5/useH5OrderFlow.ts", {
    react: {
      useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn,
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
        return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    },
    "../../api": {
      ApiError: class extends Error {}, apiAssetUrl: x => x,
      verifyPhone: async (...args) => { requests.push(args); return resolve(...args); },
      loadH5Products: async () => { reads.push("products"); return []; },
      loadH5Order: async () => null, loadH5OrderDraft: async () => null,
    },
    "./h5-submission": { createH5SubmissionManager: () => ({ recover: async () => null }) },
    "./useH5Draft": { useH5Draft: () => ({ setDraftReady() {}, draftMessage: "", setDraftMessage() {}, draftOwnerIdRef: { current: null },
      lastSavedDraftSignatureRef: { current: "" }, latestDraftSnapshotRef: { current: null }, draftSaveTimerRef: { current: null },
      draftSaveChainRef: { current: Promise.resolve() }, queueDraftSync: async () => {} }) },
  });
  const render = function useTestRender() { cursor = 0; return useH5OrderFlow({ activityStatus: "running", runtimeActivity: activity }); };
  return { render, requests, reads, update: value => { activity = value; } };
}
const login = type => ({ selectionRequired: false, csrfToken: "test", customer: {
  activityId: 1, customerId: type === "SPECIAL" ? 3 : 2, customerType: type, regionCode: type === "GENERAL" ? "EAST" : null,
  branchName: "上海分", dealerFullName: "测试客户",
} });
const choice = { selectionRequired: true, customerTypes: ["GENERAL", "SPECIAL"] };
const base = { id: 1, code: "A", whitelistCustomerTypeMode: "TYPED", availableCustomerTypes: ["GENERAL", "SPECIAL"], regions: [{ code: "EAST", name: "东区" }] };
const { H5EntryPages } = loadModule("app/features/h5/H5EntryPages.tsx");
const html = model => renderToStaticMarkup(React.createElement(H5EntryPages, { model }));

for (const type of ["GENERAL", "SPECIAL", "ALL"]) {
  test("phone-only entry uses the server's unique " + type + " identity", async () => {
    const h = harness(base, async () => login(type));
    h.render().setRegion("STALE"); h.render().setPhone("13900000001");
    assert.equal(h.render().visibleStep, "verify");
    assert.equal(h.render().identityLabel, "手机号验证");
    assert.doesNotMatch(html(h.render()), /选择您的订货通道|请选择所属大区|重新选择/);
    await h.render().verifyIdentity();
    assert.deepEqual(h.requests, [["13900000001", undefined]]);
    assert.equal(h.render().visibleStep, "order");
    assert.equal(h.render().identityLabel, type === "GENERAL" ? "综合客户 · 东区" : type === "SPECIAL" ? "特渠专业客户" : "不区分客户类型");
    assert.equal(h.render().identityBranch, "上海分");
    assert.equal(h.render().unspecifiedWhitelist, type === "ALL");
  });
}
test("two identities only show type buttons, and do not load customer data before confirmation", async () => {
  const h = harness(base, async (phone, type) => type ? login(type) : choice);
  h.render().setPhone("13900000001"); await h.render().verifyIdentity();
  assert.equal(h.reads.length, 0); assert.equal(h.render().visibleStep, "verify");
  const markup = html(h.render());
  assert.match(markup, /<dialog/); assert.match(markup, />综合<\/button>/); assert.match(markup, />特渠<\/button>/);
  assert.doesNotMatch(markup, /上海分|测试客户|东区/);
  await h.render().verifyIdentity("SPECIAL");
  assert.deepEqual(h.requests.at(-1), ["13900000001", "SPECIAL"]);
  assert.equal(h.render().identityChoice, null);
  assert.equal(h.render().identityLabel, "特渠专业客户");
  assert.equal(h.reads.length, 1);
});
test("cancel and phone changes discard the previous choices", async () => {
  const h = harness(base, async () => choice);
  h.render().setPhone("13900000001"); await h.render().verifyIdentity();
  h.render().cancelIdentityChoice();
  assert.equal(h.render().identityChoice, null);
  await h.render().verifyIdentity("GENERAL");
  assert.equal(h.requests.length, 1);
  await h.render().verifyIdentity(); h.render().setPhone("13900000002");
  await h.render().verifyIdentity("SPECIAL");
  assert.equal(h.requests.length, 2);
  assert.equal(h.render().identityChoice, null);
});
test("a disabled identity at confirmation does not enter the catalog", async () => {
  const h = harness(base, async (phone, type) => { if (type) throw new Error("disabled"); return choice; });
  h.render().setPhone("13900000001"); await h.render().verifyIdentity();
  await h.render().verifyIdentity("GENERAL");
  assert.equal(h.render().visibleStep, "verify");
  assert.equal(h.reads.length, 0); assert.notEqual(h.render().verifyError, "");
});
test("loading, empty lists and invalid numbers issue no verification", async () => {
  const h = harness(null);
  assert.match(html(h.render()), /正在加载活动入口/);
  await h.render().verifyIdentity();
  h.update({ ...base, availableCustomerTypes: [] });
  assert.match(html(h.render()), /暂无可验证客户/);
  await h.render().verifyIdentity();
  h.update(base); h.render().setPhone("123"); await h.render().verifyIdentity();
  assert.equal(h.requests.length, 0);
  h.update({ ...base, whitelistCustomerTypeMode: "UNSPECIFIED", availableCustomerTypes: [] });
  assert.equal(h.render().visibleStep, "verify");
});
test("rapid confirmations cannot create overlapping login requests", async () => {
  let release;
  const h = harness(base, async (phone, type) => type ? new Promise(resolve => { release = () => resolve(login(type)); }) : choice);
  h.render().setPhone("13900000001"); await h.render().verifyIdentity();
  const pending = h.render().verifyIdentity("GENERAL");
  await h.render().verifyIdentity("SPECIAL");
  h.render().cancelIdentityChoice(); h.render().setPhone("13900000002");
  assert.equal(h.requests.length, 2); assert.equal(h.render().phone, "13900000001");
  release(); await pending;
  assert.equal(h.render().identityLabel, "综合客户 · 东区");
});
