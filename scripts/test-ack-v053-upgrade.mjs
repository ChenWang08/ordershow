// Fixed synthetic ACK MySQL only. No business URLs or data are accepted.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
assert(process.argv.includes('--ack-smoke'));
const root=process.cwd(),out=process.env.ACK_RELEASE_OUT??root+'/outputs/ack-release-20261105.1';fs.mkdirSync(out,{recursive:true});
const run=(exe,args,input)=>execFileSync(exe,args,{cwd:root,encoding:'utf8',input,windowsHide:true,maxBuffer:128*1024*1024});
const container='order-show-ack-smoke-mysql-1',db='ack_upgrade_v049_'+Date.now();
assert.equal(run('docker',['inspect',container,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim(),'order-show-ack-smoke');
const sql=(q,database=db)=>{assert.match(database,/^ack_(?:smoke|upgrade_v049_\d+)$/);return run('docker',['exec','-i',container,'sh','-c','MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --default-character-set=utf8mb4 --batch --skip-column-names '+database],"SET time_zone='+00:00';\n"+q).trim();};
sql('CREATE DATABASE '+db+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;','ack_smoke');
sql(run('git',['show','ebe891ba001b1c9ea03cebccb6bb3cf37ec17f00:deploy/dba/generated/fresh-install.sql']));
assert.equal(sql('SELECT MAX(version) FROM deployment_schema_history'),'V049');
const old=fs.readFileSync(root+'/scripts/test-ack-v049-upgrade.mjs','utf8');
const fixture=old.match(/sql\(`(INSERT INTO admin_user[\s\S]*?)`\);/);assert(fixture);sql(fixture[1]);
const tables=sql('SHOW TABLES').split(/\r?\n/).filter(t=>t!=='deployment_schema_history');
const definitions=Object.fromEntries(tables.map(t=>[t,sql(`SELECT COLUMN_NAME,DATA_TYPE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='${t}' ORDER BY ORDINAL_POSITION`).split(/\r?\n/).map(r=>r.split('\t'))]));
function fingerprint(){return Object.fromEntries(Object.entries(definitions).map(([table,cols])=>{
 const projection=cols.map(([c,t])=>/binary|blob|bit/.test(t)?'HEX(`'+c+'`)':'`'+c+'`').join(',');
 const rows=sql('SELECT JSON_ARRAY('+projection+') FROM `'+table+'` ORDER BY 1');
 return [table,{rows:Number(sql('SELECT COUNT(*) FROM `'+table+'`')),sha256:crypto.createHash('sha256').update(rows).digest('hex')}];
}));}
const before=fingerprint(),bundle=fs.readFileSync(root+'/deploy/dba/generated/upgrade-v049-v053.sql','utf8'),manifest=JSON.parse(fs.readFileSync(root+'/deploy/dba/generated/upgrade-v049-v053.manifest.json','utf8'));
assert.equal(crypto.createHash('sha256').update(bundle).digest('hex'),manifest.bundleSha256);
assert.deepEqual(manifest.migrations.map(m=>m.file.slice(0,4)),['V050','V051','V052','V053']);
sql(bundle);assert.equal(sql('SELECT MAX(version) FROM deployment_schema_history'),'V053');
assert.deepEqual(fingerprint(),before,'All original V049 columns and rows must be preserved');
assert.equal(sql('SELECT configuration_state,export_generation FROM activity WHERE id=1'),'READY\t0');
assert.equal(sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='flyway_schema_history'"),'0');
for(const table of ['activity_copy_worker','activity_deletion_worker','order_export_worker'])assert.equal(sql('SELECT COUNT(*) FROM '+table+' WHERE id=1'),'1');
const freshTables=sql('SHOW TABLES','ack_smoke').split(/\r?\n/),upgradedTables=sql('SHOW TABLES').split(/\r?\n/);assert.deepEqual(upgradedTables,freshTables);
const normalized=(table,database)=>sql('SHOW CREATE TABLE `'+table+'`',database).replace(/AUTO_INCREMENT=\d+ /g,'');
for(const table of freshTables)assert.equal(normalized(table,db),normalized(table,'ack_smoke'),'Fresh/upgrade schema must match: '+table);
const result={passed:true,from:'V049',to:'V053',originalTablesCompared:tables.length,originalColumnsAndRowsUnchanged:true,syntheticOrders:before.customer_order.rows,syntheticItems:before.order_item.rows,freshAndUpgradeSchemasMatch:true,tables:freshTables.length,flywayHistoryAbsent:true,workerRowsInitialized:true,checkedAt:new Date().toISOString()};
fs.writeFileSync(out+'/dba-v053-upgrade.json',JSON.stringify(result,null,2));
sql('DROP DATABASE '+db,'ack_smoke');console.log(JSON.stringify(result));
