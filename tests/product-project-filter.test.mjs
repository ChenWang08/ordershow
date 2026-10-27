import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

const product = (id, line, extra = {}) => ({
  id: String(id), sequence: Number(id), line, materialName: `商品${id}`, materialCode: `SKU${id}`,
  customerType: "综合", rebate: "参与", category: "", brand: "", variety: "", spec: "", casePack: "",
  description: "", unitPrice: "", casePrice: "100", conversion: "10", gift: "否", branchScope: "",
  status: "有效", imageStatus: "未匹配", ...extra,
});
function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!element || typeof element !== "object") return [];
  return [element, ...nodes(element.props?.children)];
}
function text(element) {
  if (Array.isArray(element)) return element.map(text).join("");
  if (element == null || typeof element === "boolean") return "";
  return typeof element === "object" ? text(element.props?.children) : String(element);
}
function harness(rows, overrides = {}) {
  let cursor = 0, dirty = false, tree;
  const slots = [], deleted = [];
  const { ProductImportTable } = loadModule("app/features/admin/products/ProductImportTable.tsx", {
    "../../api": {},
    react: {
      useMemo: calculate => calculate(),
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = initial;
        return [slots[index], value => {
          const next = typeof value === "function" ? value(slots[index]) : value;
          dirty ||= !Object.is(next, slots[index]); slots[index] = next;
        }];
      },
    },
    "../../shared/components/ProductImageViewer": { ProductImageViewer: () => null },
    "../shared/DeleteConfirmDialog": { DeleteConfirmDialog: () => null },
  });
  const props = { rows, onEdit() {}, onDelete: ids => deleted.push(ids), allowDelete: true, ...overrides };
  const render = function renderTable() {
    for (let pass = 0; pass < 10; pass++) {
      cursor = 0; dirty = false; tree = ProductImportTable(props);
      if (!dirty) return tree;
    }
    throw new Error("Unstable table render");
  };
  const find = predicate => nodes(tree).find(predicate);
  const filter = label => {
    const element = find(node => node.type === "label" && nodes(node).some(child => child.type === "span" && text(child) === label));
    return nodes(element).find(node => node.type === "select" || node.type === "input");
  };
  const button = label => find(node => node.type === "button" && text(node) === label);
  render();
  return { props, deleted, render, filter, button,
    all: () => nodes(tree),
    text: () => text(tree),
    names: () => nodes(tree).filter(node => node.props?.className?.startsWith("table-row ") && !node.props.className.includes("table-head"))
      .map(node => node.props.children[1][6].props.children),
    options: () => nodes(filter("项目组")).filter(node => node.type === "option").map(node => ({ label: text(node), value: node.props.value })),
    change(label, value) { filter(label).props.onChange({ target: { value } }); render(); },
    selectGroup(label) {
      const option = nodes(filter("项目组")).find(node => node.type === "option" && text(node) === label);
      filter("项目组").props.onChange({ target: { value: option.props.value } }); render();
    },
    click(label) { button(label).props.onClick(); render(); },
    checkPage() { find(node => node.props?.["aria-label"] === "全选当前页商品").props.onChange(); render(); },
  };
}

test("project group options use the complete catalog, trim, deduplicate and distinguish blank/all names", () => {
  const h = harness([product(1, " 调味油 "), product(2, "调味油"), product(3, "  "), product(4, "酱油"), product(5, "全部"), product(6, "未填写项目组")]);
  assert.equal(h.options().filter(option => option.label === "调味油").length, 1);
  assert.equal(new Set(h.options().map(option => option.value)).size, h.options().length);
  h.selectGroup("调味油"); assert.deepEqual(h.names(), ["商品1", "商品2"]);
  h.change("客户类型", "特渠"); assert.equal(h.names().length, 0);
  assert.ok(h.options().some(option => option.label === "酱油"));
  // The real group called 全部 must not share the all-groups sentinel.
  const actualAll = h.options().find(option => option.label === "全部（项目组名称）");
  h.change("客户类型", "全部"); h.change("项目组", actualAll.value);
  assert.deepEqual(h.names(), ["商品5"]);
  h.selectGroup("未填写项目组（项目组名称）"); assert.deepEqual(h.names(), ["商品6"]);
});

