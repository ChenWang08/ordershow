// Never accepts an external database. Copies ONLY synthetic ACK smoke data into a new disposable schema.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
assert(process.argv.includes('--ack-smoke'));
const container='order-show-ack-smoke-mysql-1',db='ack_upgrade_v039_20261030_v3';
const docker=(args,input)=>execFileSync('docker',args,{encoding:'utf8',input,maxBuffer:128*1024*1024,timeout:120000});
assert.equal(docker(['inspect',container,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim(),'order-show-ack-smoke');
const sql=(database,statement)=>docker(['exec','-i','-e','MYSQL_PWD=isolated_smoke_root',container,'mysql','-uroot','-N',database],statement).trim();
assert.equal(sql('ack_smoke','SELECT DATABASE()'),'ack_smoke');
assert.equal(sql('ack_smoke',`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${db}'`),'0','Refuse to overwrite an existing verification schema');
const dump=(database,options=[])=>docker(['exec','-e','MYSQL_PWD=isolated_smoke_root',container,'mysqldump','-uroot','--hex-blob','--no-tablespaces','--set-gtid-purged=OFF','--skip-comments','--compact','--skip-add-locks','--skip-disable-keys','--order-by-primary',...options,database]);
sql('ack_smoke',`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
sql('ack_smoke',`GRANT SELECT,INSERT,UPDATE,DELETE ON ${db}.* TO 'ack_smoke'@'%'`);
// mysqldump --compact omits its normal foreign-key prologue; restore table order explicitly.
sql(db,'SET FOREIGN_KEY_CHECKS=0;\n'+dump('ack_smoke')+'\nSET FOREIGN_KEY_CHECKS=1;');
sql(db,"DROP TABLE order_dashboard_product_line_stat; DROP TABLE order_dashboard_stat; DELETE FROM deployment_schema_history; INSERT INTO deployment_schema_history(version,description) VALUES('V039','Synthetic predecessor fixture only');");
const businessHash=()=>createHash('sha256').update(dump(db,['--no-create-info',`--ignore-table=${db}.order_dashboard_stat`,`--ignore-table=${db}.order_dashboard_product_line_stat`,`--ignore-table=${db}.deployment_schema_history`])).digest('hex');
const before=businessHash();
sql(db,readFileSync('deploy/dba/generated/upgrade-v039-v041.sql','utf8'));
assert.equal(sql(db,'SELECT MAX(version) FROM deployment_schema_history'),'V041');
assert.equal(sql(db,"SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE()"),'0');
assert.equal(businessHash(),before);
const out='outputs/ack-release-20261030.1';mkdirSync(out,{recursive:true});
const ids=sql(db,'SELECT DISTINCT activity_id FROM customer_order').split(/\s+/).map(Number),records=[];
for(const id of ids) {
 assert(id>0);
 for(const action of ['repair','check']) {
  const log=docker(['exec','-e',`DB_URL=jdbc:mysql://mysql:3306/${db}?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC`,'-e','DB_USERNAME=ack_smoke','-e','DB_PASSWORD=isolated_smoke_password','order-show-ack-smoke-backend-a-1','java','-Dloader.main=com.fengyi.ordershow.maintenance.DashboardSummaryCommand','-cp','/app/app.jar','org.springframework.boot.loader.launch.PropertiesLauncher',action,String(id)]);
  writeFileSync(`${out}/upgrade-${action}-${id}.log`,log);assert.match(log,/differences=0/);
  records.push({id,action,result:log.match(/checked=\d+ differences=0 nextAfterId=\d+/)?.[0]});
 }
}
assert.equal(businessHash(),before);
const result={database:db,syntheticOnly:true,businessDataHashBefore:before,businessDataHashAfter:businessHash(),orders:Number(sql(db,'SELECT COUNT(*) FROM customer_order')),version:'V041',triggers:0,records,passed:true};
writeFileSync(`${out}/dba-upgrade-result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
