import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/load-ts-module.mjs";

const { validLiveRoomUrl } = loadModule("app/features/shared/live-room.ts", {}, { URL });
test("live room URLs preserve query parameters and reject unsafe destinations", () => {
  const url = "https://example.weizan.cn/v3/course/alive/123?v=456#chat";
  assert.equal(validLiveRoomUrl(` ${url} `), url);
  for (const invalid of [null, "", "http://example.com", "javascript:alert(1)", "https://", "https://user:pass@example.com", "https://example.com\\evil"]) {
    assert.equal(validLiveRoomUrl(invalid), null);
  }
});
test("exit is hidden without a valid link and has an accessible labeled button when configured", () => {
  const { H5LiveRoomExit } = loadModule("app/features/h5/H5LiveRoomExit.tsx", {}, { URL });
  const render = url => renderToStaticMarkup(React.createElement(H5LiveRoomExit, { url, disabled: false, prepare: async () => true }));
  assert.equal(render(null), "");
  assert.equal(render("javascript:alert(1)"), "");
  assert.match(render("https://example.com/live/123"), /aria-label="退出订货，返回直播间"/);
  assert.match(render("https://example.com/live/123"), /<span>退出<\/span>/);
});

test("saving a live room uses the selected activity and version, and supports clearing", async () => {
  const calls = [];
  const { updateActivityLiveRoom } = loadModule("app/services/api/activity.ts", {
    "./client": { api: async (...args) => { calls.push(args); return { data: { id: 42 } }; } },
    "./context": {},
  });
  await updateActivityLiveRoom({ id: 42, version: 7 }, " https://example.com/live/123 ");
  await updateActivityLiveRoom({ id: 43, version: 8 }, " ");
  assert.equal(calls[0][0], "/admin/activities/42/live-room");
  assert.equal(calls[0][1].headers["If-Match"], "7");
  assert.equal(JSON.parse(calls[0][1].body).liveRoomUrl, "https://example.com/live/123");
  assert.equal(calls[1][0], "/admin/activities/43/live-room");
  assert.equal(JSON.parse(calls[1][1].body).liveRoomUrl, null);
});
