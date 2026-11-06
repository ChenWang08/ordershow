// Fixed synthetic ACK MySQL only. No business URLs or data are accepted.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert(process.argv.includes('--ack-smoke'));
const out=process.env.ACK_RELEASE_OUT??'outputs/ack-release-20261106.1';
fs.mkdirSync(out,{recursive:true});
const run=(exe,args,input)=>execFileSync(exe,args,{encoding:'utf8',input,windowsHide:true,maxBuffer:64*1024*1024});
const container='order-show-ack-smoke-mysql-1',db='ack_upgrade_v054_'+Date.now();
assert.equal(run('docker',['inspect',container,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim(),'order-show-ack-smoke');
const sql=(q,database=db)=>{
  assert.match(database,/^ack_(?:smoke|upgrade_v054_\d+)$/);
  return run('docker',['exec','-i',container,'sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --default-character-set=utf8mb4 --batch --skip-column-names '+database],"SET time_zone='+00:00';\n"+q).trim();
};
sql('CREATE DATABASE '+db+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;','ack_smoke');
try {
  // The actual previously delivered V053 bundle, rather than a reconstructed baseline.
  sql(run('git',['show','c48e69c7d877c9d137df0dfecea0681c14866be8:deploy/dba/generated/fresh-install.sql']));
  assert.equal(sql('SELECT MAX(version) FROM deployment_schema_history'),'V053');
  const states=['QUEUED','RUNNING','FAILED','COMPLETED'];
  for(const [i,state] of states.entries())sql(`INSERT INTO activity_deletion_task(id,activity_id,activity_code,activity_name,department_id,department_name,requested_by,requested_by_name,reason,status,stage,deleted_rows,deleted_files,retry_count,revision,last_error,created_at,updated_at)
    VALUES(${i+1},${i+1},'ACT${i+1}','synthetic',1,'test',1,'test','test','${state}',${[0,10,31,43][i]},${i*12345},${i*10},${state==='FAILED'?5:0},${i*20},${state==='FAILED'?"'old safe error'":'NULL'},'2026-11-05 01:00:00','2026-11-05 02:00:00');`);
  const columns=sql("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='activity_deletion_task' ORDER BY ORDINAL_POSITION").split(/\r?\n/).map(c=>'`'+c+'`').join(',');
  const before=sql('SELECT '+columns+' FROM activity_deletion_task ORDER BY id');
  const workers=['activity_deletion_worker','activity_copy_worker','order_export_worker'];
  const workerBefore=Object.fromEntries(workers.map(t=>[t,sql('SELECT * FROM '+t)]));
  const bundle=fs.readFileSync('deploy/dba/generated/upgrade-v053-v054.sql','utf8');
  const manifest=JSON.parse(fs.readFileSync('deploy/dba/generated/upgrade-v053-v054.manifest.json','utf8'));
  assert.equal(crypto.createHash('sha256').update(bundle).digest('hex'),manifest.bundleSha256);
  for(const entry of manifest.migrations)assert.equal(crypto.createHash('sha256').update(fs.readFileSync('db/migrations/'+entry.file,'utf8').replace(/\r\n/g,'\n')).digest('hex'),entry.sha256);
  sql(bundle);
  assert.equal(sql('SELECT MAX(version) FROM deployment_schema_history'),'V054');
  assert.equal(sql('SELECT '+columns+' FROM activity_deletion_task ORDER BY id'),before);
  for(const t of workers)assert.equal(sql('SELECT * FROM '+t),workerBefore[t]);
  assert.equal(sql('SELECT COUNT(*) FROM activity_deletion_task WHERE last_progress_at=updated_at'),'4');
  sql("UPDATE activity_deletion_task SET status='PAUSED' WHERE id=2");
  assert.equal(sql('SELECT status FROM activity_deletion_task WHERE id=2'),'PAUSED');
  const tables=sql('SHOW TABLES').split(/\r?\n/);
  assert.deepEqual(tables,sql('SHOW TABLES','ack_smoke').split(/\r?\n/));
  for(const t of tables){
    const normalized=database=>sql('SHOW CREATE TABLE `'+t+'`',database).replace(/AUTO_INCREMENT=\d+ /g,'');
    assert.equal(normalized(db),normalized('ack_smoke'),'Fresh/upgrade schema must match: '+t);
  }
  assert.equal(sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='flyway_schema_history'"),'0');
  const result={passed:true,from:'V053',to:'V054',baselineSource:'c48e69c7d877c9d137df0dfecea0681c14866be8',preservedTasks:4,allOriginalTaskColumnsPreserved:true,preservedWorkers:workers,backfilledLastProgress:4,pausedConstraint:true,identicalTables:tables.length,bundleAndSourceChecksums:true,flywayHistoryAbsent:true,cloudExecuted:false,checkedAt:new Date().toISOString()};
  fs.writeFileSync(out+'/dba-v054-upgrade.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {sql('DROP DATABASE '+db,'ack_smoke');}
