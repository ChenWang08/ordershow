import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as settle } from 'node:timers/promises';
import { loadModule } from './helpers/load-ts-module.mjs';

function harness(items, detail = async (id) => items.find(a => a.id === id)) {
  const effects = [], slots = [], calls = [];
  let cursor = 0, mounted = false;
  const marker = () => null;
  const { AuthorizedWorkspace } = loadModule('app/features/admin/AdminEntry.tsx', {
    react: { useEffect: f => { if (!mounted) effects.push(f); }, useState: initial => {
      const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }];
    } },
    '../../api': { ApiError: Error, loadAdminActivities: async () => items,
      loadAdminActivity: async id => { calls.push(id); return detail(id); },
      getPreferredAdminActivityCode: () => 'OTHER-DEPARTMENT', setPreferredAdminActivityCode: () => {}, setActiveActivityCode: () => {} },
    '../../admin-context': { useAdminIdentity: () => ({ id: 2 }), useAdminSession: () => ({ logout() {} }) },
    '../workspace/ActivityWorkspace': { ActivityWorkspaceProvider: marker },
    './AdminGateway': { AdminGateway: marker }, './AdminWorkspace': { AdminWorkspace: marker },
    './DepartmentAdminPanel': { DepartmentAdminPanel: marker }, './NewActivityDrawer': { NewActivityDrawer: marker },
    './useAdminActivities': { useAdminActivities: () => ({}) },
    './ActivityDeletionProgress': { ActivityDeletionProgressProvider: marker, ActivityDeletionProgressButton: marker },
  }, { URLSearchParams, window: { location: { search: '' }, addEventListener() {}, removeEventListener() {} } });
  return { calls, render() { cursor = 0; return AuthorizedWorkspace(); }, mount() { this.render(); mounted = true; return effects.map(f => f()); } };
}
test('new department never mounts old activity or requests its detail', async () => {
  const h = harness([]); h.mount(); await settle();
  const view = h.render();
  assert.equal(view.type.name, 'EmptyAdminWorkspace');
  assert.deepEqual(h.calls, []);
});
test('stale saved activity is replaced by authorized historical activity', async () => {
  const h = harness([{ id: 7, code: 'OWN-HISTORY', status: 'FINISHED' }]); h.mount(); await settle();
  assert.deepEqual(h.calls, [7]);
  assert.equal(h.render().props.adminActivity.code, 'OWN-HISTORY');
});
test('failed authorization never mounts business data', async () => {
  const h = harness([{ id: 7 }], async () => { throw new Error('denied'); }); h.mount(); await settle();
  assert.equal(h.render().type.name, 'PendingAdminWorkspace');
  assert.equal(h.render().props.adminActivity, undefined);
});
test('late old-account response cannot restore activity after unmount', async () => {
  let resolve;
  const h = harness([{ id: 7 }], () => new Promise(r => { resolve = r; }));
  const cleanups = h.mount(); await settle(); cleanups.forEach(f => f());
  resolve({ id: 7, code: 'OLD' }); await settle();
  assert.equal(h.render().props.adminActivity, undefined);
});
test('activity preference is isolated by account and ignores legacy global preference', () => {
  const saved = new Map([['order-show.admin.activity-code', 'OLD']]);
  const context = loadModule('app/services/api/context.ts', {}, { process: { env: {} }, window: { localStorage: {
    getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value),
  } } });
  context.setAdminPreferenceOwner(1); assert.equal(context.getPreferredAdminActivityCode(), '');
  context.setPreferredAdminActivityCode('A'); context.setAdminPreferenceOwner(2);
  assert.equal(context.getPreferredAdminActivityCode(), ''); context.setPreferredAdminActivityCode('B');
  context.setAdminPreferenceOwner(1); assert.equal(context.getPreferredAdminActivityCode(), 'A');
});
