import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

const candidates = [
  { customerId: 1, dealerFullName: "同名经销商", dealerShortName: "甲", branchName: "上海分", customerType: "GENERAL" },
  { customerId: 2, dealerFullName: "乙经销商", dealerShortName: "乙", branchName: "上海分", customerType: "GENERAL" },
  { customerId: 3, dealerFullName: "同名经销商", dealerShortName: "甲", branchName: "安徽分", customerType: "GENERAL" },
  { customerId: 4, dealerFullName: "特渠经销商", branchName: "上海分", customerType: "SPECIAL" },
];
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props?.children);
}
function harness(overrides = {}) {
  let form = { id: "11", customerType: "综合", branchScope: "上海分，安徽分", dealerScope: [], ...overrides };
  const states = [candidates, true, "", "", "", "上海分", null];
  let index = 0;
  const { ProductScopeEditor } = loadModule("app/features/admin/products/ProductScopeEditor.tsx", {
    react: { useEffect() {}, useMemo: fn => fn(), useState(initial) {
      const i = index++; if (states[i] === undefined) states[i] = typeof initial === "function" ? initial() : initial;
      return [states[i], v => { states[i] = typeof v === "function" ? v(states[i]) : v; }];
    } },
    "../../../api": {},
  }, { window: { confirm: () => true } });
  return {
    get form() { return form; },
    render() { index = 0; return ProductScopeEditor({ activityId: 10, enabled: true, form,
      onChange(branchScope, dealerScope) { form = { ...form, branchScope, dealerScope }; } }); },
  };
}

test("Excel branches are checked and dealer scope defaults to unrestricted", () => {
  const h = harness(); const tree = h.render();
  for (const branch of ["上海分", "安徽分"]) {
    const label = nodes(tree).find(n => n.type === "label" && text(n).includes(branch));
    assert.equal(nodes(label).find(n => n.type === "input").props.checked, true);
  }
  assert.match(text(tree), /上海分2 家/);
  assert.doesNotMatch(text(tree), /大区/);
  const dealerChecks = nodes(tree).filter(n => n.type === "input" && n.props.type === "checkbox");
  assert.ok(dealerChecks.filter(input => input.props.checked).length >= 2);
});

test("cancel all enters explicit dealer selection for the current branch", () => {
  const h = harness();
  const button = nodes(h.render()).find(n => n.type === "button" && text(n) === "取消全选");
  button.props.onClick();
  assert.deepEqual(Array.from(h.form.dealerScope[0].members, m => m.customerId), []);
});

test("restoring all removes the explicit restriction for an untyped product", () => {
  const h = harness({ customerType: "", dealerScope: [{ branchName: "上海分", members: [{ ...candidates[0], active: true }] }] });
  nodes(h.render()).find(n => n.type === "button" && text(n) === "恢复全选").props.onClick();
  assert.equal(h.form.dealerScope.length, 0);
});

test("restoring all dealers removes the specific restriction", () => {
  const h = harness({ dealerScope: [{ branchName: "上海分", members: [{ ...candidates[0], active: true }] }] });
  nodes(h.render()).find(n => n.type === "button" && text(n) === "恢复全选").props.onClick();
  assert.equal(h.form.dealerScope.length, 0);
});

test("removing a branch removes only that branch's dealer selection", () => {
  const h = harness({ dealerScope: [{ branchName: "上海分", members: [{ ...candidates[0], active: true }] }, { branchName: "安徽分", members: [{ ...candidates[2], active: true }] }] });
  const label = nodes(h.render()).find(n => n.type === "label" && text(n).includes("上海分"));
  nodes(label).find(n => n.type === "input").props.onChange({ target: { checked: false } });
  assert.equal(h.form.branchScope, "安徽分");
  assert.deepEqual(Array.from(h.form.dealerScope, s => s.branchName), ["安徽分"]);
});
