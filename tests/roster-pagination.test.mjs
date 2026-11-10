import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";

const page = (number = 1, total = 5006) => ({ data: [{ id: number }], page: { number, size: 50, totalElements: total, totalPages: Math.ceil(total / 50) }, summary: { total: 5006, valid: 5006, pending: 0, published: 1 }, revisions: {}, customerTypes: ["GENERAL"], branches: [] });

test("roster reads exactly the requested page and retains totals and cancellation", async () => {
  const calls = [], signal = new AbortController().signal;
  const api = loadModule("app/services/api/customers.ts", { "./client": { api: async (...args) => { calls.push(args); return page(3); } } }, { URLSearchParams });
  const result = await api.loadRosterPage(42, "customers", { page: 3, size: 50, keyword: "张 & 李", customerType: "GENERAL", branch: "", status: "", matchStatus: "" }, signal);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0][0], "http://test.invalid");
  assert.equal(url.pathname, "/admin/activities/42/customers/page");
  assert.equal(url.searchParams.get("page"), "3"); assert.equal(url.searchParams.get("size"), "50");
  assert.equal(url.searchParams.get("keyword"), "张 & 李"); assert.equal(calls[0][1].signal, signal);
  assert.equal(result.page.totalElements, 5006);
});

test("paged state rejects stale filters and separates page rows from full summaries", async () => {
  const h = hookHarness("app/features/admin/useRosterState.ts", "useRosterState", ["account1:activity1"]);
  const original = h.model.query;
  assert.equal(original.size, 50);
  h.model.apply(page(), original); await h.flush();
  assert.equal(h.model.page.data.length, 1); assert.equal(h.model.response.summary.total, 5006);
  h.model.change({ page: 1, size: 50 }); await h.flush();
  assert.equal(h.model.page.data.length, 1, "choosing the current page/size must not strand the list in loading");
  h.model.change({ page: 2 }); await h.flush();
  assert.equal(h.model.page, null); assert.equal(h.model.response.summary.total, 5006);
  h.model.apply(page(), original); await h.flush(); assert.equal(h.model.page, null);
  h.model.apply(page(2), h.model.query); await h.flush(); assert.equal(h.model.page.page.number, 2);
  h.model.change({ keyword: "无此客户", page: 1 }); await h.flush();
  h.model.apply(page(1, 0), h.model.query); await h.flush();
  assert.equal(h.model.page.page.totalElements, 0); assert.equal(h.model.response.summary.published, 1);
  h.render(["account2:activity2"]); await h.flush();
  assert.equal(h.model.response, null); assert.equal(h.model.query.page, 1); assert.equal(h.model.query.keyword, "");
  h.unmount();
});

test("deleted final pages can clamp to the last valid page and reset after import", async () => {
  const h = hookHarness("app/features/admin/useRosterState.ts", "useRosterState", ["scope"]);
  h.model.change({ page: 101 }); await h.flush();
  h.model.apply(page(100, 5000), h.model.query); await h.flush();
  assert.equal(h.model.query.page, 100); assert.equal(h.model.page.page.number, 100);
  h.model.reload(true); await h.flush();
  assert.equal(h.model.query.page, 1); assert.equal(h.model.page, null);
  h.unmount();
});

test("published attendance totals and eligibility are global rather than current-page counts", () => {
  const { AttendancePage } = loadModule("app/features/admin/attendance/AttendancePage.tsx", {
    "../ImportTemplateDownload": { ImportTemplateDownload: () => null, ImportTemplateHint: () => null },
    "../attendance/AttendanceTable": { AttendanceTable: () => createElement("div", null, "legacy preview table") },
  });
  const html = renderToStaticMarkup(createElement(AttendancePage, {
    rows: [], fileName: "已发布", warnings: [], sheetCounts: [], error: "", activityStarted: false, activityClosed: false,
    pendingImport: null, blockingCount: 0, previewLoading: false, previewReady: false, publishing: false,
    publishedTable: createElement("div", null, "paged published table"),
    publishedSummary: { total: 5006, linked: 5005, eligible: 5004, pending: 0, unmatched: 1, comprehensive: 2503, special: 2502, blankType: 1, phone: 5006 },
  }));
  assert.match(html, /5006/); assert.match(html, /5005／5004/); assert.match(html, /paged published table/);
  assert.doesNotMatch(html, /legacy preview table/);
});
