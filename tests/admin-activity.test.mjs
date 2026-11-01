import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/load-ts-module.mjs";

const { ActivityOverview } = loadModule("app/features/admin/ActivityOverview.tsx", { "./ActivityBackgroundCard": { ActivityBackgroundCard: () => null }, "./ActivityLiveRoomCard": { ActivityLiveRoomCard: () => null }, "../../admin-context": { useAdminIdentity: () => ({ roleCode: "DEPARTMENT_ADMIN" }) } });
const noop = () => {};

test("new activities request the designed 90-company and 30-branch ranking limits", async () => {
  let saved;
  const { createActivity, updateActivity } = loadModule("app/services/api/activity.ts", {
    "./context": { activeActivityPath: () => "fixture" },
    "./client": { api: async (path, options, csrf) => {
      saved = { path, body: JSON.parse(options.body), csrf };
      return { data: { id: 1 } };
    } },
  });
  await createActivity({ name: "排行测试", startsAt: "2099-01-02T10:00", endsAt: "2099-01-02T12:00", eventEndsAt: "2099-01-02T16:00" });
  assert.equal(saved.path, "/admin/activities");
  assert.equal(saved.csrf, "admin");
  assert.equal(saved.body.companyRankingTopN, 90);
  assert.equal(saved.body.branchRankingTopN, 30);

  // Editing names/times must preserve an explicitly customized ranking limit.
  await updateActivity({ id: 1, version: 3, companyRankingTopN: 12, branchRankingTopN: 7 }, {
    name: "保留自定义排行", startsAt: "2099-01-02T10:00", endsAt: "2099-01-02T12:00", eventEndsAt: "2099-01-02T16:00",
  });
  assert.equal(saved.body.companyRankingTopN, 12);
  assert.equal(saved.body.branchRankingTopN, 7);
});
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
    // Action-only harness; the real refresh lifecycle is exercised in admin-manual-refresh.test.mjs.
    "./useLazyAdminQuery": { useLazyAdminQuery: () => ({ loading: false, error: "", refresh: async () => undefined }) },
    react: { useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    }, useState(initial) {
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

test("publication delegates readiness to the server even when modules have not loaded", async () => {
  for (const missing of ["productImportCompleted", "whitelistImportCompleted"]) {
    const harness = settingsHarness({ [missing]: false });
    await harness.render().publishCurrentActivity();
    assert.deepEqual(harness.calls, ["load", "save", "status:draft", "load", "publish", "status:scheduled"]);
  }
});

test("cancelled publication performs no API writes", async () => {
  const harness = settingsHarness({}, {}, false);
  await harness.render().publishCurrentActivity();
  assert.deepEqual(harness.calls, []);
});

test("invalid start times are rejected before saving", async () => {
  for (const [status, end, message] of [
    ["draft", "2099-01-02T09:00", /开始时间必须早于截止时间/],
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
    for (const action of ['发布活动','撤回发布','立即截止订货','结束整场活动','保存活动设置','保存时间调整','重新开放订货']) assert.equal(html.includes('>' + action + '</button>'), false);
    assert.equal((html.match(/<input\b[^>]*type="datetime-local"[^>]*disabled=""[^>]*>/g) || []).length, 3);
  }
});

test('running activity can shorten future deadlines but event end must be strictly later', async () => {
  const harness = settingsHarness({ activityStatus: 'running' });
  harness.render().setActivityEndDraft('2099-01-02T11:00');
  harness.render().setActivityEventEndDraft('2099-01-02T11:30');
  assert.equal(await harness.render().saveActivityConfig(), true);
  harness.render().setActivityEventEndDraft('2099-01-02T11:00');
  assert.equal(await harness.render().saveActivityConfig(), false);
  assert.match(harness.notices.at(-1), /必须晚于订货截止/);
});

test('only closed and finished activities show reopening', () => {
  for (const activityStatus of ['draft', 'scheduled', 'running', 'closed', 'finished']) {
    const html = renderToStaticMarkup(React.createElement(ActivityOverview, { ...viewProps, activityStatus }));
    assert.equal(html.includes('>重新开放订货</button>'), ['closed', 'finished'].includes(activityStatus));
  }
});

function reopenHarness(apiOverrides = {}, confirm = true) {
  const activity = { id: 1, version: 7, name: '测试活动', status: 'FINISHED', startsAt: '2020-01-01T10:00', endsAt: '2020-01-01T12:00', eventEndsAt: '2020-01-01T16:00' };
  const submitted = [];
  const harness = settingsHarness({ activityStatus: 'finished' }, {
    loadAdminActivity: async () => activity,
    reopenActivity: async (snapshot, input) => { submitted.push({ snapshot, input }); return { ...activity, ...input, status: 'ACTIVE' }; },
    ...apiOverrides,
  }, confirm);
  return { ...harness, submitted };
}

async function fillReopen(harness, changes = {}) {
  await harness.render().openReopenDialog();
  const draft = harness.render().reopenDraft;
  assert.equal(draft.endsAt, '');
  assert.equal(draft.eventEndsAt, '');
  harness.render().setReopenDraft({ ...draft, endsAt: '2099-01-02T11:00', eventEndsAt: '2099-01-02T12:00', reason: '误结束', ...changes });
}

test('reopening retains loaded version and restores running status', async () => {
  const harness = reopenHarness();
  await fillReopen(harness);
  await harness.render().submitReopen();
  assert.equal(harness.submitted[0].snapshot.version, 7);
  assert.equal(harness.render().reopenDraft, null);
  assert.ok(harness.calls.includes('status:running'));
});

test('reopening rejects expired, equal deadlines and blank reasons without writes', async () => {
  for (const changes of [{ endsAt: '2020-01-01T12:00' }, { eventEndsAt: '2099-01-02T11:00' }, { reason: ' ' }]) {
    const harness = reopenHarness();
    await fillReopen(harness, changes);
    await harness.render().submitReopen();
    assert.equal(harness.submitted.length, 0);
    assert.ok(harness.render().reopenDraft.error);
  }
});

test('cancelled confirmation keeps the form and performs no writes', async () => {
  const harness = reopenHarness({}, false);
  await fillReopen(harness);
  await harness.render().submitReopen();
  assert.equal(harness.submitted.length, 0);
  assert.equal(harness.render().reopenDraft.reason, '误结束');
});

test('pending reopening blocks duplicate submissions and failures preserve entered values', async () => {
  let reject;
  let writes = 0;
  const harness = reopenHarness({ reopenActivity: () => { writes++; return new Promise((_, fail) => { reject = fail; }); } });
  await fillReopen(harness);
  const pending = harness.render().submitReopen();
  await harness.render().submitReopen();
  assert.equal(writes, 1);
  reject(new Error('offline'));
  await pending;
  assert.equal(harness.render().reopenDraft.reason, '误结束');
  assert.ok(harness.render().reopenDraft.error);
  assert.equal(harness.render().reopenBusy, false);
});
