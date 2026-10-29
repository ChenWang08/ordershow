// Read-only source snapshot; all mutations are restricted to a newly created disposable target DB.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const source = 'order-show-mysql-1', target = 'order-show-e2e-mysql-test-1', database = 'order_show_summary_copy';
function inspect(name) { return JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8' }))[0]; }
assert.equal(inspect(source).Config.Labels['com.docker.compose.project'], 'order-show');
assert.equal(inspect(target).Config.Labels['com.docker.compose.project'], 'order-show-e2e');
const targetArgs = ['exec', '-i', '-e', 'MYSQL_PWD=e2e_root_only_not_for_business', target, 'mysql', '-uroot', '--batch'];
function targetSql(sql) {
  const result = spawnSync('docker', targetArgs, { input: sql, encoding: 'utf8', maxBuffer: 4*1024*1024, timeout: 180000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
}
// Refuse to replace a previous copy. This command has no source-side write or locking SQL.
assert.equal(targetSql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${database}';`).trim().split('\n').at(-1), '0', 'Target copy already exists');
const snapshot = execFileSync('docker', ['exec', source, 'sh', '-c',
  'MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump -u"$MYSQL_USER" --single-transaction --skip-lock-tables --no-tablespaces --set-gtid-purged=OFF --skip-triggers "$MYSQL_DATABASE" activity customer_order order_item activity_region activity_dashboard_snapshot domain_event_outbox'],
  { encoding: 'utf8', maxBuffer: 128*1024*1024, timeout: 180000, windowsHide: true });
mkdirSync('outputs/dashboard-summary', { recursive: true });
writeFileSync('outputs/dashboard-summary/local-copy.sql', snapshot);
targetSql(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; USE ${database};\n${snapshot}`);
console.log(JSON.stringify({ copiedTables: 6, targetDatabase: database, sourceReadOnly: true, snapshotBytes: Buffer.byteLength(snapshot) }));
