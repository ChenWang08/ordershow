import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { readPublicActivity } from "./helpers/public-activity-snapshot.mjs";

async function fixture(t, handle) {
  const server = createServer(handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/api/v1`;
}

test("public metadata scripts use the initial SSE frame and release the live connection", async t => {
  let closed;
  const disconnected = new Promise(resolve => { closed = resolve; });
  const activity = { id: 42, code: "活动A", name: "活动资料", regions: [{ code: "R1", name: "华北新区" }], desktopBackgroundUrl: "/image.jpg" };
  const base = await fixture(t, (req, res) => {
    assert.equal(req.url, "/api/v1/public/activities/%E6%B4%BB%E5%8A%A8A/events");
    assert.equal(req.headers.accept, "text/event-stream");
    res.on("close", closed);
    res.writeHead(200, { "Content-Type": "text/event-stream;charset=UTF-8" });
    res.write(": initial comment\r\nevent: heartbeat\r\ndata: {}\r\n\r\n");
    const frame = Buffer.from(`event: activity\r\ndata: ${JSON.stringify({ version: "1", activity })}\r\n\r\n`);
    res.write(frame.subarray(0, 51));
    setImmediate(() => res.write(frame.subarray(51)));
  });
  assert.deepEqual(await readPublicActivity(base, activity.code), activity);
  await Promise.race([disconnected, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("SSE test connection was not closed")), 1000);
    timer.unref();
  })]);
});

test("SSE snapshot reads have a bounded wait and never fall back to the retired GET", async t => {
  const paths = [];
  const base = await fixture(t, (req, res) => {
    paths.push(req.url);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("event: heartbeat\ndata: {}\n\n");
  });
  await assert.rejects(readPublicActivity(base, "A", { timeoutMs: 100 }), /abort|timeout/i);
  assert.deepEqual(paths, ["/api/v1/public/activities/A/events"]);
});

test("unavailable, wrong-activity, incomplete and failed streams are reported instead of returning stale metadata", async t => {
  for (const [name, status, body, error] of [
    ["unavailable", 200, 'event: unavailable\ndata: {"code":"ACTIVITY_NOT_FOUND"}\n\n', /ACTIVITY_NOT_FOUND/],
    ["wrong", 200, 'event: activity\ndata: {"activity":{"code":"B"}}\n\n', /different activity/],
    ["incomplete", 200, 'event: heartbeat\ndata: {}\n\n', /ended before/],
    ["busy", 503, '{}', /HTTP 503/],
  ]) {
    await t.test(name, async t => {
      const base = await fixture(t, (_req, res) => { res.writeHead(status, { "Content-Type": "text/event-stream" }); res.end(body); });
      await assert.rejects(readPublicActivity(base, "A"), error);
    });
  }
});
