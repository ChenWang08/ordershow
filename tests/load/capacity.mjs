// Isolated, synthetic GENERAL/SPECIAL capacity tests. Never connects to a business DB.
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { compose, docker, guard, sql, save, base, project, resultsRoot, request } from './lib.mjs';

assert(['order-show-load-20261029', 'order-show-load-summary'].includes(project), 'This suite only manages its isolated capacity projects');
assert.equal(resultsRoot.replaceAll('\\', '/').replace(/^\.\//, ''),
  project === 'order-show-load-summary' ? 'outputs/load-summary' : 'outputs/load-20261029');
const [mode, label, argument = '10', duration = '3m'] = process.argv.slice(2);
assert(/^[a-z0-9-]+$/.test(label || ''), 'Provide a fixture/run label');
mkdirSync(resultsRoot, { recursive: true });
guard();
const sha = value => createHash('sha256').update(value).digest('hex');
const phoneHash = value => createHmac('sha256', Buffer.from(sha('load-only-hmac'), 'hex')).update(value).digest('hex');
const file = `${resultsRoot}/${label}-fixture.json`;
const values = query => sql(query).trim().split('\t').map(Number);
const ids = () => values(`SELECT ${['activity', 'department', 'stored_file', 'import_task', 'import_publish_version', 'activity_product', 'customer', 'activity_customer'].map(table => `(SELECT COALESCE(MAX(id),0)+1 FROM ${table})`).join(',')};`);

if (mode === 'seed') {
  assert(!existsSync(file), 'Refusing to overwrite an existing cohort');
  const population = Number(argument);
  assert(Number.isInteger(population) && population >= 10 && population <= 10000);
  const [activityId, departmentId, storedStart, taskStart, versionStart, productStart, customerStart, activityCustomerStart] = ids();
  const code = `LOAD-CAP-${label}`;
  assert(code.length <= 64);
  const statements = ['START TRANSACTION;', "SET @admin=(SELECT id FROM admin_user WHERE username='load_admin');"];
  statements.push(`INSERT INTO department(id,department_code,department_name) VALUES (${departmentId},'${code}','${code} synthetic department');`,
    `INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,event_ends_at,published_at,created_by,updated_by) VALUES (${activityId},${departmentId},'${code}','${code}','ACTIVE',UTC_TIMESTAMP()-INTERVAL 1 HOUR,UTC_TIMESTAMP()+INTERVAL 2 DAY,UTC_TIMESTAMP()+INTERVAL 3 DAY,UTC_TIMESTAMP(),@admin,@admin);`);
  for (const [index, type] of ['PRODUCT', 'WHITELIST'].entries()) {
    const storedId = storedStart + index, taskId = taskStart + index, versionId = versionStart + index;
    statements.push(`INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose) VALUES (${storedId},${activityId},'MINIO','order-show-load','${code}-fixture-${index}','SQL-fixture','application/octet-stream',0,UNHEX(SHA2('fixture',256)),'OTHER');`,
      `INSERT INTO import_task(id,activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES (${taskId},${activityId},'${type}','COMPLETED',${storedId},UNHEX(SHA2('fixture',256)),@admin);`,
      `INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,status,row_count,created_by,published_at) VALUES (${versionId},${activityId},'${type}',1,${taskId},'PUBLISHED',${index ? population + 20 : 221},@admin,UTC_TIMESTAMP());`,
      `INSERT INTO activity_data_binding(activity_id,data_type,current_version_id,updated_by) VALUES (${activityId},'${type}',${versionId},@admin);`);
  }
  const regions = ['EAST', 'SOUTH', 'NORTH_1', 'NORTH_2'];
  regions.forEach((region, index) => statements.push(`INSERT INTO activity_region(activity_id,region_code,region_name,sort_no) VALUES (${activityId},'${region}','LOAD ${region}',${index});`));
  const products = { GENERAL: [], SPECIAL: [] };
  const productRows = [], imageFiles = [], images = [];
  for (let index = 0; index < 221; index++) {
    const type = index < 180 ? 'GENERAL' : 'SPECIAL', id = productStart + index, imageId = storedStart + 2 + index;
    products[type].push(id);
    productRows.push(`(${id},${activityId},'${type}','PARTICIPATING','${code}-${id}','P${id}','LOAD product ${id}','Seasoning','Soy','500ml','12',100,10,${taskStart},${versionStart})`);
    imageFiles.push(`(${imageId},${activityId},'MINIO','order-show-load','${code}/products/${id}.png','${id}.png','image/png',0,UNHEX(SHA2('synthetic-image-metadata',256)),'PRODUCT_IMAGE')`);
    images.push(`(${id},${imageId},TRUE,0,'MANUAL')`);
  }
  statements.push(`INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_code,material_name,category_name,product_line,specification,case_pack,case_price,ton_case_factor,source_import_task_id,data_version_id) VALUES ${productRows.join(',')};`,
    `INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose) VALUES ${imageFiles.join(',')};`,
    `INSERT INTO product_image(activity_product_id,stored_file_id,is_primary,sort_no,source_type) VALUES ${images.join(',')};`);
  const fixture = { createdAt: new Date().toISOString(), activityId, code, products, customers: [], warmup: [], population, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() };
  const customerRows = [], activityRows = [], sessions = [];
  for (let index = 0; index < population + 20; index++) {
    // Prefix-balanced scheduling preserves ~1072:548 even in a short interrupted run.
    const type = Math.floor((index + 1) * 1072 / 1620) > Math.floor(index * 1072 / 1620) ? 'GENERAL' : 'SPECIAL';
    const customerId = customerStart + index, id = activityCustomerStart + index;
    const phone = String(19000000000 + id), region = type === 'GENERAL' ? regions[index % 4] : null;
    assert(/^1\d{10}$/.test(phone));
    const token = randomBytes(24).toString('hex'), csrf = randomBytes(24).toString('hex');
    customerRows.push(`(${customerId},'${type}','LOAD customer ${customerId}','loadcustomer${customerId}')`);
    activityRows.push(`(${id},${activityId},${customerId},'${type}',${region ? `'${region}'` : 'NULL'},'LOAD branch ${index % 10}','loadbranch${index % 10}','LOAD customer ${customerId}','loadcustomer${customerId}','${phone}',UNHEX('${phoneHash(phone)}'),'190****${phone.slice(-4)}',${taskStart + 1},${versionStart + 1})`);
    sessions.push(`(${activityId},${id},UNHEX('${sha(token)}'),UNHEX('${sha(csrf)}'),UTC_TIMESTAMP()+INTERVAL 2 DAY,UTC_TIMESTAMP())`);
    const user = { id, customerId, activityId, code, type, region, phone, products: products[type], csrf, cookie: `ORDER_SHOW_H5_SESSION=${token}; ORDER_SHOW_H5_CSRF=${csrf}` };
    fixture[index < population ? 'customers' : 'warmup'].push(user);
  }
  const chunk = (rows, prefix) => { for (let start = 0; start < rows.length; start += 300) statements.push(prefix + rows.slice(start, start + 300).join(',') + ';'); };
  chunk(customerRows, 'INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES ');
  chunk(activityRows, 'INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,region_code,branch_name,normalized_branch_name,dealer_full_name,normalized_dealer_full_name,phone,phone_lookup_hash,phone_masked,source_import_task_id,data_version_id) VALUES ');
  chunk(sessions, 'INSERT INTO h5_session(activity_id,activity_customer_id,token_hash,csrf_token_hash,expires_at,last_seen_at) VALUES ');
  statements.push('COMMIT;');
  sql(statements.join('\n'));
  save(`${label}-fixture.json`, fixture);
  console.log(JSON.stringify({ seeded: label, activityId, population, general: fixture.customers.filter(user => user.type === 'GENERAL').length, special: fixture.customers.filter(user => user.type === 'SPECIAL').length, products: { GENERAL: 180, SPECIAL: 41 } }));
  process.exit(0);
}

assert(existsSync(file), 'Seed a fresh cohort first');
const fixture = JSON.parse(readFileSync(file, 'utf8'));
if (mode === 'smoke') {
  const checks = [];
  for (const user of fixture.warmup) {
    const login = await request(`/public/activities/${user.code}/verify-phone`, { method: 'POST', body: { customerType: user.type, regionCode: user.region, phone: user.phone } });
    assert.equal(login.status, 200); assert.equal(login.data.customer.customerId, user.id);
    const path = `/h5/activities/${user.code}`;
    const catalog = await request(path + '/products', { session: login.session });
    assert.equal(catalog.status, 200); assert.equal(catalog.data.length, user.products.length);
    assert(catalog.data.every(product => user.products.includes(product.id)));
    const items = user.products.map(productId => ({ productId, quantity: 1 }));
    const draft = await request(path + '/order-draft', { method: 'PUT', session: login.session, body: { customerId: user.id, baseOrderVersion: 0, items } });
    assert.equal(draft.status, 200);
    const key = `smoke-${label}-${user.id}`;
    const order = await request(path + '/order?includeHistory=false', { method: 'PUT', session: login.session, key, body: { expectedVersion: 0, items } });
    assert.equal(order.status, 200); assert.equal(order.data.currentVersion, 1); assert.equal(Number(order.data.totalAmount), items.length * 100);
    assert.equal(order.data.items.length, items.length); assert(order.data.items.every(item => user.products.includes(item.productId)));
    const replay = await request(path + '/order?includeHistory=false', { method: 'PUT', session: login.session, key, body: { expectedVersion: 0, items } });
    assert.equal(replay.status, 200); assert.equal(replay.data.id, order.data.id); assert.equal(replay.data.currentVersion, 1);
    checks.push({ type: user.type, items: items.length, verified: true, catalog: true, draft: true, order: true, replay: true });
  }
  save(`${label}-smoke.json`, { checks }); console.log(JSON.stringify({ smoke: label, checked: checks.length })); process.exit(0);
}

assert(['consume', 'full', 'verify', 'sustain', 'journey', 'submit-only'].includes(mode));
const vus = Number(argument);
assert(Number.isInteger(vus) && vus >= 2 && vus <= fixture.customers.length);
assert(/^\d+[smh]$/.test(duration));
const ready = await fetch(base + '/actuator/health/readiness', { signal: AbortSignal.timeout(5000) });
assert(ready.ok && (await ready.json()).status === 'UP');
if (['consume', 'full'].includes(mode)) assert.equal(values(`SELECT COUNT(*) FROM customer_order WHERE activity_id=${fixture.activityId} AND activity_customer_id<=${fixture.customers.at(-1).id};`)[0], 0, 'First-order measurement needs untouched customers');
const run = `capacity-${mode}-${vus}-${Date.now()}`;
const counts = () => values(`SELECT (SELECT COUNT(*) FROM customer_order WHERE activity_id=${fixture.activityId}),(SELECT COUNT(*) FROM order_version WHERE activity_id=${fixture.activityId}),(SELECT COUNT(*) FROM h5_session WHERE activity_id=${fixture.activityId});`);
const before = counts();
const backendId = docker([...compose, 'ps', '-q', 'backend']).trim();
const backend = JSON.parse(docker(['inspect', backendId]))[0];
const config = { mode, label, vus, duration, population: fixture.population, general: fixture.customers.filter(user => user.type === 'GENERAL').length, special: fixture.customers.filter(user => user.type === 'SPECIAL').length,
  image: backend.Image, memory: backend.HostConfig.Memory, nanoCpus: backend.HostConfig.NanoCpus,
  settings: backend.Config.Env.filter(value => /^(DB_POOL_SIZE|JAVA_TOOL_OPTIONS|HTTP_MAX_THREADS|SERVER_TOMCAT_THREADS_MAX|H5_WRITE_CONCURRENCY|VIRTUAL_THREADS_ENABLED|DASHBOARD_SUMMARY_ENABLED|DASHBOARD_SUMMARY_ACTIVITIES)=/.test(value)),
  mountedJarSha256: backend.Mounts.some(mount => mount.Destination === '/app/app.jar')
    ? createHash('sha256').update(readFileSync('backend/target/order-show-backend-0.1.0.jar')).digest('hex') : null };
function databaseSnapshot() {
  return docker([...compose, 'exec', '-T', '-e', 'MYSQL_PWD=load_only_root', 'mysql', 'mysql', '-uroot', '--batch', '-e',
    "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_running','Slow_queries','Innodb_row_lock_waits','Innodb_row_lock_time','Innodb_deadlocks'); SELECT COUNT(*) lock_waits FROM performance_schema.data_lock_waits; SELECT LEFT(DIGEST_TEXT,400) sql_text, COUNT_STAR calls,SUM_TIMER_WAIT total_ps FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME='order_show_load' ORDER BY SUM_TIMER_WAIT DESC LIMIT 20; SHOW ENGINE INNODB STATUS;"]);
}
const databaseBefore = databaseSnapshot();
const samples = [], resources = [], started = Date.now();
let sampling = false;
const sample = async () => {
  if (sampling) return;
  sampling = true;
  try {
    const values = await Promise.all(['jvm.memory.used', 'jvm.gc.pause', 'hikaricp.connections.active', 'hikaricp.connections.pending', 'hikaricp.connections.acquire', 'hikaricp.connections.usage', 'order_show.h5.write.admission.active', 'order_show.h5.write.admission.waiting', 'process.cpu.usage', 'order_show.h5.draft.deadlocks', 'order_show.h5.draft.retries', 'order_show.h5.draft.retry_exhausted', 'order_show.h5.draft.retry_recovered'].map(async name => {
      try { const response = await fetch(`${base}/actuator/metrics/${name}`, { signal: AbortSignal.timeout(2500) }); const data = await response.json(); return { name, measurements: data.measurements }; } catch { return { name, unavailable: true }; }
    }));
    const point = { time: new Date().toISOString(), values }; samples.push(point);
    appendFileSync(`${resultsRoot}/${run}-samples.jsonl`, JSON.stringify(point) + '\n');
  } finally { sampling = false; }
};
await sample();
const timer = setInterval(sample, 5000);
const stats = spawn('docker', ['stats', '--format', '{{json .}}'], { windowsHide: true });
stats.stdout.on('data', data => resources.push({ time: new Date().toISOString(), text: String(data).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '') }));
stats.stderr.on('data', () => {});
const progress = setInterval(() => console.log(JSON.stringify({ run, elapsedSeconds: Math.round((Date.now() - started) / 1000) })), 30000);
console.log(JSON.stringify({ run, config }));
const child = spawn('docker', [...compose, 'run', '--rm', '-T', '-e', `RUN=${run}`, '-e', `VUS=${vus}`, '-e', `DURATION=${duration}`, '-e', `CAPACITY_MODE=${mode}`, '-e', `CAPACITY_FIXTURE=${label}`, 'k6', 'run', '--quiet', '/scripts/capacity-scenario.js'], { windowsHide: true });
const log = `${resultsRoot}/${run}.log`;
child.stdout.on('data', data => appendFileSync(log, data));
child.stderr.on('data', data => appendFileSync(log, data));
let code;
try { code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); }); }
finally { clearInterval(timer); clearInterval(progress); stats.kill(); }
while (sampling) await new Promise(resolve => setTimeout(resolve, 100));
await sample();
const after = counts();
// Preserve server-side evidence even when the runner exits without a summary.
writeFileSync(`${resultsRoot}/${run}-backend.log`, docker([...compose, 'logs', '--no-color', '--since', new Date(started).toISOString(), 'backend']));
if (!existsSync(`${resultsRoot}/${run}.json`)) {
  save(`${run}-result.json`, { run, config, exitCode: code, passed: false, notMeasured: true, log, before, after });
  save(`${run}-monitor.json`, { config, samples, resources, databaseBefore, databaseAfter: databaseSnapshot() });
  throw Error(`Load runner did not produce a measurement; inspect ${log}`);
}
const summary = JSON.parse(readFileSync(`${resultsRoot}/${run}.json`, 'utf8'));
const metrics = summary.metrics;
const count = name => metrics[name]?.values.count || 0;
const expectedAudits = count('write_attempts');
let auditRows, uniqueAudits;
for (let attempt = 0; attempt < 30; attempt++) {
  [auditRows, uniqueAudits] = values(`SELECT COUNT(*),COUNT(DISTINCT trace_id) FROM audit_log WHERE trace_id LIKE '${run}-%';`);
  if (auditRows >= expectedAudits) break;
  await new Promise(resolve => setTimeout(resolve, 200));
}
const integrityErrors = values(`SELECT COUNT(*) FROM customer_order o LEFT JOIN (SELECT i.order_id,SUM(i.quantity) qty,SUM(i.line_amount) amount,COUNT(*) item_count FROM order_item i JOIN customer_order x ON x.id=i.order_id WHERE x.activity_id=${fixture.activityId} GROUP BY i.order_id) t ON t.order_id=o.id WHERE o.activity_id=${fixture.activityId} AND (NOT(t.qty <=> o.total_quantity) OR NOT(t.amount <=> o.total_amount) OR NOT(t.item_count <=> IF(o.customer_type='GENERAL',180,41)));`)[0];
const reconciliation = { before, after, acknowledgedCommits: count('order_commits'), versionIncrease: after[1] - before[1], verifiedSessions: count('verified_sessions'), sessionIncrease: after[2] - before[2], expectedAudits, auditRows, uniqueAudits, integrityErrors };
const reconciled = reconciliation.acknowledgedCommits === reconciliation.versionIncrease && reconciliation.verifiedSessions === reconciliation.sessionIncrease && auditRows === expectedAudits && uniqueAudits === auditRows && integrityErrors === 0;
const thresholdFailures = Object.entries(metrics).flatMap(([name, metric]) => Object.entries(metric.thresholds || {}).filter(([, value]) => !value.ok).map(([threshold]) => `${name}: ${threshold}`));
const requestedMs = Number(duration.slice(0, -1)) * ({ s: 1000, m: 60000, h: 3600000 }[duration.at(-1)]);
const durationPassed = ['consume', 'full'].includes(mode) || summary.state.testRunDurationMs >= requestedMs - 1000;
const draftRetryMetrics = Object.fromEntries(['deadlocks', 'retries', 'retry_exhausted', 'retry_recovered'].map(key => {
  const value = point => point?.values.find(metric => metric.name === `order_show.h5.draft.${key}`)?.measurements?.find(m => m.statistic === 'COUNT')?.value;
  const first = value(samples[0]), last = value(samples.at(-1));
  return [key, first === undefined || last === undefined ? null : last - first];
}));
const result = { run, config, startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started, measurementDurationMs: summary.state.testRunDurationMs, durationPassed, exitCode: code, passed: code === 0 && reconciled && thresholdFailures.length === 0 && durationPassed, thresholdFailures, reconciliation, draftRetryMetrics,
  metrics: Object.fromEntries(Object.entries(metrics).filter(([name]) => /(_ms|flow_|order_commits|verified_sessions|server_failures|payload_errors|response_status|response_code|http_reqs|http_req_failed)/.test(name)).map(([name, metric]) => [name, metric.values])) };
save(`${run}-monitor.json`, { config, samples, resources, databaseBefore, databaseAfter: databaseSnapshot() });
save(`${run}-result.json`, result);
save('latest-result.json', result);
console.log(JSON.stringify({ run, passed: result.passed, durationSeconds: summary.state.testRunDurationMs / 1000, flows: count('flow_completed'), commits: count('order_commits'), flowFailureRate: metrics.flow_failures?.values.rate, submitP95: metrics.submit_ms?.values['p(95)'], verifyP95: metrics.verify_ms?.values['p(95)'], thresholdFailures, reconciliation, draftRetryMetrics }));
process.exitCode = result.passed ? 0 : 1;
