// Guarded synthetic API workload. No business endpoints or databases are accepted.
// LOAD_PROJECT=order-show-load-ranking LOAD_BACKEND_PORT=8580 LOAD_RESULTS_ROOT=outputs/load-ranking
// seed before|after ; run <label> 100|200 ; inspect <label>
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { project, base, resultsRoot, guard, sql, save, docker, compose, request } from './lib.mjs';

assert.equal(project, 'order-show-load-ranking');
assert.equal(base, 'http://127.0.0.1:8580/api/v1');
assert.equal(resultsRoot, 'outputs/load-ranking');
guard();
const [mode, label, rateText] = process.argv.slice(2);
const sha = s => createHash('sha256').update(s).digest('hex');
const phoneHash = s => createHmac('sha256', Buffer.from(sha('load-only-hmac'), 'hex')).update(s).digest('hex');
const fixtureFile = `${resultsRoot}/event-fixture.json`;
const activityId = 101, code = 'LOAD-RANKING', preseed = 2500, productCount = 200;
const wait = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));

if (mode === 'seed') {
  assert(['before', 'after'].includes(label));
  assert.equal(Number(sql("SELECT COUNT(*) FROM activity WHERE id=101 OR activity_code='LOAD-RANKING';").trim()), 0, 'Requires a fresh isolated fixture');
  assert.equal(Number(sql('SELECT COUNT(*) FROM customer_order;').trim()), 0, 'Requires no existing orders');
  const hasLive = Number(sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='order_ranking_stat';").trim());
  assert.equal(hasLive, label === 'before' ? 1 : 0);
  let fixture;
  if (existsSync(fixtureFile)) fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'));
  else {
    fixture = { activityId, code, preseed, productCount, customers: [] };
    for (let id = 1; id <= 3000; id++) {
      const token = randomBytes(24).toString('hex'), csrf = randomBytes(24).toString('hex');
      fixture.customers.push({ id, code, type: id % 3 ? 'SPECIAL' : 'GENERAL', region: id % 5 ? `R${id % 4}` : null,
        phone: String(13900000000 + id), csrf, token, cookie: `ORDER_SHOW_H5_SESSION=${token}; ORDER_SHOW_H5_CSRF=${csrf}` });
    }
    save('event-fixture.json', fixture);
  }
  const statements = ["SET @admin=(SELECT id FROM admin_user WHERE username='load_admin');", 'START TRANSACTION;',
    "INSERT INTO department(id,department_code,department_name) VALUES(101,'LOAD-RANKING','Load ranking');",
    `INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,event_ends_at,published_at,created_by,updated_by) VALUES(101,101,'${code}','Synthetic ranking event','ACTIVE',UTC_TIMESTAMP()-INTERVAL 1 DAY,UTC_TIMESTAMP()+INTERVAL 2 DAY,UTC_TIMESTAMP()+INTERVAL 3 DAY,UTC_TIMESTAMP(),@admin,@admin);`];
  for (let i = 0; i < 2; i++) {
    const type = i ? 'WHITELIST' : 'PRODUCT', id = i + 1;
    statements.push(`INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose) VALUES(${id},101,'MINIO','order-show-load','fixture-${id}','SQL-fixture','application/octet-stream',0,UNHEX(SHA2('fixture',256)),'OTHER');`,
      `INSERT INTO import_task(id,activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES(${id},101,'${type}','COMPLETED',${id},UNHEX(SHA2('fixture',256)),@admin);`,
      `INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,status,row_count,created_by,published_at) VALUES(${id},101,'${type}',1,${id},'PUBLISHED',${i ? 3000 : 200},@admin,UTC_TIMESTAMP());`,
      `INSERT INTO activity_data_binding(activity_id,data_type,current_version_id,updated_by) VALUES(101,'${type}',${id},@admin);`);
  }
  for (let i = 0; i < 4; i++) statements.push(`INSERT INTO activity_region(activity_id,region_code,region_name) VALUES(101,'R${i}','Region ${i}');`);
  for (let p = 1; p <= productCount; p++) statements.push(`INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_code,material_name,product_line,variety_name,case_price,ton_case_factor,source_import_task_id,data_version_id) VALUES(${p},101,'ALL','ALL','LOAD-${p}','P${p}','Load product ${p}','P${p % 4}','V${p % 20}',100,1000,1,1);`);
  for (const c of fixture.customers) statements.push(
    `INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES(${c.id},'${c.type}','Load customer ${c.id}','loadcustomer${c.id}');`,
    `INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,region_code,branch_name,normalized_branch_name,dealer_full_name,normalized_dealer_full_name,phone,phone_lookup_hash,phone_masked,source_import_task_id,data_version_id) VALUES(${c.id},101,${c.id},'${c.type}',${c.region ? `'${c.region}'` : 'NULL'},'Branch ${c.id % 30}','branch${c.id % 30}','Load customer ${c.id}','loadcustomer${c.id}','${c.phone}',UNHEX('${phoneHash(c.phone)}'),'139****${c.phone.slice(-4)}',2,2);`,
    `INSERT INTO h5_session(activity_id,activity_customer_id,token_hash,csrf_token_hash,expires_at,last_seen_at) VALUES(101,${c.id},UNHEX('${sha(c.token)}'),UNHEX('${sha(c.csrf)}'),UTC_TIMESTAMP()+INTERVAL 2 DAY,UTC_TIMESTAMP());`);
  statements.push(`INSERT INTO customer_order(id,activity_id,activity_customer_id,order_no,status,customer_type,region_code,branch_name_snapshot,dealer_full_name_snapshot,current_version_no,total_quantity,total_tons,total_amount,first_submitted_at,last_submitted_at,last_modified_at)
    SELECT id,101,id,CONCAT('LOAD-',id),'SUBMITTED',customer_type,region_code,branch_name,dealer_full_name,1,200,0.2,20000,'2026-10-30','2026-10-30','2026-10-30' FROM activity_customer WHERE id<=${preseed};`,
    `INSERT INTO order_item(order_id,activity_product_id,line_no,material_code,material_name,product_line,variety_name,rebate_status,is_gift_box,quantity,case_price,line_amount,ton_case_factor,line_tons)
    SELECT o.id,p.id,p.id,p.material_code,p.material_name,p.product_line,p.variety_name,'ALL',FALSE,1,100,100,1000,0.001 FROM customer_order o CROSS JOIN activity_product p;`,
    `INSERT INTO order_version(id,activity_id,order_id,version_no,customer_type,region_code,branch_name_snapshot,dealer_full_name_snapshot,total_quantity,total_tons,total_amount,submitted_source,submitted_at,request_idempotency_key)
    SELECT id,101,id,1,customer_type,region_code,branch_name_snapshot,dealer_full_name_snapshot,200,0.2,20000,'H5','2026-10-30',CONCAT('fixture-',id) FROM customer_order;`,
    `INSERT INTO order_version_item(order_version_id,line_no,activity_product_id,material_code,material_name,product_line,variety_name,customer_type,rebate_status,is_gift_box,quantity,case_price,line_amount,ton_case_factor,line_tons)
    SELECT i.order_id,i.line_no,i.activity_product_id,i.material_code,i.material_name,i.product_line,i.variety_name,'ALL','ALL',FALSE,1,100,100,1000,0.001 FROM order_item i;`,
    'INSERT INTO order_dashboard_stat(order_id,item_count,all_tons,eligible_tons,dirty) SELECT id,200,0.2,0.2,FALSE FROM customer_order;',
    'INSERT INTO order_dashboard_product_line_stat(order_id,product_line,is_gift_box,line_amount,quantity) SELECT order_id,product_line,FALSE,SUM(line_amount),SUM(quantity) FROM order_item GROUP BY order_id,product_line;');
  if (hasLive) statements.push('INSERT INTO order_ranking_stat(order_id,source_version) SELECT id,lock_version FROM customer_order;',
    'INSERT INTO order_ranking_product_stat(order_id,product_line,variety_name,amount,quantity,all_tons,eligible_tons) SELECT order_id,product_line,variety_name,SUM(line_amount),SUM(quantity),SUM(line_tons),SUM(line_tons) FROM order_item GROUP BY order_id,product_line,variety_name;');
  statements.push('COMMIT;', 'ANALYZE TABLE customer_order,order_item,order_dashboard_stat;');
  // Seeding is outside measurement; root migrations are complete and the app user writes the fixture.
  guard();
  docker([...compose, 'exec', '-T', '-e', 'MYSQL_PWD=load_only_password', 'mysql',
    'mysql', '-uorder_show_load', 'order_show_load'], { input: "SET time_zone='+00:00';\n" + statements.join('\n'), timeout: 300000 });
  console.log(JSON.stringify({ seeded: label, customers: 3000, orders: preseed, items: preseed * productCount }));
  process.exit(0);
}

assert(existsSync(fixtureFile));
const fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'));
assert(/^[a-z0-9-]+$/.test(label || ''));
const path = `/h5/activities/${code}`;
const ranking = `/screen/activities/${code}/ranking`;
const items = Array.from({ length: productCount }, (_, i) => ({ productId: i + 1, quantity: 1 }));
const observations = [], errors = [];
async function call(step, suffix, user, method = 'GET', body, key) {
  const start = performance.now();
  let result;
  try {
    result = await request(suffix, { method, body, key, session: user });
    observations.push({ step, ms: performance.now() - start, status: result.status, at_ms: performance.now() - epoch });
    if (result.status !== 200) throw Error(`${step}: HTTP ${result.status} ${result.code}`);
    return result.data;
  } catch (error) {
    errors.push({ step, customer: user?.id, message: error.message });
    if (!result) observations.push({ step, ms: performance.now() - start, status: 0, at_ms: performance.now() - epoch });
    throw error;
  }
}
function validOrder(d, id) {
  assert.equal(d.activityCustomerId, id); assert.equal(d.status, 'SUBMITTED');
  assert.equal(d.currentVersion, 1); assert.equal(d.totalQuantity, 200); assert.equal(Number(d.totalAmount), 20000);
  assert.equal(d.items.length, 200);
  assert(d.items.every(i => i.quantity === 1 && Number(i.lineAmount) === 100));
}
function validRanking(d, perOrder) {
  assert.equal(Number(d.totals.total_amount), Number(d.totals.order_count) * perOrder);
  assert.equal(Number(d.totals.total_quantity), Number(d.totals.order_count) * perOrder / 100);
  assert(Math.abs(Number(d.totals.total_tons) - Number(d.totals.order_count) * perOrder / 100000) < 0.000001);
}
function percentile(rows) {
  if (!rows.length) return { samples: 0 };
  const values = rows.map(r => r.ms).sort((a, b) => a - b);
  return { samples: rows.length, failed: rows.filter(r => r.status !== 200).length,
    p50_ms: values[Math.ceil(values.length * .5) - 1], p95_ms: values[Math.ceil(values.length * .95) - 1], max_ms: values.at(-1) };
}
let epoch = performance.now();
if (mode === 'inspect') {
  const summaryChecks = sql(`SELECT COUNT(*) FROM customer_order o LEFT JOIN order_dashboard_stat s ON s.order_id=o.id
    WHERE o.activity_id=101 AND (s.order_id IS NULL OR s.dirty OR s.item_count<>200 OR s.all_tons<>0.2 OR s.eligible_tons<>0.2);
    SELECT COUNT(*) FROM customer_order o LEFT JOIN (SELECT order_id,SUM(line_amount) amount,SUM(quantity) quantity FROM order_dashboard_product_line_stat GROUP BY order_id) s ON s.order_id=o.id
    WHERE o.activity_id=101 AND (s.order_id IS NULL OR s.amount<>o.total_amount OR s.quantity<>o.total_quantity);`).trim().split('\n').map(Number);
  assert.deepEqual(summaryChecks, [0, 0]);
  const liveTableCount = Number(sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('order_ranking_stat','order_ranking_product_stat');").trim());
  let liveModel = { tables: liveTableCount };
  if (liveTableCount) {
    const counts = sql(`SELECT (SELECT COUNT(*) FROM customer_order),(SELECT COUNT(*) FROM order_ranking_stat),
      (SELECT COUNT(*) FROM order_ranking_product_stat),
      (SELECT COUNT(*) FROM customer_order o LEFT JOIN order_ranking_stat s ON s.order_id=o.id WHERE s.order_id IS NULL OR s.source_version<>o.lock_version),
      (SELECT SUM(amount) FROM order_ranking_product_stat),(SELECT SUM(total_amount) FROM customer_order);`).trim().split('\t').map(Number);
    assert.equal(counts[1], counts[0]); assert.equal(counts[2], counts[0] * 20); assert.equal(counts[3], 0); assert.equal(counts[4], counts[5]);
    liveModel = { tables: liveTableCount, orders: counts[0], markers: counts[1], facts: counts[2], stale_or_missing: counts[3], amount: counts[4] };
  }
  for (const [step, query, perOrder] of [['all', '', 20000], ['project', '?productLine=P0', 5000],
    ['four', '?customerType=SPECIAL&regionCode=R1&productLine=P0&varieties=V0&varieties=V4', 2000],
    ['tons', '?customerType=SPECIAL&regionCode=R1&productLine=P0&varieties=V0&varieties=V4&metric=TONS', 2000]]) {
    for (let n = 0; n < 20; n++) validRanking(await call(step, ranking + query), perOrder);
  }
  save(`${label}-query.json`, { original_summary_gaps: summaryChecks[0], original_product_summary_mismatches: summaryChecks[1],
    live_model: liveModel,
    timings: Object.fromEntries(['all', 'project', 'four', 'tons'].map(s => [s, percentile(observations.filter(o => o.step === s))])) });
  process.exit(0);
}
assert.equal(mode, 'run');
const rate = Number(rateText); assert([100, 200].includes(rate));
assert.equal(Number(sql('SELECT COUNT(*) FROM customer_order;').trim()), preseed);
const backendId = docker([...compose, 'ps', '-q', 'backend']).trim();
const container = JSON.parse(docker(['inspect', backendId]))[0];
const mount = container.Mounts.find(m => m.Destination === '/app/app.jar'); assert(mount);
const config = { rate_per_minute: rate, duration_seconds: 120, browsing_sessions: 100, activity_streams: 100, burst_orders: 20,
  orders_before: preseed, items_per_order: 200, jar_sha256: sha(readFileSync(process.env.RANKING_BENCH_JAR)),
  backend_cpus: container.HostConfig.NanoCpus / 1e9, backend_memory: container.HostConfig.Memory,
  environment: container.Config.Env.filter(e => /^(DB_POOL_SIZE|DASHBOARD_SUMMARY_ENABLED|JAVA_TOOL_OPTIONS|H5_WRITE_CONCURRENCY|VIRTUAL_THREADS_ENABLED)=/.test(e)) };
// Prime catalog/read paths without changing effective orders. Exclude warmup from timings.
for (const c of fixture.customers.slice(0, 10)) {
  assert.equal((await request(path + '/products', { session: c })).status, 200);
  validOrder((await request(path + '/order?includeHistory=false', { session: c })).data, c.id);
}
assert.equal((await request(ranking + '/options')).status, 200);
validRanking((await request(ranking)).data, 20000);
const before = sql("SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_row_lock_waits','Innodb_row_lock_time','Innodb_deadlocks','Innodb_rows_inserted','Innodb_rows_updated');");
// App user may not read performance_schema on a locked-down server; this fixed local fixture uses root for diagnostics only.
const rankingSqlRoot = () => {
  // Some MySQL configurations omit prepared executions from digests; validate actual facts separately.
  guard();
  return docker([...compose, 'exec', '-T', '-e', 'MYSQL_PWD=load_only_root', 'mysql', 'mysql', '-uroot', '--batch', '--skip-column-names', '-e',
    "SELECT DIGEST_TEXT,COUNT_STAR,SUM_TIMER_WAIT FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME='order_show_load' AND DIGEST_TEXT LIKE '%order_ranking%' ORDER BY DIGEST_TEXT;"]);
};
const rankingSqlBefore = rankingSqlRoot();
const metrics = [];
let sampling = false;
async function sample() {
  if (sampling) return;
  sampling = true;
  try {
    metrics.push({ at_ms: performance.now() - epoch, values: await Promise.all(['hikaricp.connections.active', 'hikaricp.connections.pending', 'process.cpu.usage', 'order_show.h5.write.admission.waiting', 'order_show.h5.draft.deadlocks'].map(async name => {
      try { const r = await fetch(base + '/actuator/metrics/' + name, { signal: AbortSignal.timeout(3000) }); return { name, data: await r.json() }; }
      catch { return { name, unavailable: true }; }
    })) });
  } finally { sampling = false; }
}
epoch = performance.now();
const samplingTimer = setInterval(sample, 5000);
const progress = setInterval(() => console.log(JSON.stringify({ label, elapsed_seconds: Math.round((performance.now() - epoch) / 1000), requests: observations.length, failures: errors.length })), 30000);
const streams = new AbortController();
const streamTimer = setTimeout(() => streams.abort(), 120000);
let streamsOpened = 0, streamBytes = 0;
const streamTasks = Array.from({ length: 100 }, (_, i) => (async () => {
  await wait(epoch + i * 100 - performance.now());
  const start = performance.now();
  try {
    const response = await fetch(base + `/public/activities/${code}/events`, { signal: streams.signal, headers: { Origin: 'http://localhost:3200' } });
    observations.push({ step: 'activity_stream_connect', ms: performance.now() - start, status: response.status, at_ms: performance.now() - epoch });
    assert.equal(response.status, 200); streamsOpened++;
    for await (const chunk of response.body) streamBytes += chunk.length;
    if (!streams.signal.aborted) throw Error('Activity stream closed prematurely');
  } catch (error) {
    if (!streams.signal.aborted) { errors.push({ step: 'activity_stream', message: error.message }); throw error; }
  }
})());
const submitted = new Set();
async function submit(c, burst = false) {
  const step = burst ? 'burst_submit' : 'submit';
  const draft = await call('submission_draft', path + '/order-draft', c, 'PUT', { customerId: c.id, baseOrderVersion: 0, items });
  assert.equal(draft.items.length, 200);
  validOrder(await call(step, path + '/order?includeHistory=false', c, 'PUT', { expectedVersion: 0, items }, `${label}-${c.id}`), c.id);
  submitted.add(c.id);
  validOrder(await call('confirmation', path + '/order?includeHistory=false', c), c.id);
}
const tasks = [];
for (let i = 0; i < 100; i++) tasks.push((async () => {
  const c = fixture.customers[i];
  for (let cycle = 0; cycle < 8; cycle++) {
    await wait(epoch + i * 100 + cycle * 15000 - performance.now());
    const catalog = await call('browse_products', path + '/products', c); assert.equal(catalog.length, 200);
    validOrder(await call('browse_order', path + '/order?includeHistory=false', c), c.id);
    if (cycle % 2 === 0) await call('browse_draft', path + '/order-draft', c, 'PUT', { customerId: c.id, baseOrderVersion: 1, items });
  }
})());
for (let i = 0; i < rate * 2; i++) tasks.push((async () => {
  await wait(epoch + i * 60000 / rate - performance.now());
  await submit(fixture.customers[preseed + i]);
})());
tasks.push((async () => {
  await wait(epoch + 90000 - performance.now());
  const burst = await Promise.allSettled(fixture.customers.slice(preseed + rate * 2, preseed + rate * 2 + 20).map(c => submit(c, true)));
  const rejected = burst.filter(r => r.status === 'rejected');
  if (rejected.length) throw new AggregateError(rejected.map(r => r.reason), 'Burst failures');
})());
// A leader requests a view occasionally. Requests are spaced, not continuously saturated.
for (let n = 0; n < 8; n++) tasks.push((async () => {
  await wait(epoch + 7000 + n * 15000 - performance.now());
  const queries = [['ranking_all', '', 20000], ['ranking_project', '?productLine=P0', 5000],
    ['ranking_four', '?customerType=SPECIAL&regionCode=R1&productLine=P0&varieties=V0&varieties=V4', 2000],
    ['ranking_tons', '?customerType=SPECIAL&regionCode=R1&productLine=P0&varieties=V0&varieties=V4&metric=TONS', 2000]];
  const [step, q, amount] = queries[n % queries.length];
  // RankingBoard refreshes actual choices together with a confirm/manual refresh.
  const [result, options] = await Promise.all([call(step, ranking + q), call('ranking_options', ranking + '/options')]);
  validRanking(result, amount); assert(options.products.length > 0);
})());
let settled;
try { settled = await Promise.allSettled([...tasks, ...streamTasks]); await wait(epoch + 120000 - performance.now()); }
finally { clearInterval(samplingTimer); clearInterval(progress); clearTimeout(streamTimer); streams.abort(); }
await sample();
const failures = settled.filter(r => r.status === 'rejected').map(r => r.reason.message);
const expectedOrders = preseed + rate * 2 + 20;
const final = sql(`SELECT COUNT(*),SUM(total_amount),SUM(total_quantity),SUM(total_tons) FROM customer_order WHERE activity_id=101 AND status='SUBMITTED';
  SELECT COUNT(*) FROM (SELECT o.id FROM customer_order o JOIN order_item i ON i.order_id=o.id GROUP BY o.id,o.total_amount,o.total_quantity,o.total_tons HAVING SUM(i.line_amount)<>o.total_amount OR SUM(i.quantity)<>o.total_quantity OR SUM(i.line_tons)<>o.total_tons) mismatch;
  SELECT COUNT(*) FROM order_dashboard_stat s JOIN customer_order o ON o.id=s.order_id WHERE s.dirty OR s.item_count<>200 OR s.all_tons<>0.2;
  SELECT COUNT(*) FROM order_version;
  SELECT COUNT(*) FROM order_item;
  SELECT COUNT(*) FROM order_version_item;
  SELECT COUNT(*) FROM customer_order o LEFT JOIN order_version v ON v.order_id=o.id AND v.version_no=o.current_version_no
  WHERE v.id IS NULL OR v.total_amount<>o.total_amount OR v.total_quantity<>o.total_quantity OR v.total_tons<>o.total_tons;`).trim().split('\n');
const values = final[0].split('\t').map(Number);
// Current version lines are deliberately copied only when superseded by the next version.
// Our seeded legacy snapshots remain; new first submissions project their current items on history reads.
let historySamples = 0;
for (const c of [fixture.customers[0], fixture.customers[preseed], fixture.customers[preseed + rate * 2]]) {
  const d = (await request(path + '/order?includeHistory=true', { session: c })).data;
  validOrder(d, c.id); assert.equal(d.versions.length, 1);
  const v = d.versions[0]; assert.equal(v.version, 1); assert.equal(v.items.length, 200);
  assert.equal(Number(v.totalAmount), 20000); assert.equal(v.totalQuantity, 200);
  assert(v.items.every(i => i.quantity === 1 && Number(i.lineAmount) === 100)); historySamples++;
}
const reconciliation = { expected_orders: expectedOrders, actual: values, mismatched_orders: Number(final[1]), mismatched_original_summaries: Number(final[2]), versions: Number(final[3]), items: Number(final[4]), version_items: Number(final[5]), mismatched_version_headers: Number(final[6]), history_samples: historySamples };
const consistent = values[0] === expectedOrders && values[1] === expectedOrders * 20000 && values[2] === expectedOrders * 200
  && Math.abs(values[3] - expectedOrders * .2) < .000001 && Number(final[1]) === 0 && Number(final[2]) === 0
  && Number(final[3]) === expectedOrders && Number(final[4]) === expectedOrders * 200 && Number(final[5]) === preseed * 200 && Number(final[6]) === 0;
const timings = Object.fromEntries([...new Set(observations.map(o => o.step))].map(s => [s, percentile(observations.filter(o => o.step === s))]));
const report = { label, config, timings, submitted: submitted.size, failures, errors, streamsOpened, streamBytes, reconciliation, consistent, metrics,
  ranking_sql_before: rankingSqlBefore, ranking_sql_after: rankingSqlRoot(),
  database_before: before, database_after: sql("SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_row_lock_waits','Innodb_row_lock_time','Innodb_deadlocks','Innodb_rows_inserted','Innodb_rows_updated');") };
save(`${label}.json`, report);
save(`${label}-requests.json`, observations);
writeFileSync(`${resultsRoot}/${label}-backend.log`, docker([...compose, 'logs', '--no-color', 'backend']));
console.log(JSON.stringify({ label, timings, consistent, errors: errors.length, failed_tasks: failures.length }));
assert.equal(errors.length, 0); assert.equal(failures.length, 0); assert.equal(streamsOpened, 100); assert(streamBytes > 0); assert(consistent);
