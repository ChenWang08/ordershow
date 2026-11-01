// Builds a genuine V041 predecessor in the fixed synthetic ACK MySQL; never accepts business URLs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
assert(process.argv.includes('--ack-smoke'));
const container='order-show-ack-smoke-mysql-1',db='ack_upgrade_v041_'+Date.now(),out='outputs/ack-release-'+(process.env.ACK_IMAGE_TAG??'20261101.1');
const docker=(a,input)=>execFileSync('docker',a,{encoding:'utf8',input,timeout:120000,maxBuffer:64*1024*1024});
assert.equal(docker(['inspect',container,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim(),'order-show-ack-smoke');
const sql=(statement,database=db)=>docker(['exec','-i','-e','MYSQL_PWD=isolated_smoke_root',container,'mysql','-uroot','--batch','--raw','--skip-column-names',database],"SET time_zone='+00:00';\n"+statement).trim();
assert.equal(sql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${db}'`,'ack_smoke'),'0');
sql(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,'ack_smoke');
const files=readdirSync('db/migrations').filter(f=>/^V\d+__.*\.sql$/.test(f)&&Number(f.match(/^V(\d+)/)[1])<=41).sort((a,b)=>Number(a.match(/^V(\d+)/)[1])-Number(b.match(/^V(\d+)/)[1]));
for(const f of files)sql(readFileSync('db/migrations/'+f,'utf8'));
sql(`CREATE TABLE deployment_schema_history(version VARCHAR(64) PRIMARY KEY,applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),description VARCHAR(255) NOT NULL); INSERT INTO deployment_schema_history(version,description) VALUES('V041','Synthetic empty predecessor; V037 data-only migration inapplicable');`);
sql(`INSERT INTO admin_user(id,username,display_name,password_hash,role_code) VALUES(1,'upgrade-test','Synthetic','unused','SUPER_ADMIN');
INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,event_ends_at,created_by,updated_by) SELECT 1,id,'ACK-V041-UPGRADE','Synthetic','ACTIVE','2026-01-01','2099-01-01','2099-01-02',1,1 FROM department WHERE department_code='DEFAULT';
INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose,created_by) VALUES(1,1,'S3','synthetic','fixture','test.xlsx','application/octet-stream',1,UNHEX(SHA2('fixture',256)),'IMPORT_SOURCE',1);
INSERT INTO import_task(id,activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES(1,1,'PRODUCT','COMPLETED',1,UNHEX(SHA2('fixture',256)),1);
INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,status,created_by) VALUES(1,1,'PRODUCT',1,1,'PUBLISHED',1);
INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES(1,'GENERAL','Synthetic','synthetic');
INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,dealer_full_name,phone_ciphertext,phone_lookup_hash,phone_masked,source_import_task_id) VALUES(1,1,1,'GENERAL','Synthetic',X'01',UNHEX(SHA2('synthetic',256)),'synthetic',1);
INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_name,case_price,ton_case_factor,source_import_task_id,data_version_id) VALUES(1,1,'ALL','ALL','synthetic','Synthetic',100,100,1,1);
INSERT INTO activity_product_price_tier(activity_product_id,min_quantity,case_price,pricing_mode) VALUES(1,10,90,'INCREMENTAL');
INSERT INTO customer_order(id,activity_id,activity_customer_id,order_no,status,customer_type,dealer_full_name_snapshot,current_version_no,total_quantity,total_tons,total_amount,first_submitted_at,last_submitted_at,last_modified_at,last_modified_source) VALUES(1,1,1,'ACK-UPGRADE-1','SUBMITTED','GENERAL','Synthetic',1,2,0.02,200,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),'H5');
INSERT INTO order_item(order_id,activity_product_id,line_no,material_name,product_line,variety_name,rebate_status,is_gift_box,quantity,case_price,line_amount,ton_case_factor,line_tons) VALUES(1,1,1,'Synthetic','Line','Variety','ALL',FALSE,2,100,200,100,0.02);`);
const definitions={};
for(const table of sql('SHOW TABLES').split(/\r?\n/).filter(t=>t!=='deployment_schema_history')){
 const cols=sql(`SELECT COLUMN_NAME,DATA_TYPE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='${table}' ORDER BY ORDINAL_POSITION`).split(/\r?\n/).map(x=>x.split('\t')).filter(([c])=>!(table==='activity'&&c==='updated_at'));
 definitions[table]=cols;
}
const hash=()=>Object.fromEntries(Object.entries(definitions).map(([table,cols])=>{const projection=cols.map(([c,t])=>/binary|blob|bit/.test(t)?'HEX(`'+c+'`)':'`'+c+'`').join(',');const where=table==='activity_product_price_tier'?' WHERE min_quantity>1':'';const rows=sql(`SELECT JSON_ARRAY(${projection}) FROM \`${table}\`${where} ORDER BY 1`);return [table,createHash('sha256').update(rows).digest('hex')];}));
const before=hash(),bundle=readFileSync('deploy/dba/generated/upgrade-v041-v049.sql','utf8'),manifest=JSON.parse(readFileSync('deploy/dba/generated/upgrade-v041-v049.manifest.json','utf8'));
assert.equal(createHash('sha256').update(bundle).digest('hex'),manifest.bundleSha256);
sql(bundle);assert.equal(sql('SELECT MAX(version) FROM deployment_schema_history'),'V049');assert.deepEqual(hash(),before);
assert.equal(sql('SELECT min_quantity,case_price FROM activity_product_price_tier ORDER BY min_quantity'),'1\t100.0000\n10\t90.0000');
assert.equal(sql('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=\'flyway_schema_history\''),'0');
assert.equal(sql('SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE()'),'0');
sql(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${db}.* TO 'ack_smoke'@'%'`);
for(const action of ['repair','check']){
 const log=docker(['exec','-e',`DB_URL=jdbc:mysql://mysql:3306/${db}?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC`,'-e','DB_USERNAME=ack_smoke','-e','DB_PASSWORD=isolated_smoke_password','order-show-ack-smoke-backend-a-1','java','-Xmx192m','-Dloader.main=com.fengyi.ordershow.maintenance.DashboardSummaryCommand','-cp','/app/app.jar','org.springframework.boot.loader.launch.PropertiesLauncher',action,'1']);
 writeFileSync(out+'/upgrade-v049-'+action+'.log',log);assert.match(log,/checked=1 differences=0/);
}
const result={passed:true,syntheticOnly:true,database:db,from:'V041',to:'V049',executed:8,comparedTables:Object.keys(before).length,originalBusinessColumnsUnchanged:true,expectedExceptions:['V048 first-price tier insertion','catalog version invalidation and activity.updated_at'],orders:1,summaryDifferences:0,flywayHistoryAbsent:true,triggers:0};
writeFileSync(out+'/dba-v049-upgrade-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
