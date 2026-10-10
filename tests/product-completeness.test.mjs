import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";
const { productCompletenessStatus, positiveProductNumber } = loadModule("app/domain/product-completeness.ts");
test("only positive price and conversion make a product complete", () => {
  assert.equal(productCompletenessStatus("100", "20"), "有效");
  assert.equal(productCompletenessStatus("1,000.25", "1e2"), "有效");
  for (const invalid of ["", " ", "0", "-1", "abc", "NaN", "Infinity", "0x10", null]) {
    assert.equal(productCompletenessStatus(invalid, "20"), "待完善");
    assert.equal(productCompletenessStatus("100", invalid), "待完善");
    assert.equal(positiveProductNumber(invalid), null);
  }
});
test("Excel preview ignores optional fields and keeps blocking errors ahead of completeness", async () => {
  const headers = ["客户类型", "是否返利", "产品大类", "项目组", "物料代码", "物料名称", "品牌", "品种", "规格", "箱规", "元/瓶", "元/箱", "吨箱转换系数", "是否为标品礼盒", "分公司定制品", "产品说明"];
  const matrix = [headers];
  const row = (name, price, factor) => ["综合", "是", "", "", "", name, "", "", "", "", "", price, factor, "否", "", ""];
  matrix.push(row("有效但选填全空", "100", "10"));
  for (const value of ["", "0", "-1", "abc"]) {
    matrix.push(row("价格" + value, value, "10"));
    matrix.push(row("系数" + value, "100", value));
  }
  matrix.push(row("重复", "", ""), row("重复", "", ""));
  const { parseProductWorkbook } = loadModule("app/features/admin/admin-utils.ts", {
    "read-excel-file": { __esModule: true, default: async () => matrix, readSheetNames: async () => ["商品"] },
    "../../api": {},
  }, { crypto: { randomUUID: () => Math.random().toString() } });
  const result = await parseProductWorkbook({});
  assert.equal(result.rows[0].status, "有效");
  assert.ok(result.rows.slice(1,9).every(row => row.status === "待完善"));
  assert.ok(result.rows.slice(9).every(row => row.status === "待核对"));
});
