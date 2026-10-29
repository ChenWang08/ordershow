// Explicit synthetic load project only. No business endpoint or arbitrary URL accepted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { base, project, resultsRoot, guard, save } from './lib.mjs';

assert.equal(project, 'order-show-load-summary');
assert.equal(base, 'http://127.0.0.1:8480/api/v1');
assert.equal(resultsRoot.replace(/^\.\//, ''), 'outputs/load-summary');
const [label, concurrencyText = '5', secondsText = '60'] = process.argv.slice(2);
assert(/^[a-z0-9-]+$/.test(label || ''));
const concurrency = Number(concurrencyText), seconds = Number(secondsText);
assert(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 20);
assert(Number.isInteger(seconds) && seconds >= 5 && seconds <= 300);
guard();
const fixture = JSON.parse(readFileSync(`${resultsRoot}/${label}-fixture.json`, 'utf8'));
assert(fixture.code.startsWith('LOAD-CAP-'));
const endpoints = ['ranking?metric=AMOUNT', 'ranking?metric=TONS', 'dashboard', 'reports/FINAL'];
const times = Object.fromEntries(endpoints.map(endpoint => [endpoint, []]));
const errors = [];
const started = Date.now(), deadline = started + seconds * 1000;
const progress = setInterval(() => console.log(JSON.stringify({ elapsedSeconds: Math.round((Date.now()-started)/1000), completed: Object.values(times).reduce((n, t) => n+t.length, 0), errors: errors.length })), 30000);
try {
  await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
    let step = index;
    while (Date.now() < deadline) {
      const endpoint = endpoints[step++ % endpoints.length], start = performance.now();
      try {
        const response = await fetch(`${base}/screen/activities/${fixture.code}/${endpoint}`, { signal: AbortSignal.timeout(30000) });
        const json = await response.json();
        assert.equal(response.status, 200);
        const dashboard = json.data.dashboard || json.data;
        assert.equal(dashboard.activityId, fixture.activityId);
        assert(Number(dashboard.totals.total_amount) >= 0);
      } catch (error) { errors.push({ endpoint, message: error.message }); }
      times[endpoint].push(performance.now()-start);
    }
  }));
} finally { clearInterval(progress); }
const metrics = Object.fromEntries(Object.entries(times).map(([endpoint, samples]) => {
  samples.sort((a,b) => a-b);
  return [endpoint, { count: samples.length, medianMs: samples[Math.floor(samples.length*.5)], p95Ms: samples[Math.max(0,Math.ceil(samples.length*.95)-1)], maxMs: samples.at(-1) }];
}));
const result = { label, concurrency, seconds, startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(), elapsedMs: Date.now()-started, metrics, errors };
save(`summary-read-${concurrency}-${started}.json`, result);
console.log(JSON.stringify(result));
assert.equal(errors.length, 0);
