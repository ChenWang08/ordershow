import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

const { productImportRowsConflict, productImportDuplicateRowIds } = loadModule("app/domain/import-domain.ts");

const productRow = (id, name = "测试商品") => ({
  id, materialName: name, status: "有效", imageStatus: "未匹配", materialCode: "SKU-1",
  customerType: "综合", rebate: "参与", category: "", line: "", description: "", brand: "",
  variety: "", spec: "", casePack: "", unitPrice: "", casePrice: "100", conversion: "",
  priceTierMinQuantity: "", priceTierCasePrice: "", priceTierPricingMode: "WHOLE_ORDER",
  gift: "否", branchScope: "", source: "excel",
});

const identityRow = (id, materialName, materialCode, customerType = "综合", rebate = "参与") => ({
  ...productRow(id, materialName), materialCode, customerType, rebate,
});

test("product identity distinguishes nonblank codes and falls back to names when a code is empty", () => {
  const codeA = identityRow("code-a", "同名商品", "A-01");
  const codeB = identityRow("code-b", "同名商品", "B-02");
  const sameCodeA = identityRow("same-code-a", "重复代码商品", "AA-01");
  const sameCodeB = identityRow("same-code-b", "重复代码商品", "aa_01");
  const missingCode = identityRow("missing-code", "空码混合商品", "");
  const populatedCode = identityRow("populated-code", "空码混合商品", "C-03");
  const emptyTypeA = identityRow("empty-type-a", "空类型商品", "T-01", "", "");
  const emptyTypeB = identityRow("empty-type-b", "空类型商品", "T-02", "", "");

  assert.equal(productImportRowsConflict(codeA, codeB), false);
  assert.equal(productImportRowsConflict(sameCodeA, sameCodeB), true);
  assert.equal(productImportRowsConflict(missingCode, populatedCode), true);
  assert.equal(productImportRowsConflict(emptyTypeA, emptyTypeB), false);
  assert.equal(productImportRowsConflict(codeA, { ...codeA, id: "other-type", customerType: "特渠" }), false);
  assert.equal(productImportRowsConflict(codeA, { ...codeA, id: "other-rebate", rebate: "不参与" }), false);

  const blankCodeA = identityRow("blank-a", "两个空码商品", "");
  const blankCodeB = identityRow("blank-b", "两个空码商品", "");
  const duplicateIds = productImportDuplicateRowIds([
    codeA, codeB, sameCodeA, sameCodeB, missingCode, populatedCode,
    blankCodeA, blankCodeB, emptyTypeA, emptyTypeB,
  ]);
  assert.deepEqual([...duplicateIds].sort(), [
    "blank-a", "blank-b", "missing-code", "populated-code", "same-code-a", "same-code-b",
  ]);
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
    "../../api": api, "../api": api,
    react: {
      useMemo: (calculate) => calculate(),
      useEffect: () => {},
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
      },
    },
  };
  const globals = { Error, window: { confirm: () => true }, URL };
  const { useProductImport } = loadModule("app/features/admin/useProductImport.ts", mocks, globals);
  const { useProductEditor } = loadModule("app/features/admin/useProductEditor.ts", mocks, globals);
  return {
    calls, notices, options, api,
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
  assert.match(harness.notices.at(-1), /未确认删除/);
});

test("adding products during an import preview is rejected", async () => {
  const harness = productHarness();
  harness.render().productImport.setProductFileName("products.xlsx");
  const result = await harness.render().productEditor.saveProductRow(productRow("new"));
  assert.equal(result.ok, false);
  assert.equal(harness.options.productRows.length, 1);
  assert.match(result.message, /导入预览阶段不能新增商品/);
});

test("a created product survives image failure and blocks repeating the create", async () => {
  let creates = 0;
  const harness = productHarness({ productImportCompleted: true }, {
    createAdminProduct: async () => { creates++; return { id: 81, version: 2, sortNo: 99, dataStatus: "ACTIVE", images: [] }; },
    addAdminProductImage: async () => { throw new Error("upload lost"); },
  });
  const row = { ...productRow("new"), images: [{ id: "local-image", file: {} }] };
  const result = await harness.render().productEditor.saveProductRow(row);
  assert.equal(result.ok, false); assert.equal(result.requiresReload, true);
  assert.match(result.message, /商品已添加/); assert.equal(creates, 1);
  const saved = harness.options.productRows.find(item => item.id === "81");
  assert.equal(saved.serverVersion, 2); assert.equal(saved.sequence, 99);
});

test("saved product edits preserve the new version when catalog refresh fails", async () => {
  const row = { ...productRow("42"), serverVersion: 1 };
  const harness = productHarness({ productImportCompleted: true, productRows: [row] }, {
    updateAdminProduct: async () => ({ id: 42, version: 2, dataStatus: "ACTIVE", images: [] }),
    loadAdminProductEditorState: async () => { throw new Error("refresh lost"); },
  });
  harness.render().productEditor.setEditingProductRow(row);
  const result = await harness.render().productEditor.saveProductRow({ ...row, branchScope: "新分公司" });
  assert.equal(result.requiresReload, true); assert.match(result.message, /商品资料已保存/);
  assert.equal(harness.options.productRows[0].serverVersion, 2);
});

