// Bounded, explicit mixed test; never substitutes submit-only for the full flow.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { base, project, resultsRoot, guard, save } from './lib.mjs';

assert.equal(project, 'order-show-load-summary');
assert.equal(base, 'http://127.0.0.1:8480/api/v1');
assert.equal(resultsRoot.replace(/^\.\//, ''), 'outputs/load-summary');
const [label, secondsText = '90'] = process.argv.slice(2);
const seconds = Number(secondsText);
assert(/^[a-z0-9-]+$/.test(label || ''));
assert(Number.isInteger(seconds) && seconds >= 5 && seconds <= 300);
guard();
const started = Date.now();
function run(kind, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true, env: process.env });
    let output = '';
    child.stdout.on('data', data => { output += data; process.stdout.write(`${kind}: ${data}`); });
    child.stderr.on('data', data => process.stderr.write(`${kind}: ${data}`));
    child.on('error', reject);
    child.on('close', exitCode => {
      const records = output.split(/\r?\n/).flatMap(line => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
      resolve({ exitCode, result: records.findLast(record => kind === 'write' ? 'passed' in record : 'metrics' in record) ?? null });
    });
  });
}
const [write, read] = await Promise.all([
  run('write', ['tests/load/capacity.mjs', 'sustain', label, '10', `${seconds}s`]),
  run('read', ['tests/load/summary-read.mjs', label, '5', String(seconds)]),
]);
const result = { label, seconds, startedAt: new Date(started).toISOString(), endedAt: new Date().toISOString(),
  passed: write.exitCode === 0 && read.exitCode === 0 && write.result?.passed === true && read.result !== null,
  write, read };
save(`mixed-${started}.json`, result);
console.log(JSON.stringify({ mixed: started, passed: result.passed, write: write.result?.run, readP95: read.result?.metrics }));
process.exitCode = result.passed ? 0 : 1;
