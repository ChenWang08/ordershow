import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./helpers/load-ts-module.mjs";

function stateAdapter() {
  let cursor = 0;
  const slots = [];
  return {
    reset() { cursor = 0; },
    react: {
      useEffect: () => {},
      useMemo: (compute) => compute(),
      useCallback(callback) { const index = cursor++; return slots[index] ??= callback; },
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) {
          const slot = { value: typeof initial === "function" ? initial() : initial };
          slot.set = (value) => { slot.value = typeof value === "function" ? value(slot.value) : value; };
          slots[index] = slot;
        }
        return [slots[index].value, slots[index].set];
      },
    },
  };
}

test("import workspaces retain separate data and stable setters across renders", () => {
  const adapter = stateAdapter();
  const { useImportWorkspaceState } = loadModule("app/features/workspace/useImportWorkspaceState.ts", { react: adapter.react });
  function useRender() { adapter.reset(); return useImportWorkspaceState(); }
  const initial = useRender();
  initial.products.setRows([{ id: "product" }]);
  initial.whitelist.setRows([{ id: "customer" }]);
  initial.attendance.setRows([{ id: "attendee" }]);
  initial.products.markCommitted();
  const updated = useRender();
  assert.equal(updated.products.rows[0].id, "product");
  assert.equal(updated.whitelist.rows[0].id, "customer");
  assert.equal(updated.attendance.rows[0].id, "attendee");
  assert.equal(updated.products.hasRun, true);
  assert.equal(updated.products.markCommitted, initial.products.markCommitted);
  assert.equal(updated.products.setRows, initial.products.setRows);
  updated.products.setRows([]);
  assert.equal(useRender().whitelist.rows[0].id, "customer");
  assert.equal(useRender().attendance.rows[0].id, "attendee");
});

const marker = (name) => function SurfaceMarker() { return React.createElement("span", { "data-surface": name }); };
const { OrderShowApp } = loadModule("app/order-show-app.tsx", {
  "./features/admin/AdminEntry": { AdminEntry: marker("admin") },
  "./useActivityRuntime": { useActivityRuntime: () => ({ activityName: "测试活动", runtimeConnected: true, runtimeActivity: null }) },
  "./features/workspace/SurfaceConnections": { H5Surface: marker("h5"), AdminSurface: marker("admin"), LotterySurface: marker("lottery") },
  "./features/screens/ScreenBoards": { OrderDashboard: marker("dashboard"), RankingBoard: marker("ranking"), ReportBoard: marker("report") },
});

test("combined preview keeps H5 mounted while another surface is visible", () => {
  const html = renderToStaticMarkup(React.createElement(OrderShowApp, { initialSurface: "admin", showSurfaceTabs: true }));
  assert.match(html, /surface-slot surface-hidden/);
  assert.match(html, /data-surface="h5"/);
  assert.match(html, /data-surface="admin"/);
  assert.equal((html.match(/data-surface="admin"/g) ?? []).length, 1);
});

test("dedicated routes mount only their requested surface", () => {
  const html = renderToStaticMarkup(React.createElement(OrderShowApp, { initialSurface: "admin", showSurfaceTabs: false }));
  assert.doesNotMatch(html, /data-surface="h5"/);
  assert.match(html, /data-surface="admin"/);
});

const customer = { id: 12, customerType: "GENERAL", branchName: "测试分公司", dealerFullName: "测试客户", phone: "13800000000", active: true };
const product = { id: 21, materialName: "测试商品", casePrice: 100, customerType: "GENERAL", branchScope: [], orderable: true };
const runtimeOrder = { id: 31, activityCustomerId: 12, orderNo: "TEST-ORDER", customerType: "GENERAL", dealerFullName: "测试客户", phone: "13800000000", currentVersion: 2, lockVersion: 3, totalQuantity: 2, totalAmount: 200, status: "SUBMITTED", versions: [], operations: [], items: [{ productId: 21, materialName: "测试商品", quantity: 2, casePrice: 100, lineAmount: 200 }] };

