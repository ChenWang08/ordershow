import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

function state() {
  let cursor = 0;
  const slots = [];
  return { reset() { cursor = 0; }, react: { useEffect() {}, useRef(initial) {
    const id = cursor++;
    if (!(id in slots)) slots[id] = { current: initial };
    return slots[id];
  }, useState(initial) {
    const id = cursor++;
    if (!(id in slots)) slots[id] = typeof initial === "function" ? initial() : initial;
    return [slots[id], next => { slots[id] = typeof next === "function" ? next(slots[id]) : next; }];
  } } };
}
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

test("shared close guard compares restored values and blocks close while saving", () => {
  const adapter = state(); let prompts = 0, closes = 0, accepted = false;
  const { useDrawerClose } = loadModule("app/components/useDrawerClose.ts", { react: adapter.react }, { window: { confirm() { prompts++; return accepted; } } });
  const render = function useRenderClose(value, busy = false) { adapter.reset(); return useDrawerClose(value, () => closes++, busy); };
  render({ name: "原名称", scope: [1] });
  render({ name: "修改", scope: [1] })(); assert.equal(closes, 0);
  render({ scope: [1], name: "原名称" })(); assert.equal(closes, 1); assert.equal(prompts, 1);
  accepted = true; render({ name: "修改", scope: [1] }, true)(); assert.equal(closes, 1); assert.equal(prompts, 1);
  render({ name: "修改", scope: [1] })(); assert.equal(closes, 2);
});

for (const [folder, name, fieldLabel, newValue] of [
  ["products", "ProductFormDrawer", "物料名称 *", "测试商品"],
  ["whitelist", "WhitelistFormDrawer", "经销商名称（全）*", "测试客户"],
  ["attendance", "AttendanceFormDrawer", "参会人姓名", "测试姓名"],
]) {
  test(`${name} ignores backdrop clicks, guards explicit closes, and retains edits after failed saves`, async () => {
    const adapter = state(); let closes = 0, prompts = 0, accepted = false;
    const component = loadModule(`app/features/admin/${folder}/${name}.tsx`, {
      react: adapter.react, "../../shared/utils": { normalizePhone: value => value },
      "../products/ProductImageEditor": { ProductImageEditor: () => null },
      "./ProductScopeEditor": { ProductScopeEditor: () => null }, "./product-scope.css": {}, "./price-tiers.css": {},
    }, { window: { confirm() { prompts++; return accepted; } }, crypto: { randomUUID: () => "test" } })[name];
    const props = { rows: [], activityId: 1, scopeEnabled: false, onClose: () => closes++, onSave: async () => ({ ok: false, message: "手机号重复，请直接编辑原客户" }) };
    let tree;
    const render = () => { adapter.reset(); tree = component(props); };
    const find = predicate => nodes(tree).find(predicate);
    const input = () => nodes(find(node => node.type === "label" && text(node).startsWith(fieldLabel))).find(node => node.type === "input");
    render();
    assert.equal(tree.props.onClick, undefined);
    const original = input().props.value;
    input().props.onChange({ target: { value: newValue } }); render();
    find(node => node.type === "button" && text(node) === "取消").props.onClick();
    assert.equal(closes, 0); assert.equal(prompts, 1);
    assert.equal(input().props.value, newValue);
    input().props.onChange({ target: { value: original } }); render();
    find(node => node.type === "button" && text(node) === "×").props.onClick();
    assert.equal(closes, 1); assert.equal(prompts, 1);
    input().props.onChange({ target: { value: newValue } }); render(); accepted = true;
    find(node => node.type === "button" && text(node) === "×").props.onClick();
    assert.equal(closes, 2);
    let resolveSave;
    props.onSave = () => new Promise(resolve => { resolveSave = resolve; });
    render();
    const save = find(node => node.type === "button" && node.props.className === "admin-primary").props.onClick();
    render();
    assert.equal(find(node => node.type === "button" && text(node) === "×").props.disabled, true);
    find(node => node.type === "button" && text(node) === "×").props.onClick();
    assert.equal(closes, 2);
    resolveSave({ ok: false, message: "手机号重复，请直接编辑原客户" }); await save; render();
    assert.equal(input().props.value, newValue);
    assert.match(text(find(node => node.props?.role === "alert")), /手机号重复/);
    assert.equal(find(node => node.type === "button" && text(node) === "×").props.disabled, false);
    props.onSave = async () => ({ ok: true }); render();
    const before = prompts;
    await find(node => node.type === "button" && node.props.className === "admin-primary").props.onClick();
    assert.equal(closes, 3); assert.equal(prompts, before);
  });
}