test("uncertain product creates do not append a fake local row", async () => {
  const harness = productHarness({ productImportCompleted: true }, { createAdminProduct: async () => { throw new Error("offline"); } });
  const result = await harness.render().productEditor.saveProductRow(productRow("new"));
  assert.equal(result.requiresReload, true); assert.match(result.message, /新增结果尚未确认/);
  assert.equal(harness.options.productRows.length, 1);
});


const runtime = (id, extra = {}) => ({ id, materialName: "测试商品", materialCode: "SKU-1", customerType: "GENERAL", rebateStatus: "PARTICIPATING", casePrice: 100, tonCaseFactor: 50, images: [], version: 2, sortNo: 7, ...extra });
test("plain product saves merge authoritative row without directory or unchanged image requests", async()=>{
  const image={id:"5",url:"/api/v1/public/files/9",relationStatus:"CONFIRMED"};
  const original={...productRow("42"), serverVersion:1, images:[image]};
  const keep={...productRow("43"),serverVersion:3}; let writes=0;
  const h=productHarness({productImportCompleted:true, productRows:[original,keep]}, {
    updateAdminProduct:async()=>runtime(42,{description:"服务端标准化说明",version:6}),
    updateAdminProductImage:async()=>{writes++;},
  });
  h.render().productEditor.setEditingProductRow(original);
  assert.equal((await h.render().productEditor.saveProductRow({...original,casePrice:"120"})).ok,true);
  assert.deepEqual(h.calls,[]); assert.equal(writes,0); assert.equal(h.options.productRows[1],keep);
  assert.equal(h.options.productRows[0].serverVersion,6); assert.equal(h.options.productRows[0].description,"服务端标准化说明");
});
test("scope changes read only the target and same-name image changes merge every affected row", async()=>{
  for (const imagesChanged of [false,true]) {
    const original={...productRow("42"), serverVersion:1}; const keep=productRow("99","别的商品");
    let reads=0, uploads=0;
    const h=productHarness({productImportCompleted:true, productRows:[original,productRow("43"),keep]}, {
      updateAdminProduct:async()=>runtime(42), addAdminProductImage:async()=>{uploads++;return {id:11};},
      updateAdminProductImage:async()=>{},
      loadAdminProductEditorState:async(_a,id,names)=>{reads++;assert.equal(id,42); if(imagesChanged) assert.ok(names.includes("测试商品")); return {products:[runtime(42,{effectiveDealerCount:5}),...(imagesChanged?[runtime(43,{version:8})]:[])], reviews:[]};},
    });
    h.render().productEditor.setEditingProductRow(original);
    const next=imagesChanged?{...original,images:[{id:"new",file:{},url:"local-image:fixture",relationStatus:"CONFIRMED"}]}:{...original,branchScope:"A"};
    assert.equal((await h.render().productEditor.saveProductRow(next)).ok,true);
    assert.equal(reads,1); assert.equal(uploads,imagesChanged?1:0); assert.deepEqual(h.calls,[]);
    assert.equal(h.options.productRows[0].effectiveDealerCount,5); assert.equal(h.options.productRows[2],keep);
    if(imagesChanged) assert.equal(h.options.productRows[1].serverVersion,8);
  }
});
test("bulk product deletion keeps unconfirmed rows after a later failure", async()=>{
  const rows=[1,2,3].map(id=>({...productRow(String(id)),serverVersion:id})); const removed=[];
  const h=productHarness({productImportCompleted:true,productRows:rows},{deleteAdminProduct:async(_a,id)=>{if(id===2)throw new Error("conflict"); removed.push(id);}});
  await h.render().productEditor.deleteProductRows(["1","1","2","3"]);
  assert.deepEqual(removed,[1]); assert.deepEqual(h.options.productRows.map(r=>r.id),["2","3"]);
  assert.match(h.notices.at(-1),/已删除 1 条/);
});
test("published import readback failure clears retired IDs and cannot remain a repeatable preview", async()=>{
  let errors=0;
  const h=productHarness({onReadbackFailed:()=>errors++}, {loadAdminProducts:async()=>{throw new Error("offline");}});
  await h.render().productImport.confirmProductImport();
  assert.equal(h.options.productImportCompleted,true); assert.equal(h.options.serverImportTasks.PRODUCT,undefined);
  assert.equal(h.options.productRows.length,0); assert.equal(errors,1); assert.match(h.notices.at(-1),/已替换成功.*勿重复/);
});
test("running activity product create appends real identity without reading the directory",async()=>{
  const keep=productRow("42"); const h=productHarness({activityStatus:"running",productImportCompleted:true,productRows:[keep]},{
    createAdminProduct:async()=>runtime(81), loadAdminProductEditorState:async()=>({products:[runtime(81)],reviews:[]}),
  });
  assert.equal((await h.render().productEditor.saveProductRow(productRow("new"),"现场补录")).ok,true);
  assert.equal(h.options.productRows[0],keep); assert.equal(h.options.productRows[1].id,"81");
  assert.deepEqual(h.calls,[]);
});
