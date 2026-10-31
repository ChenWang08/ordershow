import http from 'k6/http';
import exec from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

const fixtureName = __ENV.CAPACITY_FIXTURE;
if (!/^[\w-]+$/.test(fixtureName || '')) throw Error('Invalid fixture name');
const users = new SharedArray('capacity customers', () => JSON.parse(open(`/results/${fixtureName}-fixture.json`)).customers);
const mode = __ENV.CAPACITY_MODE;
const vus = Number(__ENV.VUS), run = __ENV.RUN;
if (!['consume', 'full', 'verify', 'sustain', 'journey', 'submit-only'].includes(mode) || !Number.isInteger(vus) || vus < 1 || vus > users.length || !/^[\w-]+$/.test(run || '')) throw Error('Invalid capacity arguments');
const steps = mode === 'verify' ? ['verify'] : mode === 'full' ? ['verify', 'products', 'draft', 'submit', 'confirm'] : mode === 'journey' ? ['verify', 'products', 'current', 'draft', 'submit', 'confirm'] : mode === 'submit-only' ? ['current', 'submit', 'confirm'] : mode === 'sustain' ? ['current', 'draft', 'submit', 'confirm'] : ['draft', 'submit', 'confirm'];
const durations = Object.fromEntries(steps.map(step => [step, new Trend(`${step}_ms`, true)]));
const attempts = new Counter('flow_attempts'), completed = new Counter('flow_completed'), commits = new Counter('order_commits');
const verified = new Counter('verified_sessions'), audited = new Counter('write_attempts');
const failures = new Rate('flow_failures'), payloadErrors = new Rate('payload_errors'), serverFailures = new Rate('server_failures');
const statuses = new Counter('response_status'), codes = new Counter('response_code');
const flowing = new Trend('flow_ms', true);
const types = ['GENERAL', 'SPECIAL'];
const thresholds = {
  flow_failures: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '15s' }],
  payload_errors: [{ threshold: 'rate==0', abortOnFail: true, delayAbortEval: '5s' }],
  server_failures: [{ threshold: 'rate==0', abortOnFail: false }],
};
for (const step of steps) {
  const limit = step === 'submit' || step === 'draft' ? 1000 : 500;
  thresholds[`${step}_ms`] = [`p(95)<${limit}`];
  for (const type of types) thresholds[`${step}_ms{customer_type:${type}}`] = [`p(95)<${limit}`];
}
for (const type of types) {
  thresholds[`flow_failures{customer_type:${type}}`] = ['rate<0.01'];
  thresholds[`flow_completed{customer_type:${type}}`] = ['count>=1'];
}
for (const status of [0, 200, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504]) thresholds[`response_status{status:${status}}`] = ['count>=0'];
for (const code of ['H5_WRITE_BUSY', 'SERVICE_NOT_READY', 'INTERNAL_ERROR', 'ORDER_VERSION_CONFLICT', 'ORDER_CHANGE_REVIEW_REQUIRED', 'REQUEST_FAILED']) thresholds[`response_code{code:${code}}`] = ['count>=0'];
if (['consume', 'full'].includes(mode)) {
  thresholds.flow_completed = [`count==${users.length}`];
  thresholds.order_commits = [`count==${users.length}`];
}
export const options = {
  scenarios: { capacity: ['consume', 'full'].includes(mode)
    ? { executor: 'shared-iterations', vus, iterations: users.length, maxDuration: __ENV.DURATION, gracefulStop: '30s' }
    : { executor: 'constant-vus', vus, duration: __ENV.DURATION, gracefulStop: '30s' } },
  maxRedirects: 0, discardResponseBodies: false,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'], thresholds,
};
const base = 'http://backend:8080/api/v1';
let loggedErrors = 0;
function request(step, method, path, user, body, key) {
  const tags = { name: step, customer_type: user.type };
  const headers = { Origin: 'http://localhost:3200', 'Content-Type': 'application/json', Cookie: user.cookie, 'X-CSRF-Token': user.csrf,
    'X-Request-Id': `${run}-${__VU}-${__ITER}-${step}` };
  if (key) headers['Idempotency-Key'] = key;
  if (step === 'submit') headers['X-H5-Customer-Id'] = String(user.id);
  if (step === 'draft' || step === 'submit') audited.add(1);
  const response = http.request(method, base + path, body ? JSON.stringify(body) : null, { headers, tags, timeout: '20s' });
  durations[step].add(response.timings.duration, tags);
  serverFailures.add(response.status === 0 || response.status >= 500, tags);
  statuses.add(1, { status: String(response.status) });
  let decoded;
  try { decoded = response.json(); } catch { /* Preserve HTTP failure below. */ }
  const ok = response.status === 200;
  if (!ok) {
    const code = decoded?.code || 'REQUEST_FAILED';
    codes.add(1, { code });
    if (loggedErrors++ < 2) console.warn(JSON.stringify({ step, customerType: user.type, status: response.status, code, trace: headers['X-Request-Id'], detail: decoded?.detail || decoded?.message || response.error }));
  }
  return { ok, data: decoded?.data, response };
}
function valid(value, user) { payloadErrors.add(!value, { customer_type: user.type }); return Boolean(value); }
function validOrder(data, user, quantity, version) {
  return valid(data?.activityCustomerId === user.id && data.currentVersion === version && data.status === 'SUBMITTED'
    && data.items?.length === user.products.length && data.totalQuantity === user.products.length * quantity
    && Number(data.totalAmount) === user.products.length * quantity * 100
    && data.items.every(item => user.products.includes(item.productId) && item.quantity === quantity && Number(item.lineAmount) === quantity * 100), user);
}
export default function capacityIteration() {
  const index = ['consume', 'full'].includes(mode) ? exec.scenario.iterationInTest : (mode === 'verify' ? (__VU - 1 + __ITER * vus) % users.length : __VU - 1);
  const source = users[index];
  const user = { ...source };
  const path = `/h5/activities/${user.code}`, start = Date.now();
  const tags = { customer_type: user.type };
  attempts.add(1, tags);
  // Keep the successful verification-only return outside try/finally. The bundled
  // k6/Sobek runtime panics on that early-return shape; this path has no cleanup.
  if (mode === 'verify') {
    const login = request('verify', 'POST', `/public/activities/${user.code}/verify-phone`, user, { phone: user.phone, customerType: user.type, regionCode: user.region });
    const successful = login.ok && valid(login.data?.customer?.customerId === user.id && login.data.customer.customerType === user.type && Boolean(login.data.csrfToken), user);
    if (successful) { verified.add(1, tags); completed.add(1, tags); }
    failures.add(!successful, tags);
    flowing.add(Date.now() - start, tags);
    return;
  }
  let success = false;
  try {
    success = runOrderFlow(user, path, tags);
  } finally {
    failures.add(!success, tags);
    flowing.add(Date.now() - start, tags);
    if (success) completed.add(1, tags);
  }
}

