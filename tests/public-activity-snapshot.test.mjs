import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { readPublicActivity } from "./helpers/public-activity-snapshot.mjs";

async function fixture(t, handle) {
  const server = createServer(handle); server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}/api/v1`;
}

test("public scripts read a finite HTTP JSON response without opening SSE", async t => {
  const activity = { id: 42, code: "活动A", name: "活动资料", regions: [] };
  const base = await fixture(t, (req, res) => {
    assert.equal(req.url, "/api/v1/public/activities/%E6%B4%BB%E5%8A%A8A");
    assert.equal(req.headers.accept, "application/json");
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ data: activity }));
  });
  assert.deepEqual(await readPublicActivity(base, activity.code), activity);
});

test("HTTP script timeout bounds an incomplete JSON body", async t => {
  const paths = [];
  const base = await fixture(t, (req, res) => {
    paths.push(req.url); res.writeHead(200, { "Content-Type": "application/json" }); res.write('{"data":');
  });
  await assert.rejects(readPublicActivity(base, "A", { timeoutMs: 100 }), /abort|timeout/i);
  assert.deepEqual(paths, ["/api/v1/public/activities/A"]);
});

test("HTTP scripts reject wrong-activity responses and service errors", async t => {
  for (const [status, body, error] of [[200, { data: { code: "B" } }, /different activity/], [503, {}, /HTTP 503/]]) {
    const base = await fixture(t, (_req, res) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); });
    await assert.rejects(readPublicActivity(base, "A"), error);
  }
});
