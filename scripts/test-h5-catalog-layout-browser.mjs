import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

// Render the real catalog and quantity controls with synthetic local state only.
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("../work/h5-catalog-layout/", import.meta.url);
const output = new URL("../outputs/h5-catalog-layout/", import.meta.url);
await mkdir(fixture, { recursive: true });
await mkdir(output, { recursive: true });
const browserTemp = fileURLToPath(new URL("browser-temp/", fixture));
await mkdir(browserTemp, { recursive: true });
process.env.TEMP = browserTemp;
process.env.TMP = browserTemp;
await writeFile(new URL("index.html", fixture), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/work/h5-catalog-layout/fixture.jsx"></script></body></html>');
await writeFile(new URL("fixture.jsx", fixture), `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { H5CatalogPage } from "/app/features/h5/H5CatalogPage.tsx";
import { priceBreakdown } from "/app/features/h5/h5-domain.ts";
import "/app/globals.css";
const base = { line: "调味油", spec: "225mL", price: 140, rebate: true, gift: false, atlas: 0, customerType: "特渠", branchScope: [], status: "有效", isOrderable: true };
const products = [
  { ...base, id: "whole", name: "金芝御礼225ML*4礼盒（礼盒随货发）", price: 160, priceTiers: [{ minQuantity: 1, casePrice: 160 }, { minQuantity: 50, casePrice: 150 }], tierPricingMode: "WHOLE_ORDER" },
  { ...base, id: "normal", name: "金芝御礼225ML*4礼盒（组装好发货）" },
  { ...base, id: "zero", name: "金龙鱼福运添香芝麻油225mL（特渠）", price: 144 },
  { ...base, id: "multi", name: "多档分段计价长名称商品（组合礼盒与超长规格说明）", description: "商品说明，验证两行名称及说明不会遮挡阶梯价和数量按钮。", price: 100, priceTiers: [{ minQuantity: 1, casePrice: 100 }, { minQuantity: 10, casePrice: 90 }, { minQuantity: 100, casePrice: 80 }, { minQuantity: 1000, casePrice: 70 }], tierPricingMode: "INCREMENTAL" },
  { ...base, id: "legacy", name: "旧版阶梯价商品", price: 200, tierMinQuantity: 10, tierCasePrice: 180, tierPricingMode: "WHOLE_ORDER" },
  { ...base, id: "incomplete", name: "价格待完善商品", price: 0, isOrderable: false },
];
const params = new URLSearchParams(location.search);
const noop = () => {};
function App() {
  const [quantities, setQuantities] = useState({ whole: 1, normal: 1, multi: 999999 });
  const [cartOpen, setCartOpen] = useState(false);
  const selected = products.filter(product => quantities[product.id] > 0).map(product => ({ product, quantity: quantities[product.id] }));
  const model = {
    activityClosed: false, visibleStep: "order", orderStatus: "none", customerOrderReadOnly: params.has("readOnly"),
    quantities, setQuantities, changeQty: (id, delta) => setQuantities(old => ({ ...old, [id]: Math.max(0, Math.min(999999, (old[id] || 0) + delta)) })),
    setStep: noop, setRebateFilter: noop, line: "全部", setLine: noop, search: "", setSearch: noop, setPreviewProduct: noop,
    cartOpen, setCartOpen, setCancelConfirmOpen: noop, lineOptions: ["全部", "调味油"], hasRebateSplit: false, effectiveRebateFilter: "ALL",
    visibleProducts: products, visibleProductGroups: [{ line: "调味油", items: products }], selected,
    selectedLineGroups: [{ line: "调味油", items: selected }],
    totalBoxes: selected.reduce((sum, item) => sum + item.quantity, 0),
    totalAmount: selected.reduce((sum, item) => sum + priceBreakdown(item.product, item.quantity).amount, 0),
    identityLabel: "特渠专业客户 · 北区", dealerName: "合成测试经销商", displayBranch: "测试分公司", displayPhone: "139****0001",
    catalogSearch: { scope: "layout", searchResultKey: "all", searching: false, searchPending: false, totalMatches: products.length },
  };
  return <div className={params.has("embedded") ? "" : "standalone-h5"}><div className="h5-stage"><div className="phone-shell"><div className="phone-screen"><H5CatalogPage model={model} /></div></div></div></div>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
`);

const server = await createServer({ root, configFile: false, plugins: [react()],
  define: { "process.env.NEXT_PUBLIC_API_BASE": JSON.stringify("/api/v1") },
  server: { host: "127.0.0.1", port: 4197, strictPort: true },
  cacheDir: fileURLToPath(new URL("vite-cache/", fixture)) });
let browser;
try {
  await server.listen();
  const { chromium } = await import(process.env.ORDER_SHOW_PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true, ...(process.env.ORDER_SHOW_BROWSER_PATH ? { executablePath: process.env.ORDER_SHOW_BROWSER_PATH } : {}) });
  const reports = [];
  for (const width of [320, 375, 390, 402, 430, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [], unexpectedRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://127.0.0.1:4197" || url.pathname.startsWith("/api/")) {
        unexpectedRequests.push(url.href);
        return route.abort();
      }
      return route.continue();
    });
    const url = "http://127.0.0.1:4197/work/h5-catalog-layout/index.html" + (width === 1440 ? "?embedded=1" : "");
    await page.goto(url);
    await page.locator(".product-card").last().waitFor({ state: "attached" });
    const cards = page.locator(".product-card");
    const checkLayout = async () => {
      const measurements = await cards.evaluateAll(elements => elements.map(card => {
        const bounds = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const tier = card.querySelector(".product-tier-label");
        return { name: card.querySelector("h3").textContent, card: bounds(card), stepper: bounds(card.querySelector(".stepper")),
          price: bounds(card.querySelector(".product-price-block")), priceText: bounds(card.querySelector(".product-price-block strong")),
          tier: tier ? bounds(tier) : null, overflow: card.scrollWidth > card.clientWidth + 1 };
      }));
      assert.equal(measurements.length, 6);
      for (const item of measurements) {
        const label = width + "px " + item.name;
        assert.ok(Math.abs(item.card.right - item.stepper.right - 10) <= 1, label + ": quantity control must stay at the right edge");
        assert.ok(Math.abs(item.card.bottom - item.stepper.bottom - 10) <= 1, label + ": quantity control must stay at the bottom edge");
        assert.ok(Math.abs(item.price.bottom - item.stepper.bottom) <= 1, label + ": price and quantity must share the bottom row");
        assert.ok(item.priceText.right <= item.stepper.left - 5, label + ": price must not overlap quantity");
        assert.ok(!item.overflow, label + ": card must not overflow horizontally");
        if (item.tier) {
          assert.ok(item.tier.bottom <= item.stepper.top - 5, label + ": tier text must stay above the controls");
          assert.ok(item.tier.left >= item.card.left && item.tier.right <= item.card.right, label + ": tier text must wrap inside the card");
        }
      }
      assert.ok(measurements.every(item => Math.abs(item.stepper.width - measurements[0].stepper.width) <= 1), "All quantity controls must have equal widths");
      return measurements;
    };
    const measurements = await checkLayout();
    await cards.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: fileURLToPath(new URL("catalog-" + width + ".png", output)) });

    const whole = cards.nth(0), zero = cards.nth(2), multi = cards.nth(3), legacy = cards.nth(4);
    const quantity = card => card.locator(".stepper input");
    const plus = card => card.locator(".stepper button").last();
    const minus = card => card.locator(".stepper button").first();
    await plus(whole).click();
    assert.equal(await quantity(whole).inputValue(), "2");
    await minus(whole).click();
    assert.equal(await quantity(whole).inputValue(), "1");
    await quantity(whole).fill("49");
    await quantity(whole).press("Enter");
    assert.equal(await whole.locator(".product-price-block").innerText(), "¥160.00/箱");
    await plus(whole).click();
    assert.equal(await whole.locator(".product-price-block").innerText(), "¥150.00/箱");
    await checkLayout();
    await minus(whole).click();
    assert.equal(await whole.locator(".product-price-block").innerText(), "¥160.00/箱");
    assert.equal(await minus(zero).isDisabled(), true);
    await plus(zero).click();
    assert.equal(await quantity(zero).inputValue(), "1");
    await minus(zero).click();
    assert.equal(await quantity(zero).inputValue(), "0");
    assert.equal(await minus(zero).isDisabled(), true);
    assert.equal(await quantity(multi).inputValue(), "999999");
    await quantity(multi).fill("10");
    await quantity(multi).press("Enter");
    assert.equal(await multi.locator(".product-tier-label").innerText(), "9箱×¥100.00；1箱×¥90.00");
    await quantity(multi).fill("0");
    await quantity(multi).press("Enter");
    assert.match(await multi.locator(".product-tier-label").innerText(), /^分段计价：/);
    await quantity(multi).fill("999999");
    await quantity(multi).press("Enter");
    await quantity(legacy).fill("10");
    await quantity(legacy).press("Enter");
    assert.equal(await legacy.locator(".product-price-block").innerText(), "¥180.00/箱");
    assert.equal(await legacy.locator(".product-tier-label").innerText(), "已享满10箱整批优惠");
    for (const control of await cards.last().locator(".stepper input, .stepper button").all()) assert.equal(await control.isDisabled(), true);
    await checkLayout();
    await page.getByRole("button", { name: "查看已选商品明细" }).click();
    await page.getByRole("region", { name: "已选商品明细" }).waitFor();
    assert.equal(await page.locator(".cart-sheet .stepper").count(), 4);
    await page.getByRole("button", { name: "关闭购物明细" }).click({ force: true });
    await page.goto(url + (url.includes("?") ? "&" : "?") + "readOnly=1");
    await page.locator(".product-card").last().waitFor({ state: "attached" });
    for (const control of await page.locator(".product-card .stepper input, .product-card .stepper button").all()) assert.equal(await control.isDisabled(), true);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedRequests, []);
    reports.push({ width, measurements });
    console.log("PASS " + width + "px: tier/plain alignment, wrapping, 6-digit quantity, quantity editing, both pricing modes, legacy tiers, disabled states and cart");
    await page.close();
  }
  await writeFile(new URL("measurements.json", output), JSON.stringify(reports, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
