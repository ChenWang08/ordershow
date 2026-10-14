import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/load-ts-module.mjs";

const { ActivityOverview } = loadModule("app/features/admin/ActivityOverview.tsx", { "./ActivityBackgroundCard": { ActivityBackgroundCard: () => null }, "./ActivityLiveRoomCard": { ActivityLiveRoomCard: () => null }, "../../admin-context": { useAdminIdentity: () => ({ roleCode: "DEPARTMENT_ADMIN" }) } });
const noop = () => {};
const viewProps = {
  activityCode: "HD-TEST", activityName: "测试活动", departmentName: "测试部门",
  activityEndAt: "2099-01-02T12:00", activityEventEndAt: "2099-01-02T16:00",
  minimumFutureAt: "2099-01-01T10:01", onViewOrders: noop,
  overview: { adminStats: [], progressRows: [] },
  settings: {
    activityNameDraft: "测试活动", activityStartDraft: "2099-01-02T10:00",
    activityEndDraft: "2099-01-02T12:00", activityEventEndDraft: "2099-01-02T16:00",
    setActivityNameDraft: noop, setActivityStartDraft: noop, setActivityEndDraft: noop,
    setActivityEventEndDraft: noop, saveActivityConfig: noop, publishCurrentActivity: noop,
    withdrawCurrentActivity: noop, closeCurrentActivity: noop, finishCurrentActivity: noop,
  },
};

for (const [status, action, disabledDates] of [
  ["draft", "发布活动", 0], ["scheduled", "撤回发布", 0],
  ["running", "立即截止订货", 1], ["closed", "结束整场活动", 2],
  ["finished", "查看最终数据", 3],
]) {
  test(`activity overview preserves controls for ${status}`, () => {
    const html = renderToStaticMarkup(React.createElement(ActivityOverview, { ...viewProps, activityStatus: status }));
    for (const label of ["发布活动", "撤回发布", "立即截止订货", "结束整场活动", "查看最终数据"]) {
      assert.equal(html.includes(`>${label}</button>`), label === action);
    }
    const dates = html.match(/<input\b[^>]*type="datetime-local"[^>]*>/g) ?? [];
    assert.equal(dates.length, 3);
    assert.equal(dates.filter((input) => input.includes("disabled=")).length, disabledDates);
    assert.match(html, /value="HD-TEST"/);
    assert.match(html, /readOnly=""/);
  });
}

function settingsHarness(overrides = {}, apiOverrides = {}, confirm = true) {
  const calls = [];
  const notices = [];
  const activity = {
    id: 1, code: "HD-TEST", name: "测试活动", status: "DRAFT",
    startsAt: "2099-01-02T10:00", endsAt: "2099-01-02T12:00", eventEndsAt: "2099-01-02T16:00",
  };
  const api = {
    ApiError: class ApiError extends Error {},
    loadAdminActivity: async () => { calls.push("load"); return activity; },
    updateActivity: async (_activity, request) => { calls.push("save"); return { ...activity, ...request }; },
    publishActivity: async () => { calls.push("publish"); return { ...activity, status: "SCHEDULED" }; },
    ...apiOverrides,
  };
  // Minimal state adapter for action unit tests; browser lifecycle is not simulated.
  const slots = [];
  let cursor = 0;
  const { useActivitySettings } = loadModule("app/features/admin/useActivitySettings.ts", {
    "../../api": api,
    react: { useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = value; }];
    } },
  }, { window: { confirm: () => confirm, prompt: () => null } });
  const options = {
    activityId: "1", activityCode: activity.code, activityName: activity.name, activityStatus: "draft",
    activityStartAt: activity.startsAt, activityEndAt: activity.endsAt, activityEventEndAt: activity.eventEndsAt,
    productImportCompleted: true, whitelistImportCompleted: true,
    onActivityNameChange: noop, onActivityStartAtChange: noop, onActivityEndAtChange: noop,
    onActivityEventEndAtChange: noop, onActivityStatusChange: (status) => calls.push(`status:${status}`),
    setActionNotice: (notice) => notices.push(notice), recordOperation: noop,
    ...overrides,
  };
  return { calls, notices, render: function useSettingsRender() { cursor = 0; return useActivitySettings(options); } };
}

test("publication saves valid settings before publishing", async () => {
  const harness = settingsHarness();
  await harness.render().publishCurrentActivity();
  assert.deepEqual(harness.calls, ["load", "save", "status:draft", "load", "publish", "status:scheduled"]);
});

test("publication requires both completed imports", async () => {
  for (const missing of ["productImportCompleted", "whitelistImportCompleted"]) {
    const harness = settingsHarness({ [missing]: false });
    await harness.render().publishCurrentActivity();
    assert.deepEqual(harness.calls, []);
    assert.match(harness.notices[0], /必须完成商品和白名单导入/);
  }
});

test("cancelled publication performs no API writes", async () => {
  const harness = settingsHarness({}, {}, false);
  await harness.render().publishCurrentActivity();
  assert.deepEqual(harness.calls, []);
});

test("invalid times and shortened running orders are rejected before saving", async () => {
  for (const [status, end, message] of [
    ["draft", "2099-01-02T09:00", /开始时间必须早于截止时间/],
    ["running", "2099-01-02T11:00", /只能延长截止时间/],
  ]) {
    const harness = settingsHarness({ activityStatus: status });
    harness.render().setActivityEndDraft(end);
    assert.equal(await harness.render().saveActivityConfig(), false);
    assert.deepEqual(harness.calls, []);
    assert.match(harness.notices[0], message);
  }
});

test("failed settings save does not proceed to publication", async () => {
  const harness = settingsHarness({}, { updateActivity: async () => { throw new Error("offline"); } });
  await harness.render().publishCurrentActivity();
  assert.deepEqual(harness.calls, ["load"]);
  assert.match(harness.notices[0], /活动配置保存失败/);
});

test('member overview never exposes activity lifecycle controls even with all permissions', () => {
  const { ActivityOverview: MemberOverview } = loadModule('app/features/admin/ActivityOverview.tsx', {
    './ActivityBackgroundCard': { ActivityBackgroundCard: () => null },
    './ActivityLiveRoomCard': { ActivityLiveRoomCard: () => null },
    '../../admin-context': { useAdminIdentity: () => ({ roleCode: 'DEPARTMENT_MEMBER', permissions: ['OVERVIEW','PRODUCT','WHITELIST','ATTENDANCE','ORDER','LOTTERY'] }) },
  });
  for (const activityStatus of ['draft','scheduled','running','closed','finished']) {
    const html = renderToStaticMarkup(React.createElement(MemberOverview, { ...viewProps, activityStatus }));
    for (const action of ['发布活动','撤回发布','立即截止订货','结束整场活动','保存活动设置','保存延长时间']) assert.equal(html.includes('>' + action + '</button>'), false);
    assert.equal((html.match(/<input\b[^>]*type="datetime-local"[^>]*disabled=""[^>]*>/g) || []).length, 3);
  }
});