// Keep early returns in a helper without finally: failed HTTP steps must still
// produce metrics/summary, not trigger the bundled k6/Sobek return/finally panic.
function runOrderFlow(user, path, tags) {
    // Activity metadata uses a persistent SSE connection, covered by the separate SSE scenarios.
    if (mode === 'full' || mode === 'journey') {
      const login = request('verify', 'POST', `/public/activities/${user.code}/verify-phone`, user, { phone: user.phone, customerType: user.type, regionCode: user.region });
      if (!login.ok || !valid(login.data?.customer?.customerId === user.id && login.data.customer.customerType === user.type && Boolean(login.data.csrfToken), user)) return false;
      verified.add(1, tags);
      user.csrf = login.data.csrfToken;
      user.cookie = Object.entries(login.response.cookies).flatMap(([name, values]) => values.map(value => `${name}=${value.value}`)).join('; ');
      const products = request('products', 'GET', path + '/products', user);
      if (!products.ok || !valid(Array.isArray(products.data) && products.data.length === user.products.length && products.data.every(product => user.products.includes(product.id)), user)) return false;
    }
    let version = 0, quantity = 1;
    if (mode === 'sustain' || mode === 'journey' || mode === 'submit-only') {
      const current = request('current', 'GET', path + '/order?includeHistory=false', user);
      if (!current.ok) return false;
      version = current.data?.currentVersion || 0;
      quantity = (current.data?.items?.[0]?.quantity || 0) + 1;
    }
    const items = user.products.map(productId => ({ productId, quantity }));
    // Diagnostic isolation only, never reported as a passing full customer journey.
    if (mode !== 'submit-only') {
      const draft = request('draft', 'PUT', path + '/order-draft', user, { customerId: user.id, baseOrderVersion: version, items });
      if (!draft.ok || !valid(draft.data?.customerId === user.id && draft.data.items?.length === items.length, user)) return false;
    }
    const order = request('submit', 'PUT', path + '/order?includeHistory=false', user, { expectedVersion: version, items }, `${run}-${__VU}-${__ITER}`);
    if (!order.ok) return false;
    commits.add(1, tags);
    if (!validOrder(order.data, user, quantity, version + 1)) return false;
    const confirm = request('confirm', 'GET', path + '/order?includeHistory=false', user);
    if (!confirm.ok || !validOrder(confirm.data, user, quantity, version + 1) || !valid(confirm.data.id === order.data.id, user)) return false;
    return true;
}
export function handleSummary(data) { return { [`/results/${run}.json`]: JSON.stringify(data, null, 2) }; }