test("new activity protects changes and resets discarded fields to the opening defaults", () => {
  const adapter = state(); let accepted = false, open = true;
  const { NewActivityDrawer } = loadModule("app/features/admin/NewActivityDrawer.tsx", {
    "./useActivityCopy": { copySelectionValid: () => false },
    react: adapter.react, "../../admin-context": { useAdminIdentity: () => ({ roleCode: "SUPER_ADMIN" }) },
  }, { window: { confirm: () => accepted } });
  const initial = { name: "", startsAt: "2026-12-01T09:00", endsAt: "2026-12-01T12:00", eventEndsAt: "2026-12-01T18:00", departmentId: "1" };
  const activities = { copy: { enabled: false, task: null }, creatingActivity: false, newActivity: initial, departments: [], minimumFutureAt: "", setNewActivityOpen: value => { open = value; }, setNewActivity: value => { activities.newActivity = value; } };
  const render = () => { adapter.reset(); return NewActivityDrawer({ activities }); };
  assert.equal(render().props.onClick, undefined);
  activities.newActivity = { ...initial, name: "新活动" };
  const close = () => nodes(render()).find(node => node.type === "button" && text(node) === "取消").props.onClick();
  close(); assert.equal(open, true); assert.equal(activities.newActivity.name, "新活动");
  activities.creatingActivity = true; accepted = true;
  close(); assert.equal(open, true);
  activities.creatingActivity = false; close();
  assert.equal(open, false); assert.deepEqual(activities.newActivity, initial);
});

test("review notes protect both closing and opening the original order; submitted reviews close directly", async () => {
  let accepted = false, opened = 0, prompts = 0;
  const { OrderChangeRequestPanel } = loadModule("app/components/orders/OrderChangeRequestPanel.tsx", {}, { window: { confirm() { prompts++; return accepted; } } });
  const r = { selected: { id: 1, orderId: 2, status: "PENDING", items: [] }, original: { versions: [], items: [] }, reason: "审核备注", busyId: null, total: 1, filters: {size:20} };
  r.setSelected = value => { r.selected = value; }; r.setReason = value => { r.reason = value; };
  const model = { changeRequests: r, openOrderById: async () => { opened++; return true; } };
  const button = label => nodes(OrderChangeRequestPanel({ model, detailOnly: true })).find(node => node.type === "button" && text(node) === label);
  button("关闭").props.onClick(); assert.equal(r.selected.id, 1);
  await button("查看完整原订单").props.onClick(); assert.equal(opened, 0);
  accepted = true; r.busyId = 1;
  await button("查看完整原订单").props.onClick(); assert.equal(opened, 0);
  r.busyId = null;
  await button("查看完整原订单").props.onClick(); assert.equal(opened, 1); assert.equal(r.selected, null); assert.equal(r.reason, "");
  r.selected = { id: 1, status: "APPROVED", items: [] }; r.reason = "已提交备注";
  const before = prompts; button("关闭").props.onClick(); assert.equal(prompts, before); assert.equal(r.selected, null);
});

test("quantity control supports six digits, temporary blanks, numeric limits and external sync", () => {
  const adapter = state(); let quantity = 120, editing = false;
  const { OrderQuantityControl } = loadModule("app/components/orders/OrderQuantityControl.tsx", { react: adapter.react });
  const props = { name: "商品", disabled: false, onChange: value => { quantity = value; }, onEditing: value => { editing = value; } };
  let tree;
  const render = () => { adapter.reset(); tree = OrderQuantityControl({ ...props, quantity }); };
  const input = () => nodes(tree).find(node => node.type === "input");
  render(); input().props.onFocus(); render();
  input().props.onChange({ target: { value: "" } }); render();
  assert.equal(input().props.value, ""); assert.equal(quantity, 0); assert.equal(editing, true);
  input().props.onChange({ target: { value: "999999" } }); render();
  assert.equal(quantity, 999999); assert.equal(input().props.value, "999999");
  assert.equal(nodes(tree).find(node => node.type === "button" && text(node) === "＋").props.disabled, true);
  for (const value of ["1000000", "-1", "2.5", "1e3", "x"]) input().props.onChange({ target: { value } });
  assert.equal(quantity, 999999);
  input().props.onBlur(); quantity = 35; render();
  assert.equal(input().props.value, 35); assert.equal(editing, false);
  props.disabled = true; render();
  assert.equal(input().props.disabled, true);
});

test("save guard prevents same-tick double submission and blocks retry until reload when outcome is uncertain", async () => {
  const adapter = state(); let submits = 0, closes = 0, finish;
  const { useDrawerSave } = loadModule("app/components/useDrawerSave.ts", { react: adapter.react });
  const render = function useRender() { adapter.reset(); return useDrawerSave(() => closes++); };
  const submit = () => { submits++; return new Promise(resolve => { finish = resolve; }); };
  const model = render();
  const first = model.save(submit);
  await model.save(submit);
  assert.equal(submits, 1); assert.equal(render().saving, true);
  finish({ ok: false, message: "商品已添加，图片上传失败，请刷新", requiresReload: true });
  await first;
  assert.equal(render().saving, false); assert.equal(render().requiresReload, true);
  assert.match(render().saveError, /商品已添加/);
  await model.save(submit); assert.equal(submits, 1); assert.equal(closes, 0);
});

test("unexpected save exceptions preserve the drawer and require checking the result", async () => {
  const adapter = state(); let closes = 0;
  const { useDrawerSave } = loadModule("app/components/useDrawerSave.ts", { react: adapter.react });
  const render = function useRender() { adapter.reset(); return useDrawerSave(() => closes++); };
  await render().save(async () => { throw new Error("private SQL details"); });
  assert.equal(closes, 0); assert.equal(render().requiresReload, true);
  assert.match(render().saveError, /保存结果尚未确认/); assert.doesNotMatch(render().saveError, /SQL/);
});
