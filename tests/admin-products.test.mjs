import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

const productRow = (id, name = "测试商品") => ({
  id, materialName: name, status: "有效", imageStatus: "未匹配", materialCode: "SKU-1",
  customerType: "综合", rebate: "参与", category: "", line: "", description: "", brand: "",
  variety: "", spec: "", casePack: "", unitPrice: "", casePrice: "100", conversion: "",
  priceTierMinQuantity: "", priceTierCasePrice: "", priceTierPricingMode: "WHOLE_ORDER",
  gift: "否", branchScope: "", source: "excel",
});

function productHarness(overrides = {}, apiOverrides = {}) {
  const calls = [];
  const notices = [];
  const options = {
    activityId: "1", activityStatus: "draft", productRows: [productRow("preview")],
    productImportCompleted: false, productImportHasRun: true,
    serverImportTasks: { PRODUCT: 7, WHITELIST: 8 }, serverImportBlocking: { PRODUCT: 0, WHITELIST: 2 },
    setActionNotice: (notice) => notices.push(notice), recordOperation: () => {},
    onProductImportCommitted: () => calls.push("committed"),
    refreshServerImportPreview: async (type) => calls.push(`refresh:${type}`),
    ...overrides,
  };
  const update = (key) => (value) => {
    options[key] = typeof value === "function" ? value(options[key]) : value;
  };
  options.setProductRows = update("productRows");
  options.setProductImportCompleted = update("productImportCompleted");
  options.setServerImportTasks = update("serverImportTasks");
  options.setServerImportBlocking = update("serverImportBlocking");
  const api = {
    ApiError: class ApiError extends Error {},
    cancelImport: async (activityId, taskId) => calls.push(`cancel:${activityId}:${taskId}`),
    confirmImport: async (activityId, taskId) => calls.push(`confirm:${activityId}:${taskId}`),
    waitForImport: async () => calls.push("wait"),
    loadAdminProducts: async () => { calls.push("products"); return [{ id: 42, materialName: "服务端商品", version: 3, images: [], casePrice: "100" }]; },
    loadProductImageReviews: async () => { calls.push("reviews"); return []; },
    deleteImportRows: async (_activityId, _taskId, ids) => calls.push(`delete-staging:${ids.join(",")}`),
    deleteAdminProduct: async (_activityId, id, version) => calls.push(`delete-product:${id}:${version}`),
    ...apiOverrides,
  };
  // State adapter for unit-testing actions; does not emulate browser effects or mounting.
  const slots = [];
  let cursor = 0;
  const mocks = {
    "../../api": api,
    react: {
      useMemo: (calculate) => calculate(),
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
    },
  };
  const globals = { window: { confirm: () => true }, URL };
  const { useProductImport } = loadModule("app/features/admin/useProductImport.ts", mocks, globals);
  const { useProductEditor } = loadModule("app/features/admin/useProductEditor.ts", mocks, globals);
  return {
    calls, notices, options,
    render: function useProductRender() {
      cursor = 0;
      const productImport = useProductImport(options);
      return { productImport, productEditor: useProductEditor({ ...options, productImport }) };
    },
  };
}

test("cancelling a preview restores the published catalog and preserves other import tasks", async () => {
  const harness = productHarness();
  const original = [productRow("published")];
  harness.render().productImport.setPendingProductRollbackRows(original);
  await harness.render().productImport.cancelProductImport();
  assert.equal(harness.options.productRows[0].id, "published");
  assert.notEqual(harness.options.productRows[0], original[0]);
  assert.equal(harness.options.productImportCompleted, true);
  assert.equal(harness.options.serverImportTasks.PRODUCT, undefined);
  assert.equal(harness.options.serverImportTasks.WHITELIST, 8);
  assert.equal(harness.options.serverImportBlocking.WHITELIST, 2);
  assert.deepEqual(harness.calls, ["cancel:1:7"]);
});

