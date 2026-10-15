import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/load-ts-module.mjs";

function harness(initial) {
  let activity = initial, cursor = 0;
  const slots = [], requests = [];
  const { useH5OrderFlow } = loadModule("app/features/h5/useH5OrderFlow.ts", {
    react: {
      useEffect() {}, useMemo: fn => fn(),
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
        return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    },
    "../../api": {
      ApiError: class extends Error {}, apiAssetUrl: x => x,
      verifyPhone: async (...args) => { requests.push(args); return { activityId: 1, customerId: 2, customerType: args[0], regionCode: args[0] === "GENERAL" ? "EAST" : null, branchName: "上海分", dealerFullName: "测试客户" }; },
      loadH5Products: async () => [], loadH5Order: async () => null, loadH5OrderDraft: async () => null,
    },
    "./h5-submission": { createH5SubmissionManager: () => ({ recover: async () => null }) },
    "./useH5Draft": { useH5Draft: () => ({ setDraftReady() {}, draftMessage: "", setDraftMessage() {}, draftOwnerIdRef: { current: null },
      lastSavedDraftSignatureRef: { current: "" }, latestDraftSnapshotRef: { current: null }, draftSaveTimerRef: { current: null },
      draftSaveChainRef: { current: Promise.resolve() }, queueDraftSync: async () => {} }) },
  });
  const render = function useTestRender() { cursor = 0; return useH5OrderFlow({ activityStatus: "running", runtimeActivity: activity }); };
  return { render, requests, update: value => { activity = value; } };
}
const base = { id: 1, code: "A", whitelistCustomerTypeMode: "TYPED", regions: [{ code: "EAST", name: "东区" }] };
const { H5EntryPages } = loadModule("app/features/h5/H5EntryPages.tsx");
const html = model => renderToStaticMarkup(React.createElement(H5EntryPages, { model }));

for (const [type, label] of [["GENERAL", "综合客户"], ["SPECIAL", "特渠专业客户"]]) {
  test(`single ${type} enters verification directly and uses server identity`, async () => {
    const h = harness({ ...base, availableCustomerTypes: [type] });
    h.render().setRegion("STALE"); h.render().setPhone("13900000001");
    assert.equal(h.render().visibleStep, "verify");
    assert.equal(h.render().identityLabel, label);
    assert.doesNotMatch(html(h.render()), /选择您的订货通道|请选择所属大区|重新选择/);
    await h.render().verifyIdentity();
    assert.deepEqual(h.requests, [[type, "", "13900000001"]]);
    assert.equal(h.render().visibleStep, "order");
    assert.equal(h.render().identityLabel, type === "GENERAL" ? "综合客户 · 东区" : label);
    assert.equal(h.render().identityBranch, "上海分");
  });
}
test("mixed list retains channel and region choices and passes the selected region", async () => {
  const h = harness({ ...base, availableCustomerTypes: ["GENERAL", "SPECIAL"] });
  assert.equal(h.render().visibleStep, "channel");
  assert.match(html(h.render()), /综合客户订货/); assert.match(html(h.render()), /特渠专业客户订货/);
  h.render().setChannel("综合客户"); h.render().setStep("region");
  assert.match(html(h.render()), /请选择所属大区/);
  h.render().setRegion("EAST"); h.render().setStep("verify"); h.render().setPhone("13900000001");
  assert.match(html(h.render()), /重新选择/);
  await h.render().verifyIdentity();
  assert.deepEqual(h.requests[0], ["GENERAL", "EAST", "13900000001"]);
});
test("untyped list retains direct ALL verification", async () => {
  const h = harness({ ...base, whitelistCustomerTypeMode: "UNSPECIFIED", availableCustomerTypes: [] });
  assert.equal(h.render().identityLabel, "不区分客户类型");
  assert.equal(h.render().visibleStep, "verify");
  h.render().setPhone("13900000001"); await h.render().verifyIdentity();
  assert.equal(h.requests[0][0], "ALL");
});
test("loading and empty lists never flash channel choices or submit identity requests", async () => {
  const h = harness(null);
  assert.match(html(h.render()), /正在加载活动入口/);
  assert.doesNotMatch(html(h.render()), /选择您的订货通道/);
  await h.render().verifyIdentity(); assert.equal(h.requests.length, 0);
  h.update({ ...base, availableCustomerTypes: [] });
  assert.match(html(h.render()), /暂无可验证客户/);
  await h.render().verifyIdentity(); assert.equal(h.requests.length, 0);
  h.update({ ...base, availableCustomerTypes: ["GENERAL"] });
  assert.equal(h.render().visibleStep, "verify");
  assert.equal(h.render().channel, "综合客户");
  h.render().setStep("verify");
  h.update({ ...base, availableCustomerTypes: ["GENERAL", "SPECIAL"] });
  assert.equal(h.render().visibleStep, "channel");
});
