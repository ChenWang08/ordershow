import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost:3000" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ordering system shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>订货会管理系统<\/title>/);
  assert.match(html, /客户订货 H5、实时数据大屏、专题战报、幸运抽奖和管理后台/);
  assert.match(html, /订货 H5/);
  assert.match(html, /订单看板/);
  assert.match(html, /订货排行/);
  assert.match(html, /专题战报/);
  assert.match(html, /幸运抽奖/);
  assert.match(html, /管理后台/);
  assert.match(html, /选择您的订货通道/);
  assert.match(html, /综合客户订货/);
  assert.match(html, /特渠专业客户订货/);
  assert.match(html, /\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("keeps product and social preview assets available", async () => {
  for (const path of ["../public/product-atlas.png", "../public/og.png", "../public/favicon.svg"]) {
    await access(new URL(path, import.meta.url));
  }
});
