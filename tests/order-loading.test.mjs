import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";

const ApiError = class extends Error {};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const row = (id = 1) => ({ id, orderNo: `ORDER-${id}`, status: "SUBMITTED", dealerFullName: "Dealer", phone: "13800000000", customerType: "GENERAL", totalAmount: 10, totalQuantity: 1, currentVersion: 2, lockVersion: 3, pendingChangeRequestId: 900 + id });
const page = (number = 1, total = 125, data = [row(number)]) => ({ data, page: { number, size: 50, totalElements: total, totalPages: Math.ceil(total / 50) } });
const counts = { all: 125, submitted: 100, withdrawn: 20, voided: 5, pending: 12 };
const listHarness = (loader = async (_id, filters) => page(filters.page), enabled = true) => {
  const calls = [];
  const h = hookHarness("app/components/orders/useOrderList.ts", "useOrderList", [1, "活动", enabled, 0], {
    "../../api": { ApiError, loadAdminOrders: (...args) => { calls.push(args); return loader(...args); }, loadAdminOrder: async () => row() },
  });
  return { h, calls, async settle() { await h.flush(); await h.runTimers(); } };
};

test("orders load on entry/return; a direct page jump reads only that page with size 50", async () => {
  const { h, calls, settle } = listHarness(undefined, false);
  await settle(); assert.equal(calls.length, 0);
  h.render([1, "活动", true, 0]); await settle(); assert.equal(calls.length, 1);
  h.model.setPage(3); await settle();
  assert.deepEqual(calls.map(call => [call[1].page, call[1].size]), [[1, 50], [3, 50]]);
  assert.equal(h.model.filteredOrders[0].no, "ORDER-3");
  for (let i = 0; i < 5; i++) h.render(); await settle(); assert.equal(calls.length, 2);
  h.render([1, "活动", false, 0]); await settle();
  h.render([1, "活动", true, 0]); await settle(); assert.equal(calls.length, 3);
  assert.equal(h.intervals.size, 0); h.unmount();
});

test("server search results are retained without a second case-sensitive client filter", async () => {
  const { h, calls, settle } = listHarness(); await settle();
  h.model.setSearch("dealer"); h.model.setCustomerType("综合"); h.model.setOrderFilter("已提交"); h.model.setPage(1);
  await settle(); assert.equal(calls.length, 2);
  assert.equal(calls[1][1].customerType, "GENERAL"); assert.equal(calls[1][1].status, "SUBMITTED");
  assert.equal(h.model.filteredOrders.length, 1);
  assert.equal(h.model.total, 125); h.unmount();
});

test("orders debounce rapid searches and abort superseded and departed reads", async () => {
  const pending = [];
  const { h, calls, settle } = listHarness((...args) => { const d = deferred(); pending.push({ ...d, signal: args[2] }); return d.promise; });
  await settle();
  h.model.setSearch("a"); await h.flush(); h.model.setSearch("ab"); await h.flush();
  await h.runTimers(); assert.equal(calls.length, 2); assert.equal(calls[1][1].keyword, "ab");
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve(page(1, 1, [row(2)])); await h.flush();
  pending[0].resolve(page(1, 1, [row(1)])); await h.flush();
  assert.equal(h.model.filteredOrders[0].id, 2);
  h.model.setReloadKey(v => v + 1); await settle(); h.unmount(); const writes = h.writes;
  pending[2].resolve(page()); await h.flush(); assert.equal(h.writes, writes);
});

test("orders recover an emptied last page and support an empty activity", async () => {
  let total = 101;
  const { h, calls, settle } = listHarness(async (_id, filters) => page(filters.page, total)); await settle();
  h.model.setPage(3); await settle(); total = 100;
  h.model.setReloadKey(v => v + 1); await settle(); await settle();
  assert.equal(h.model.page, 2); assert.equal(h.model.totalPages, 2);
  assert.deepEqual(calls.map(c => c[1].page), [1, 3, 3, 2]);
  total = 0; h.model.setReloadKey(v => v + 1); await settle(); await settle();
  assert.equal(h.model.page, 1); assert.equal(h.model.totalPages, 1); assert.equal(h.model.total, 0); h.unmount();
});

