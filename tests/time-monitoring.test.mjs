import assert from "node:assert/strict";
import test from "node:test";
import { notificationAgeMs } from "./load/time-metrics.mjs";

test("notification metrics retain real latency and reject the eight-hour timezone error", () => {
  const now = Date.parse("2026-10-19T05:41:03Z");
  assert.equal(notificationAgeMs("2026-10-19T05:41:02.500Z", now), 500);
  assert.equal(notificationAgeMs("2026-10-19T13:41:02.500+08:00", now), 500);
  assert.equal(notificationAgeMs(now, now), 0);
  assert.throws(() => notificationAgeMs("2026-10-19T13:41:02.500Z", now), /negative notification age/);
  assert.throws(() => notificationAgeMs("invalid", now), /Invalid/);
});
