import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
export const project = process.env.LOAD_PROJECT || 'order-show-load';
export const resultsRoot = process.env.LOAD_RESULTS_ROOT || 'outputs/load';
const port = Number(process.env.LOAD_BACKEND_PORT || 8280);
if(!/^order-show-load(?:-[a-z0-9-]+)?$/.test(project) || !Number.isInteger(port) || port<1024 || port>65535
    || !/^(?:\.\/?|)outputs[\\/]load(?:-[a-z0-9-]+)?$/.test(resultsRoot)) throw Error('Invalid isolated load environment settings');
export const base = `http://127.0.0.1:${port}/api/v1`;
export const compose = ['compose', '-p', project, '-f', 'docker-compose.load.yml'];
export function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024, ...options });
}
export function guard() {
  const id = docker([...compose, 'ps', '-q', 'mysql']).trim();
  assert(id, 'Start the isolated load stack first');
  const c = JSON.parse(docker(['inspect', id]))[0];
  assert.equal(c.Config.Labels['com.docker.compose.project'], project);
  assert(c.Config.Env.includes('MYSQL_DATABASE=order_show_load'));
  assert(c.Mounts.every(m => m.Type !== 'volume' || m.Name.startsWith(project + '_')));
}
export function sql(query) {
  guard();
  return docker([...compose, 'exec', '-T', '-e', 'MYSQL_PWD=load_only_password', 'mysql',
    'mysql', '-uorder_show_load', '--batch', '--skip-column-names', 'order_show_load'], { input: "SET time_zone = '+00:00';\n" + query });
}
export function save(name, data) {
  assert(/^[\w.-]+$/.test(name));
  mkdirSync(resultsRoot, { recursive: true });
  writeFileSync(`${resultsRoot}/${name}`, JSON.stringify(data, null, 2));
}
export async function request(path, { method = 'GET', body, session, key, headers: extra = {} } = {}) {
  const headers = { Origin: 'http://localhost:3200', ...extra };
  if (body) headers['Content-Type'] = 'application/json';
  if (session) { headers.Cookie = session.cookie; headers['X-CSRF-Token'] = session.csrf; }
  if (key) headers['Idempotency-Key'] = key;
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000), redirect: 'error' });
  const json = await r.json();
  return { status: r.status, data: json.data, code: json.code,
    session: { cookie: r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '), csrf: json.data?.csrfToken } };
}