test("a failed order refresh preserves its page and can be retried; another activity hides its rows", async () => {
  let fail = false;
  const { h, settle } = listHarness(async (_id, filters) => { if (fail) throw new ApiError("列表故障"); return page(filters.page); });
  await settle(); fail = true; h.model.setReloadKey(v => v + 1); await settle();
  assert.equal(h.model.filteredOrders.length, 1); assert.match(h.model.loadError, /列表故障/);
  fail = false; h.model.setReloadKey(v => v + 1); await settle(); assert.equal(h.model.loadError, "");
  h.render([2, "另一个活动", true, 0]); assert.equal(h.model.filteredOrders.length, 0); await settle(); h.unmount();
});

test("opening an order detail retains its current-page review shortcut", async () => {
  const { h, settle, calls } = listHarness(); await settle();
  await h.model.openOrder(h.model.filteredOrders[0]); await h.flush();
  assert.equal(h.model.filteredOrders[0].pendingChangeRequestId, 901);
  h.model.setSelectedNo(null); await settle(); assert.equal(calls.length, 1); h.unmount();
});

test("summary loads once per entry/revision/mutation and never polls on idle rerenders", async () => {
  let reads = 0;
  const h = hookHarness("app/components/orders/useOrderSummary.ts", "useOrderSummary", [1, false, "orders", 0, 0], {
    "../../api": { loadAdminOrderCounts: async () => { reads++; return counts; } },
  });
  await h.flush(); assert.equal(reads, 0);
  h.render([1, true, "orders", 0, 0]); await h.flush(); assert.equal(reads, 1);
  for(let i = 0; i < 5; i++) h.render(); await h.flush(); assert.equal(reads, 1);
  h.render([1, true, "review", 0, 0]); await h.flush(); assert.equal(reads, 2);
  h.render([1, true, "review", 0, 1]); await h.flush(); assert.equal(reads, 3);
  h.render([1, true, "review", 1, 1]); await h.flush(); assert.equal(reads, 4);
  await Promise.all([h.model.refresh(), h.model.refresh()]); await h.flush(); assert.equal(reads, 5);
  h.render([1, false, "review", 1, 1]); await h.flush();
  h.render([1, true, "review", 1, 1]); await h.flush(); assert.equal(reads, 6);
  assert.equal(h.intervals.size, 0); h.unmount();
});

test("summary failure uses unknown or previous counts; retry and activity isolation work", async () => {
  let fail = true;
  const h = hookHarness("app/components/orders/useOrderSummary.ts", "useOrderSummary", [1, true, "orders"], {
    "../../api": { loadAdminOrderCounts: async () => { if(fail) throw new Error("数量故障"); return counts; } },
  });
  await h.flush(); assert.equal(h.model.data, undefined); assert.match(h.model.error, /数量故障|加载失败/);
  fail = false; await h.model.refresh(); await h.flush(); assert.equal(h.model.data.all, 125);
  fail = true; await h.model.refresh(); await h.flush(); assert.equal(h.model.data.all, 125);
  h.render([2, true, "orders"]); assert.equal(h.model.data, undefined); await h.flush(); h.unmount();
});

const reviewHarness = (overrides = {}, onChanged = () => {}) => {
  const calls = [];
  const h = hookHarness("app/components/orders/useOrderChangeRequests.ts", "useOrderChangeRequests", [1, onChanged, true, 0], {
    "../../api": { ApiError, loadOrderChangePage: async (_id, filters) => { calls.push({ ...filters }); return page(filters.page, 125, [{ id: 901, orderId: 1 }]); },
      loadPendingOrderChanges: () => { throw new Error("full pending IDs must not be read"); },
      loadOrderChangeDetail: async () => ({ id: 901, orderId: 1, status: "PENDING" }), loadAdminOrder: async () => row(),
      approveAdminOrderChangeRequest: async () => ({ id: 901, status: "APPROVED" }),
      rejectAdminOrderChangeRequest: async () => ({ id: 901, status: "REJECTED" }), ...overrides },
  });
  return { h, calls };
};