test("project groups combine with customer, rebate, status, price, images and search while full image totals stay unchanged", () => {
  const h = harness([
    product(1, "调味油", { imageStatus: "已匹配" }),
    product(2, "调味油", { customerType: "特渠", rebate: "不参与", casePrice: "", status: "待完善", imageStatus: "待确认" }),
    product(3, "酱油", { customerType: "特渠", rebate: "不参与", casePrice: "", status: "待完善", imageStatus: "待确认" }),
  ]);
  h.selectGroup("调味油"); h.change("客户类型", "特渠"); h.change("是否参与返利", "不参与");
  h.change("商品状态", "待完善"); h.change("价格状态", "价格待完善"); h.change("商品图片", "待确认"); h.change("搜索商品", "SKU2");
  assert.deepEqual(h.names(), ["商品2"]);
  assert.match(h.text(), /已匹配 1 · 待确认 2 · 未匹配 0/); assert.match(h.text(), /当前显示 1 条商品/);
  h.change("搜索商品", "不存在"); assert.match(h.text(), /当前搜索和筛选条件下没有商品/);
  assert.equal(h.filter("项目组").props.value, "group:调味油");
});

test("changing group resets pagination and selection, and select-all/delete only targets the filtered group", () => {
  const h = harness(Array.from({ length: 70 }, (_, index) => product(index + 1, index < 65 ? "调味油" : "酱油")));
  h.selectGroup("调味油"); h.click("下一页"); h.checkPage(); assert.match(h.text(), /已选择 15 条商品/);
  h.selectGroup("酱油"); assert.match(h.text(), /第 1\/1 页/); assert.doesNotMatch(h.text(), /已选择/);
  h.selectGroup("调味油"); assert.match(h.text(), /第 1\/2 页/);
  h.checkPage(); h.click("选择全部 65 条"); h.click("删除所选");
  h.all().find(node => typeof node.props?.onConfirm === "function").props.onConfirm();
  assert.deepEqual(Array.from(h.deleted[0]), Array.from({ length: 65 }, (_, index) => String(index + 1)));
});

test("removing the selected group resets to all, first page and no selection without losing other filters", () => {
  const h = harness(Array.from({ length: 65 }, (_, index) => product(index + 1, "调味油")));
  h.selectGroup("调味油"); h.click("下一页"); h.checkPage(); h.change("搜索商品", "商品");
  h.checkPage(); h.props.rows = [product(80, "新项目组")]; h.render();
  assert.equal(h.filter("项目组").props.value, ""); assert.equal(h.filter("搜索商品").props.value, "商品");
  assert.deepEqual(h.names(), ["商品80"]); assert.match(h.text(), /第 1\/1 页/); assert.doesNotMatch(h.text(), /已选择/);
});

test("blank groups include whitespace-only values and the option disappears when none remain", () => {
  const h = harness([product(1, ""), product(2, "  "), product(3, "调味油")]);
  h.selectGroup("未填写项目组"); assert.deepEqual(h.names(), ["商品1", "商品2"]);
  h.props.rows = [product(3, "调味油")]; h.render();
  assert.deepEqual(h.options().map(option => option.label), ["全部", "调味油"]);
  h.props.rows = []; h.render(); assert.match(h.text(), /当前筛选条件下没有商品/);
  assert.deepEqual(h.options().map(option => option.label), ["全部"]);
});

test("readonly catalogs still filter and a new activity/session starts with all groups", () => {
  const rows = [product(1, "调味油"), product(2, "酱油")];
  const h = harness(rows, { readOnly: true, allowDelete: false });
  h.selectGroup("调味油"); assert.deepEqual(h.names(), ["商品1"]);
  assert.equal(h.filter("项目组").props.disabled, undefined);
  assert.equal(h.button("编辑").props.disabled, true);
  assert.equal(harness(rows).filter("项目组").props.value, "");
});
