// Synthetic load project only. Reuses the actual frontend refresh queue; no browser rendering is measured.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { setTimeout as delay } from 'node:timers/promises';
import { guard, base, sql, save, resultsRoot } from './lib.mjs';

guard();
const [label, durationText = '90000', resultName = 'h5-screen-live'] = process.argv.slice(2);
assert(/^[\w-]+$/.test(label || '') && /^[\w-]+$/.test(resultName));
const duration = Number(durationText); assert(duration >= 1000 && duration <= 600000);
const fixture = JSON.parse(readFileSync(`${resultsRoot}/${label}-fixture.json`, 'utf8'));
assert(fixture.code.startsWith('LOAD-CAP-'));
const queueSource = ts.transpileModule(readFileSync('app/features/screens/refresh-queue.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { createRefreshQueue } = await import(`data:text/javascript;base64,${Buffer.from(queueSource).toString('base64')}`);
const path = `/screen/activities/${fixture.code}`;
const failures = [], events = [], samples = [], controllers = [], readers = [], queues = [], timers = [];
let stopping = false;
const totals = data => data.dashboard?.totals || data.totals;
for (const endpoint of ['/dashboard', '/ranking?metric=AMOUNT', '/ranking?metric=TONS', '/reports/ORDER_DASHBOARD']) {
  const queue = createRefreshQueue(async () => {
    const started = performance.now();
    try {
      const response = await fetch(base + path + endpoint, { signal: AbortSignal.timeout(20000) });
      assert.equal(response.status, 200, endpoint);
      const body = await response.json();
      assert(Number(totals(body.data).order_count) >= 1);
      samples.push({ endpoint, ms: performance.now()-started, totals: totals(body.data), version: body.data.version });
    } catch (error) { failures.push({ endpoint, error: String(error) }); }
  });
  queues.push(queue);
  const refresh = () => queue.refresh().catch(error => failures.push({endpoint,error:String(error)}));
  const controller = new AbortController(); controllers.push(controller);
  const response = await fetch(base + path + '/events', { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  readers.push((async () => {
    let buffer = ''; const decoder = new TextDecoder();
    try {
      while (!stopping) {
        const chunk = await reader.read(); if(chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0,end); buffer = buffer.slice(end+2);
          if(frame.includes('event:invalidate')) {
            const json = frame.split('\n').find(line => line.startsWith('data:'));
            const change = JSON.parse(json.slice(5).trim());
            events.push({endpoint,version:change.version,ageMs:Date.now()-Date.parse(change.oldestEventAt)});
            void refresh();
          } else if(frame.includes('event:connected')) void refresh();
        }
      }
    } catch(error) { if(!stopping) failures.push({endpoint,error:String(error)}); }
  })());
  timers.push(setInterval(() => void refresh(),15000));
  void refresh();
}
await delay(duration);
stopping = true; timers.forEach(clearInterval); controllers.forEach(controller => controller.abort());
await Promise.allSettled(readers);
// Finish the in-flight and trailing requests before taking final snapshots.
await Promise.all(queues.map(queue => queue.refresh())); queues.forEach(queue => queue.dispose());
const summary = { label, duration, events: events.length, failures, endpoints: {} };
for (const endpoint of ['/dashboard','/ranking?metric=AMOUNT','/ranking?metric=TONS','/reports/ORDER_DASHBOARD']) {
  const times = samples.filter(sample => sample.endpoint === endpoint).map(sample => sample.ms).sort((a,b)=>a-b);
  const ages = events.filter(event => event.endpoint === endpoint).map(event => event.ageMs).filter(Number.isFinite).sort((a,b)=>a-b);
  summary.endpoints[endpoint] = { requests: times.length, p95Ms: times[Math.ceil(times.length*.95)-1], notifications: ages.length, notificationAgeP95Ms: ages[Math.ceil(ages.length*.95)-1] };
}
summary.database = sql(`SELECT COUNT(*),SUM(total_quantity),SUM(total_amount),SUM(total_tons) FROM customer_order WHERE activity_id=${Number(fixture.activityId)} AND status='SUBMITTED';`).trim();
// Run the writer for a shorter duration than this observer so final totals are stable.
const expected = summary.database.split('\t').map(Number);
for (const endpoint of Object.keys(summary.endpoints)) {
  const last = samples.findLast(sample => sample.endpoint === endpoint);
  if (!last) { failures.push({endpoint,error:'No successful response'}); continue; }
  for (const [index,key] of ['order_count','total_quantity','total_amount','total_tons'].entries()) {
    if (Number(last.totals[key]) !== expected[index])
      failures.push({endpoint,error:`Final ${key} differs from database`,expected:expected[index],actual:last.totals[key]});
  }
}
save(`${resultName}.json`,{summary,samples,events});
console.log(JSON.stringify(summary));
assert.equal(failures.length,0); assert(events.length>0,'No real order notifications were observed');
