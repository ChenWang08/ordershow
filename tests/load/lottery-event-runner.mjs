// Recreates ONLY the guarded order-show-load-lottery test database between paired runs.
// Invoke with Node from repository root after both temporary jars have been built.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
process.env.LOAD_PROJECT = 'order-show-load-lottery';
process.env.LOAD_BACKEND_PORT = '8680';
process.env.LOAD_RESULTS_ROOT = 'outputs/load-lottery';
process.env.LOAD_DASHBOARD_SUMMARY_ENABLED = 'true';
const online=Number(process.argv[3]||100);
assert([100,1000].includes(online));
process.env.LOTTERY_LOAD_ONLINE=String(online);
process.env.LOTTERY_BENCH_JAR = resolve('backend/target/order-show-backend-0.1.0.jar').replaceAll('\\', '/');
const { compose, docker, guard, base, save } = await import('./lib.mjs');
const beforeJar = resolve('work/lottery-before/backend/target/order-show-backend-0.1.0.jar').replaceAll('\\', '/');
const afterJar = process.env.LOTTERY_BENCH_JAR;
assert(existsSync(afterJar));
const overlay = ['-f', 'tests/load/lottery-backend.compose.yml'];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function child(args,script='lottery-event.mjs') {
  const processChild = spawn(process.execPath, ['tests/load/'+script, ...args], { env: process.env, stdio: 'inherit', windowsHide: true });
  const result = await new Promise((resolve, reject) => { processChild.on('error', reject); processChild.on('exit', resolve); });
  assert.equal(result, 0, `Workload failed: ${args.join(' ')}`);
}
async function ready() {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(base + '/actuator/health/readiness', { signal: AbortSignal.timeout(2000) }); if (r.ok && (await r.json()).status === 'UP') return; } catch { /* starting */ }
    await wait(1000);
  }
  throw Error('Isolated backend did not become ready');
}
// Alternate order to reduce systematic bias from always testing one version first.
const standardRuns = [['baseline',100], ['before',100], ['after',100], ['after',200], ['before',200], ['baseline',200]];
const allRuns = [...standardRuns, ['weighted-baseline',200], ['weighted',200]];
const only = process.argv[2];
assert(!only || allRuns.some(([variant, rate]) => `${variant}-${rate}` === only));
const runs = only ? allRuns.filter(([variant, rate]) => `${variant}-${rate}` === only) : standardRuns;
assert(!runs.some(([variant])=>variant==='before') || existsSync(beforeJar));
docker([...compose, ...overlay, 'up', '-d', '--wait', 'mysql', 'redis', 'minio'], { timeout: 180000 });
guard();
try {
  for (const [variant, rate] of runs) {
    guard();
    docker([...compose, 'stop', 'backend']);
    docker([...compose, 'exec', '-T', '-e', 'MYSQL_PWD=load_only_root', 'mysql', 'mysql', '-uroot', '-e',
      'DROP DATABASE IF EXISTS order_show_load; CREATE DATABASE order_show_load CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;']);
    docker([...compose, 'exec', '-T', 'redis', 'redis-cli', 'FLUSHDB']);
    process.env.LOTTERY_BENCH_JAR = variant === 'before' ? beforeJar : afterJar;
    docker([...compose, ...overlay, 'up', '-d', '--no-build', '--force-recreate', 'backend']);
    await ready();
    await child(['seed', variant]);
    const label = `${variant}-${rate}${online===1000?'-online1000':''}`;
    try { await child(['run', label, String(rate)]); }
    catch(error) {
      save(`${label}-runner-error.json`,{label,message:String(error)});
      writeFileSync(`outputs/load-lottery/${label}-preflight-backend.log`,docker([...compose,'logs','--no-color','backend']));
      throw error;
    }
    if((variant==='after'||variant==='weighted')&&rate===200)await child([label],'lottery-explain.mjs');
    const reports = [...allRuns.map(([v,r])=>`${v}-${r}`),'after-200-online1000','baseline-200-online1000','weighted-baseline-200-online1000','weighted-200-online1000']
      .map(label=>`outputs/load-lottery/${label}.json`).filter(existsSync)
      .map(file => JSON.parse(readFileSync(file, 'utf8')));
    save('paired-summary.json', reports.map(r => ({ label: r.label, config: r.config, timings: r.timings,
      submitted: r.submitted, consistent: r.consistent, errors: r.errors, reconciliation: r.reconciliation })));
  }
} finally {
  // This project owns its volumes and has no business service/volume bindings.
  guard();
  docker([...compose, 'down', '--volumes'], { timeout: 120000 });
}