function editorHarness(overrides = {}) {
  const calls = [];
  const adapter = stateAdapter();
  const state = { orders: [], selectedNo: null, reload: 0, error: "" };
  const api = {
    ApiError: class ApiError extends Error {},
    loadOrderProducts: async () => [product],
    loadAdminOrder: async () => runtimeOrder,
    createAdminOrder: async (...args) => { calls.push(["create", ...args]); return runtimeOrder; },
    adjustAdminOrder: async (...args) => { calls.push(["adjust", ...args]); return runtimeOrder; },
    ...overrides,
  };
  const { useOrderEditor } = loadModule("app/components/orders/useOrderEditor.ts", { react: adapter.react, "../../api": api });
  const set = (key) => (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const options = { activityId: 7, selected: null, setOrders: set("orders"), setSelectedNo: set("selectedNo"), setReloadKey: set("reload"), setLoadError: set("error") };
  return { calls, state, render: function useRenderEditor() { adapter.reset(); return useOrderEditor(options); } };
}

test("order creation requires a customer, nonempty items, reason and server preview", async () => {
  const harness = editorHarness();
  await harness.render().openCreateEditor();
  await harness.render().selectEditorCustomer(customer);
  harness.render().setEditorQuantity(21, 2);
  await harness.render().saveEditor();
  assert.deepEqual(harness.calls, []);
  harness.render().setEditorReason("客户确认");
  await harness.render().saveEditor();
  assert.deepEqual(harness.calls, []);
  harness.render().setEditorPreview({ totalAmount: 200, totalQuantity: 2, totalTons: null });
  await harness.render().saveEditor();
  assert.equal(harness.calls[0][0], "create");
  assert.equal(harness.calls[0][1], 7);
  assert.equal(harness.calls[0][2], 12);
  assert.equal(harness.state.selectedNo, "TEST-ORDER");
  assert.equal(harness.render().editorMode, null);
});

test("changing quantity invalidates the previous server price preview", async () => {
  const harness = editorHarness();
  await harness.render().openCreateEditor();
  await harness.render().selectEditorCustomer(customer);
  harness.render().setEditorPreview({ totalAmount: 200 });
  harness.render().setEditorQuantity(21, 3.9);
  assert.equal(harness.render().editorPreview, null);
  assert.equal(harness.render().editorQuantities[21], 3);
  harness.render().setEditorQuantity(21, -1);
  assert.equal(harness.render().editorItems.length, 0);
});

test("adjustment sends the loaded order and lock versions", async () => {
  const harness = editorHarness();
  await harness.render().openAdjustEditor({ id: 31 });
  harness.render().setEditorReason("确认调整");
  harness.render().setEditorQuantity(21, 4);
  harness.render().setEditorPreview({ totalAmount: 400, totalQuantity: 4, totalTons: null });
  await harness.render().saveEditor();
  assert.deepEqual(harness.calls[0].slice(0, 5), ["adjust", 7, 31, 2, 3]);
  assert.equal(harness.calls[0][5][0].quantity, 4);
});

test("save failure retains the order editor for retry", async () => {
  const harness = editorHarness({ createAdminOrder: async () => { throw new Error("offline"); } });
  await harness.render().openCreateEditor();
  await harness.render().selectEditorCustomer(customer);
  harness.render().setEditorQuantity(21, 2);
  harness.render().setEditorReason("客户确认");
  harness.render().setEditorPreview({ totalAmount: 200 });
  await harness.render().saveEditor();
  assert.equal(harness.render().editorMode, "create");
  assert.equal(harness.render().editorBusy, false);
  assert.equal(harness.render().editorQuantities[21], 2);
  assert.equal(harness.state.orders.length, 0);
  assert.match(harness.render().editorError, /订单保存失败/);
});
