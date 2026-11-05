import assert from 'node:assert/strict';
import test from 'node:test';
import { hookHarness } from './helpers/hook-harness.mjs';

function find(node, predicate) {
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
}
function text(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return [node?.props?.children].flat(Infinity).map(text).join('');
}
function setup(cooldown = 0) {
  let now = 1000, refreshes = 0;
  class ClockDate extends Date { static now() { return now; } }
  const model = { visibleStep: 'submitted', orderStatus: 'submitted', runtimeOrder: null, pendingChangeRequest: null,
    catalog: [], orderEvents: [], orderRefreshCooldownUntil: cooldown, refreshOrderStatus: async () => { refreshes++; } };
  const h = hookHarness('app/features/h5/H5SubmittedPage.tsx', 'H5SubmittedPage', [{model}], {
    './ProductArt': {ProductArt: () => null}, '../../api': {apiAssetUrl: x => x},
  }, {Date: ClockDate});
  const button = () => find(h.model, node => node.type === 'button' && node.props['aria-label'] === '刷新订单状态');
  return {h, model, button, refreshes: () => refreshes, advance: async ms => {now += ms; await h.runTimers();}};
}

test('compact refresh is in the status row and idle rendering does not trigger a query or recurring timer', async () => {
  const s = setup();
  const top = find(s.h.model, node => node.props?.className === 'submitted-state-top');
  assert.equal(find(top, node => node.type === 'button'), s.button());
  assert.match(text(s.button()), /刷新状态/);
  assert.equal(s.h.timers.size, 0); assert.equal(s.h.intervals.size, 0); assert.equal(s.refreshes(), 0);
  await s.button().props.onClick(); assert.equal(s.refreshes(), 1);
  await s.advance(60_000); assert.equal(s.refreshes(), 1); s.h.unmount();
});

test('countdown follows the existing shared deadline, ends at 15 seconds, and only updates text', async () => {
  const s = setup(16_000);
  assert.equal(s.button().props.disabled, true); assert.match(text(s.button()), /15s 后刷新/);
  await s.advance(14_999); assert.match(text(s.button()), /1s 后刷新/);
  await s.advance(1); assert.match(text(s.button()), /刷新状态/); assert.equal(s.button().props.disabled, false);
  assert.equal(s.h.timers.size, 0); assert.equal(s.refreshes(), 0); s.h.unmount();
});

test('writes, pending recovery and active reads disable refresh; hidden pages cancel countdown work', () => {
  const s = setup();
  for (const flag of ['runtimeBusy', 'orderSyncBusy', 'pendingSubmission', 'orderNeedsRefresh']) {
    s.model[flag] = true; s.h.render(); assert.equal(s.button().props.disabled, true);
    s.model[flag] = false;
  }
  s.model.orderSyncBusy = true; s.h.render(); assert.match(text(s.button()), /刷新中/);
  s.model.orderSyncBusy = false; s.model.orderRefreshCooldownUntil = 16_000; s.h.render();
  assert.equal(s.h.timers.size, 1);
  s.model.visibleStep = 'verify'; s.h.render(); assert.equal(s.h.model, null); assert.equal(s.h.timers.size, 0); s.h.unmount();
});