test("review page jumps, filters, sorting and refresh use only bounded pages", async () => {
  const { h, calls } = reviewHarness(); await h.flush();
  h.model.setFilters({ ...h.model.filters, page: 3 }); await h.flush();
  assert.deepEqual(calls.map(c => [c.page,c.size]), [[1,50],[3,50]]);
  assert.equal(h.model.total, 125); assert.equal(h.model.requests[0].id, 901);
  for(const patch of [{status:"APPROVED"},{type:"WITHDRAW"},{keyword:"经销商"},{newest:true}]) {
    h.model.setFilters({ ...h.model.filters, ...patch, page: 1 }); await h.flush();
  }
  const before = calls.length; await Promise.all([h.model.reload(),h.model.reload()]); await h.flush();
  assert.equal(calls.length, before + 1); assert.equal(h.intervals.size, 0); h.unmount();
});

for (const approve of [true, false]) test(`review ${approve ? "approval" : "rejection"} reloads once and notifies once`, async () => {
  let changed = 0;
  const { h, calls } = reviewHarness({}, () => changed++); await h.flush();
  await h.model.open(901); await h.flush(); h.model.setReason("核对完成"); await h.flush();
  await h.model.review(approve); await h.flush();
  assert.equal(calls.length, 2); assert.equal(changed, 1); assert.equal(h.model.selected.status, approve ? "APPROVED" : "REJECTED");
  h.model.setSelected(null); await h.flush(); assert.equal(calls.length, 2); h.unmount();
});

test("review requires rejection reason, recovers failures and reports server version conflicts", async () => {
  let fail = true;
  const { h, calls } = reviewHarness({ approveAdminOrderChangeRequest: async () => {
    if(fail) throw new ApiError("审核故障"); return { id:901,status:"REJECTED",reviewReason:"订单版本已变化" };
  } }); await h.flush(); await h.model.open(901); await h.flush();
  await h.model.review(false); await h.flush(); assert.equal(calls.length, 1); assert.match(h.model.error,/请填写/);
  await h.model.review(true); await h.flush(); assert.equal(calls.length, 2); assert.match(h.model.error,/审核故障/);
  assert.equal(h.model.busyId,null); fail = false;
  await h.model.review(true); await h.flush(); assert.match(h.model.error,/订单版本已变化/); h.unmount();
});

test("review clamps a page after the last pending item is processed", async () => {
  let total = 51;
  const { h } = reviewHarness({ loadOrderChangePage: async (_id, filters) => page(filters.page,total,[]) });
  await h.flush(); h.model.setFilters({...h.model.filters,page:2}); await h.flush();
  total = 50; await h.model.reload(); await h.flush();
  assert.equal(h.model.filters.page,1); assert.equal(h.model.total,50); h.unmount();
});

test("late review list and detail responses cannot replace another activity", async () => {
  const details = [], lists = [];
  const { h } = reviewHarness({ loadOrderChangePage: (...args) => { const d=deferred(); lists.push({...d,signal:args[2]}); return d.promise; },
    loadOrderChangeDetail: (...args) => { const d=deferred(); details.push({...d,signal:args[2]}); return d.promise; } });
  await h.flush(); const old = h.model.open(901); await h.flush();
  h.render([2, undefined, true, 0]); await h.flush();
  assert.equal(lists[0].signal.aborted,true); assert.equal(details[0].signal.aborted,true);
  lists[1].resolve(page(1,1,[{id:999}])); await h.flush();
  lists[0].resolve(page(1,1,[{id:901}])); details[0].resolve({id:901,orderId:1}); await old; await h.flush();
  assert.equal(h.model.requests[0].id,999); assert.equal(h.model.selected,null); h.unmount();
});

test("pagination exposes all page numbers and fixed 50 rows, with correct endpoint controls", () => {
  const {OrderPagination}=loadModule("app/components/orders/OrderPagination.tsx");
  const html=renderToStaticMarkup(React.createElement(OrderPagination,{page:1,totalPages:93,total:4630,loading:false,onPage:()=>{}}));
  assert.match(html,/每页 50 条/); assert.match(html,/value="93"/); assert.equal((html.match(/<select/g)||[]).length,1);
  assert.match(html,/<button disabled="">上一页/);
  const last=renderToStaticMarkup(React.createElement(OrderPagination,{page:93,totalPages:93,total:4630,loading:false,onPage:()=>{}}));
  assert.match(last,/<button disabled="">下一页/);
});
