import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
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

test("server-renders the ordering prototype shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>订货会 · 交互原型<\/title>/);
  assert.match(html, /客户订货 H5、实时数据大屏、幸运抽奖和管理后台交互原型/);
  assert.match(html, /订货 H5/);
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

test("keeps production assets and source wired", async () => {
  const [page, prototype, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/prototype.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<Prototype \/>/);
  assert.match(prototype, /function H5Prototype/);
  assert.match(prototype, /function RankingBoard/);
  assert.match(prototype, /function ReportBoard/);
  assert.match(prototype, /function LotteryBoard/);
  assert.match(prototype, /function AdminPrototype/);
  assert.match(layout, /generateMetadata/);
  assert.match(css, /product-atlas\.png/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await access(new URL("../public/product-atlas.png", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
