import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Exercise the actual scenario with in-memory k6 adapters, including failed
// requests. The integration run additionally validates the real Sobek runtime.
const source = readFileSync(new URL('./load/capacity-scenario.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/export default /g, '').replace(/export /g, '');
function run(failedStep, mode = 'sustain') {
  const metrics = {}, calls = [], paths = [];
  class Metric {
    constructor(name) { this.name = name; metrics[name] = []; }
    add(value) { metrics[this.name].push(value); }
  }
  const user = { id: 1, type: 'GENERAL', code: 'LOAD-CAP-test', products: [11], cookie: '', csrf: '' };
  const quantity = mode === 'full' ? 1 : 2;
  const order = { id: 2, activityCustomerId: 1, currentVersion: quantity, status: 'SUBMITTED', totalQuantity: quantity,
    totalAmount: quantity * 100, items: [{ productId: 11, quantity, lineAmount: quantity * 100 }] };
  const context = vm.createContext({
    __ENV: { CAPACITY_FIXTURE: 'test', CAPACITY_MODE: mode, VUS: '1', RUN: 'test', DURATION: '1s' },
    __VU: 1, __ITER: 0, exec: { scenario: { iterationInTest: 0 } },
    SharedArray: class { constructor(_name, load) { return load(); } },
    open: () => JSON.stringify({ customers: [user] }),
    Counter: Metric, Rate: Metric, Trend: Metric, console: { warn() {} },
    http: { request(_method, _path, _body, options) {
      const step = options.tags.name; calls.push(step); paths.push(_path);
      if (step === failedStep) return { status: 500, timings: { duration: 1 }, json: () => ({ code: 'INTERNAL_ERROR' }) };
      const data = step === 'current' ? { currentVersion: 1, items: [{ quantity: 1 }] }
        : step === 'draft' ? { customerId: 1, items: [{}] }
        : step === 'verify' ? { customer: { customerId: 1, customerType: 'GENERAL' }, csrfToken: 'test' }
        : step === 'products' ? [{ id: 11 }] : order;
      return { status: 200, cookies: {}, timings: { duration: 1 }, json: () => ({ data }) };
    } },
  });
  vm.runInContext(source + '\ncapacityIteration();', context);
  return { metrics, calls, paths };
}
for (const step of ['current', 'draft', 'submit', 'confirm']) {
  test(`capacity failure at ${step} records failure and stops subsequent requests`, () => {
    const { metrics, calls } = run(step);
    assert.equal(calls.at(-1), step);
    assert.deepEqual(metrics.flow_failures, [true]);
    assert.equal(metrics.flow_ms.length, 1);
    assert.equal(metrics.flow_completed.length, 0);
    assert.equal(metrics.order_commits.length, step === 'confirm' ? 1 : 0);
  });
}
test('capacity success records one completion and one commit', () => {
  const { metrics } = run();
  assert.deepEqual(metrics.flow_failures, [false]);
  assert.deepEqual(metrics.flow_completed, [1]);
  assert.deepEqual(metrics.order_commits, [1]);
});
test('verification-only mode still records success without an order', () => {
  const { metrics, calls } = run(undefined, 'verify');
  assert.deepEqual(calls, ['verify']);
  assert.deepEqual(metrics.flow_failures, [false]);
  assert.deepEqual(metrics.verified_sessions, [1]);
  assert.equal(metrics.order_commits.length, 0);
});
test('submit-only diagnosis omits only draft and retains version validation and audits', () => {
  const { metrics, calls } = run(undefined, 'submit-only');
  assert.deepEqual(calls, ['current', 'submit', 'confirm']);
  assert.deepEqual(metrics.flow_completed, [1]);
  assert.deepEqual(metrics.order_commits, [1]);
  assert.deepEqual(metrics.write_attempts, [1]);
  assert.deepEqual(metrics.payload_errors, [false, false, false]);
});

for (const mode of ['full', 'journey']) {
  test(`${mode} retains verification/products/order validation without calling the retired activity GET`, () => {
    const { metrics, calls, paths } = run(undefined, mode);
    assert.deepEqual(calls, ['verify', 'products', ...(mode === 'journey' ? ['current'] : []), 'draft', 'submit', 'confirm']);
    assert.equal(paths.some(path => path.endsWith('/public/activities/LOAD-CAP-test')), false);
    assert.equal(Object.hasOwn(metrics, 'activity_ms'), false);
    assert.deepEqual(metrics.flow_failures, [false]);
    assert.deepEqual(metrics.flow_completed, [1]);
    assert.deepEqual(metrics.order_commits, [1]);
  });
}