test("failed cancellation retains preview and task for retry", async () => {
  const harness = productHarness({}, { cancelImport: async () => { throw new Error("offline"); } });
  const rows = harness.options.productRows;
  harness.render().productImport.setPendingProductRollbackRows([productRow("published")]);
  await harness.render().productImport.cancelProductImport();
  assert.equal(harness.options.productRows, rows);
  assert.equal(harness.options.productImportCompleted, false);
  assert.equal(harness.options.serverImportTasks.PRODUCT, 7);
  assert.match(harness.notices.at(-1), /取消商品导入失败/);
});

test("blocked preview cannot publish", async () => {
  const harness = productHarness({ serverImportBlocking: { PRODUCT: 2 } });
  await harness.render().productImport.confirmProductImport();
  assert.deepEqual(harness.calls, []);
  assert.equal(harness.options.productImportCompleted, false);
  assert.match(harness.notices.at(-1), /仍有 2 条商品异常/);
});

test("confirmation replaces preview with the server catalog after publication finishes", async () => {
  const harness = productHarness();
  await harness.render().productImport.confirmProductImport();
  assert.deepEqual(harness.calls, ["confirm:1:7", "wait", "products", "reviews", "committed"]);
  assert.equal(harness.options.productRows[0].id, "42");
  assert.equal(harness.options.productRows[0].serverVersion, 3);
  assert.equal(harness.options.productImportCompleted, true);
});

test("failed publication does not mark the import completed", async () => {
  const harness = productHarness({}, { waitForImport: async () => { throw new Error("failed"); } });
  const rows = harness.options.productRows;
  await harness.render().productImport.confirmProductImport();
  assert.equal(harness.options.productRows, rows);
  assert.equal(harness.options.productImportCompleted, false);
  assert.deepEqual(harness.calls, ["confirm:1:7"]);
});

test("published activities reject bulk product mutations", async () => {
  for (const activityStatus of ["scheduled", "running", "closed", "finished"]) {
    const harness = productHarness({ activityStatus });
    const rows = harness.options.productRows;
    const { productImport, productEditor } = harness.render();
    productImport.beginProductImport();
    await productImport.handleProductFile({ name: "products.xlsx" });
    await productImport.handleProductImageFile({ name: "images.zip" });
    productImport.removeProductImages();
    await productImport.confirmProductImport();
    await productEditor.deleteProductRows(["preview"]);
    assert.equal(harness.options.productRows, rows);
    assert.deepEqual(harness.calls, []);
  }
});

test("preview deletion uses staging IDs and refreshes validation", async () => {
  const harness = productHarness({ productRows: [{ ...productRow("preview"), serverRowId: 31 }, productRow("keep")] });
  await harness.render().productEditor.deleteProductRows(["preview"]);
  assert.deepEqual(harness.calls, ["delete-staging:31", "refresh:PRODUCT"]);
  assert.equal(harness.options.productRows.length, 1);
  assert.equal(harness.options.productRows[0].id, "keep");
});

test("published catalog deletion uses the product version", async () => {
  const harness = productHarness({ productImportCompleted: true, productRows: [{ ...productRow("42"), serverVersion: 3 }] });
  await harness.render().productEditor.deleteProductRows(["42"]);
  assert.deepEqual(harness.calls, ["delete-product:42:3"]);
  assert.equal(harness.options.productRows.length, 0);
});

test("a failed product deletion keeps the local row", async () => {
  const harness = productHarness({ productImportCompleted: true, productRows: [{ ...productRow("42"), serverVersion: 3 }] }, {
    deleteAdminProduct: async () => { throw new Error("version conflict"); },
  });
  const rows = harness.options.productRows;
  await harness.render().productEditor.deleteProductRows(["42"]);
  assert.equal(harness.options.productRows, rows);
  assert.match(harness.notices.at(-1), /商品移除失败/);
});

test("adding products during an import preview is rejected", async () => {
  const harness = productHarness();
  harness.render().productImport.setProductFileName("products.xlsx");
  const result = await harness.render().productEditor.saveProductRow(productRow("new"));
  assert.equal(result, false);
  assert.equal(harness.options.productRows.length, 1);
  assert.match(harness.notices.at(-1), /导入预览阶段不能新增商品/);
});
