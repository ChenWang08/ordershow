import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { save, resultsRoot, project } from './lib.mjs';

assert.equal(project, 'order-show-load-20261029');
const group = process.argv[2] || 'full';
const runSuffix = process.argv[3] || '';
assert(['full', 'verify', 'consume'].includes(group));
assert(/^[a-z0-9-]*$/.test(runSuffix));
const results = [];
async function invoke(args, allowFailure = false) {
  const child = spawn(process.execPath, ['tests/load/capacity.mjs', ...args], { stdio: 'inherit', windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  if (!allowFailure) assert.equal(code, 0, `${args.join(' ')} failed`);
  return code;
}
async function run(vus, refinementSuffix = '', duration = group === 'verify' ? '60s' : '10m') {
  const label = `${group}-${vus}${refinementSuffix}${runSuffix ? '-' + runSuffix : ''}`;
  await invoke(['seed', label, '1620']);
  await invoke(['smoke', label]);
  const latest = `${resultsRoot}/latest-result.json`;
  const previous = existsSync(latest) ? JSON.parse(readFileSync(latest, 'utf8')).run : null;
  await invoke([group, label, String(vus), duration], true);
  const result = JSON.parse(readFileSync(latest, 'utf8'));
  assert.notEqual(result.run, previous, 'Runner failed before producing a new measurement');
  assert(!result.notMeasured, 'Infrastructure failure is not a capacity measurement');
  results.push(result);
  save(`suite-${group}.json`, { group, results, complete: false });
  return result;
}
let passing = 0, failing = 0;
for (const vus of [5, 10, 20, 50, 100, 200, 500]) {
  const result = await run(vus);
  if (result.passed) passing = vus;
  else { failing = vus; break; }
}
if (!passing) {
  const result = await run(2);
  if (result.passed) passing = 2;
}
// Two bounded refinements, always retaining the failed stages and their diagnostics.
for (let refinement = 0; refinement < 2 && passing && failing - passing >= 10; refinement++) {
  const middle = Math.floor((passing + failing) / 10) * 5;
  if (middle <= passing || middle >= failing) break;
  const result = await run(middle, `-refine${refinement + 1}`);
  if (result.passed) passing = middle; else failing = middle;
}
save(`suite-${group}.json`, { group, results, complete: true, highestPassing: passing, lowestFailing: failing || null });
console.log(JSON.stringify({ suite: group, highestPassing: passing, lowestFailing: failing || null, runs: results.length }));
