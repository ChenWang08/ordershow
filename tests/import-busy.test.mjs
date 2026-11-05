import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hookHarness } from "./helpers/hook-harness.mjs";
import { loadModule } from "./helpers/load-ts-module.mjs";

const product = {
  id: "preview", materialName: "测试商品", materialCode: "SKU-1", status: "有效", imageStatus: "未匹配",
  customerType: "综合", rebate: "参与", category: "", line: "", description: "", brand: "", variety: "",
  spec: "", casePack: "", unitPrice: "", casePrice: "100", conversion: "", gift: "否", branchScope: "", source: "excel",
};
const customer = {
  id: "preview", customerType: "综合客户", region: "华东", branch: "测试分公司", dealerShort: "测试客户",
  dealerFull: "测试客户有限公司", dealerType: "", dealerName: "联系人", dealerPhone: "13800000000",
  confirmerName: "", confirmerPhone: "", status: "有效", source: "excel",
};

function importHarness(kind, apiOverrides = {}, parsing = {}) {
  const name = kind === "product" ? "Product" : "Whitelist";
  const rows = [kind === "product" ? { ...product } : { ...customer }];
  const preview = { rows, warnings: [], sheetCounts: [] };
  const calls = { confirm: 0, upload: 0, cancel: 0, parse: 0, images: 0 };
  const notices = [];
  const options = {
    activityId: "1", activityStatus: "draft", productRows: rows, whitelistRows: rows, attendanceRows: [],
    productImportCompleted: false, productImportHasRun: false, whitelistImportHasRun: false,
    serverImportTasks: { PRODUCT: 7, WHITELIST: 8 }, serverImportBlocking: {},
    setActionNotice: notice => notices.push(notice), recordOperation: () => {},
    onProductImportCommitted: () => {}, onWhitelistImportCommitted: () => {},
  };
  for (const key of ["productRows", "whitelistRows", "productImportCompleted", "whitelistImportCompleted", "serverImportTasks", "serverImportBlocking"]) {
    options[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => {
      options[key] = typeof value === "function" ? value(options[key]) : value;
    };
  }
  const api = {
    ApiError: class ApiError extends Error {},
    confirmImport: async () => { calls.confirm++; return apiOverrides.confirmImport?.(); },
    uploadImport: async () => { calls.upload++; return apiOverrides.uploadImport?.() ?? { id: 11, errorCount: 0 }; },
    cancelImport: async () => { calls.cancel++; },
    waitForImport: apiOverrides.waitForImport ?? (async () => {}),
    loadImportRows: apiOverrides.loadImportRows ?? (async () => []),
    loadAdminProducts: apiOverrides.readback ?? (async () => []),
    loadAdminCustomers: apiOverrides.readback ?? (async () => []),
    loadProductImageReviews: async () => [],
  };
  const parseWorkbook = async () => { calls.parse++; return parsing.workbook?.() ?? preview; };
  const h = hookHarness(`app/features/admin/use${name}Import.ts`, `use${name}Import`, [options], {
    "../../api": api,
    "./admin-utils": {
      parseProductWorkbook: parseWorkbook, parseWhitelistWorkbook: parseWorkbook,
      runtimeProductToImportRow: row => row, mergeProductImageReviews: rows => rows,
    },
    "../../domain/product-images": {
      ...loadModule("app/domain/product-images.ts"),
      parseProductImageZip: async () => { calls.images++; return parsing.images?.() ?? []; },
    },
  }, { Error, URL, window: { confirm: () => true } });
  return { h, options, calls, notices, preview, name };
}

for (const kind of ["product", "whitelist"]) {
  test(`${kind}: rapid confirmation sends one request and stays locked through polling and readback`, async () => {
    const confirm = Promise.withResolvers(), wait = Promise.withResolvers(), readback = Promise.withResolvers();
    const { h, options, calls, name } = importHarness(kind, {
      confirmImport: () => confirm.promise, waitForImport: () => wait.promise, readback: () => readback.promise,
    });
    const initial = h.model;
    const first = initial[`confirm${name}Import`]();
    // The second click can arrive before React has rendered the disabled button.
    await initial[`confirm${name}Import`]();
    await initial[`cancel${name}Import`]();
    await initial[`handle${name}File`]({ name: "another.xlsx" });
    initial[`begin${name}Import`]();
    if (kind === "product") {
      await initial.handleProductImageFile({ name: "images.zip" });
      initial.removeProductImages();
    }
    assert.equal(calls.confirm, 1);
    assert.equal(calls.cancel + calls.parse + calls.images, 0);
    assert.equal(h.render()[`${kind}Publishing`], true);
    confirm.resolve();
    await h.flush();
    assert.equal(h.model[`${kind}ImportBusy`], true);
    wait.resolve();
    await h.flush();
    assert.equal(h.model[`${kind}ImportBusy`], true);
    await h.model[`confirm${name}Import`]();
    assert.equal(calls.confirm, 1);
    readback.resolve([]);
    await first;
    assert.equal(h.render()[`${kind}ImportBusy`], false);
    assert.equal(options[`${kind}ImportCompleted`], true);
  });

  test(`${kind}: confirmation and publication failures release the lock for retry`, async () => {
    for (const stage of ["confirm", "wait"]) {
      let attempt = 0;
      const failOnce = async () => { if (++attempt === 1) throw new Error("offline"); };
      const { h, options, calls, name } = importHarness(kind, stage === "confirm"
        ? { confirmImport: failOnce } : { waitForImport: failOnce });
      await h.model[`confirm${name}Import`]();
      assert.equal(h.render()[`${kind}ImportBusy`], false);
      assert.equal(Boolean(options[`${kind}ImportCompleted`]), false);
      await h.model[`confirm${name}Import`]();
      assert.equal(h.render()[`${kind}ImportBusy`], false);
      assert.equal(options[`${kind}ImportCompleted`], true);
      assert.equal(calls.confirm, 2);
    }
  });

  test(`${kind}: parsing, upload and preview reads prevent replacement and early confirmation`, async () => {
    const parse = Promise.withResolvers(), upload = Promise.withResolvers(), rows = Promise.withResolvers();
    const { h, calls, preview, name } = importHarness(kind, {
      uploadImport: () => upload.promise, loadImportRows: () => rows.promise,
    }, { workbook: () => parse.promise });
    const initial = h.model;
    const first = initial[`handle${name}File`]({ name: "selected.xlsx" });
    await initial[`handle${name}File`]({ name: "replacement.xlsx" });
    await initial[`confirm${name}Import`]();
    await initial[`cancel${name}Import`]();
    assert.equal(h.render()[`${kind}PreviewLoading`], true);
    assert.equal(calls.parse, 1);
    assert.equal(calls.confirm + calls.cancel + calls.upload, 0);
    parse.resolve(preview);
    await h.flush();
    assert.equal(calls.upload, 1);
    assert.equal(h.model[`${kind}ImportBusy`], true);
    upload.resolve({ id: 11, errorCount: 0 });
    await h.flush();
    assert.equal(h.model[`${kind}ImportBusy`], true);
    rows.resolve([]);
    await first;
    assert.equal(h.render()[`${kind}ImportBusy`], false);
    assert.equal(h.model[`${kind}FileName`], "selected.xlsx");
  });

  test(`${kind}: failed file parsing releases the lock and allows another selection`, async () => {
    let attempt = 0;
    const harness = importHarness(kind, {}, { workbook: () => {
      if (++attempt === 1) throw new Error("bad headers");
      return harness.preview;
    } });
    const { h, calls, name } = harness;
    await h.model[`handle${name}File`]({ name: "bad.xlsx" });
    assert.equal(h.render()[`${kind}ImportBusy`], false);
    assert.match(h.model[`${kind}ImportError`], /bad headers/);
    await h.model[`handle${name}File`]({ name: "good.xlsx" });
    assert.equal(h.render()[`${kind}ImportBusy`], false);
    assert.equal(h.model[`${kind}ImportError`], "");
    assert.equal(h.model[`${kind}FileName`], "good.xlsx");
    assert.equal(calls.upload, 1);
  });

  test(`${kind}: the page disables import and data changes while publishing, then recovers on failure`, async () => {
    const confirm = Promise.withResolvers();
    const { h, options, name } = importHarness(kind, { confirmImport: () => confirm.promise });
    h.model[`set${name}FileName`]("preview.xlsx");
    const first = h.render()[`confirm${name}Import`]();
    h.render();
    const component = kind === "product" ? "ProductImportPage" : "WhitelistPage";
    const Page = loadModule(`app/features/admin/${component}.tsx`, {
      "./ImportTemplateDownload": { ImportTemplateDownload: () => null, ImportTemplateHint: () => null },
      "../../api": { apiAssetUrl: value => value },
    })[component];
    const render = () => renderToStaticMarkup(createElement(Page, {
      activityStatus: "draft", [`${kind}Rows`]: options[`${kind}Rows`], [`${kind}ImportCompleted`]: false,
      serverImportBlocking: {}, [`${kind}Import`]: h.model,
      [`${kind}Editor`]: {},
    }));
    const busy = render();
    assert.match(busy, /aria-busy="true"/);
    assert.match(busy, /<button[^>]*disabled=""[^>]*>正在发布…<\/button>/);
    const inputs = busy.match(/<input[^>]*type="file"[^>]*>/g);
    assert.equal(inputs.length, kind === "product" ? 2 : 1);
    for (const input of inputs) assert.match(input, /disabled=""/);
    for (const label of ["编辑", "移除"]) assert.match(busy, new RegExp(`<button[^>]*disabled=""[^>]*>${label}</button>`));
    assert.match(busy, /<button[^>]*disabled=""[^>]*>＋ 手动添加/);
    assert.doesNotMatch(busy, /<button[^>]*>删除<\/button>/);
    confirm.reject(new Error("offline"));
    await first;
    h.render();
    const idle = render();
    assert.match(idle, /aria-busy="false"/);
    assert.doesNotMatch(idle.match(/<button[^>]*>确认替换当前[^<]*<\/button>/)[0], /disabled/);
    for (const input of idle.match(/<input[^>]*type="file"[^>]*>/g)) assert.doesNotMatch(input, /disabled/);
    assert.match(idle, /<button[^>]*>删除<\/button>/);
  });
}

test("product: ZIP parsing blocks conflicting actions and recovers after a bad ZIP", async () => {
  const images = Promise.withResolvers();
  let attempt = 0;
  const { h, calls } = importHarness("product", {}, { images: () => ++attempt === 1 ? images.promise : [] });
  const first = h.model.handleProductImageFile({ name: "bad.zip" });
  await h.model.handleProductImageFile({ name: "other.zip" });
  await h.model.handleProductFile({ name: "other.xlsx" });
  await h.model.confirmProductImport();
  h.model.removeProductImages();
  assert.equal(h.render().productImageLoading, true);
  assert.equal(calls.images, 1);
  assert.equal(calls.parse + calls.confirm, 0);
  images.reject(new Error("bad ZIP"));
  await first;
  assert.equal(h.render().productImportBusy, false);
  assert.match(h.model.productImageError, /bad ZIP/);
  await h.model.handleProductImageFile({ name: "good.zip" });
  assert.equal(h.render().productImportBusy, false);
  assert.equal(h.model.productImageError, "");
  assert.equal(h.model.productImageFileName, "good.zip");
});
