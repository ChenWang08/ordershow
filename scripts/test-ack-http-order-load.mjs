// Explicit disposable final-image load: 300 new orders/minute, no continuous metadata polling.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
assert(process.argv.includes('--ack-smoke'));
const docker=(args,options={})=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:30000,...options});
for(const role of ['mysql','backend-a','backend-b'])assert.equal(docker(['inspect',`order-show-ack-smoke-${role}-1`,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim(),'order-show-ack-smoke');
const sql=statement=>docker(['exec','-i','-e','MYSQL_PWD=isolated_smoke_password','order-show-ack-smoke-mysql-1','mysql','-uack_smoke','-N','ack_smoke'],{input:statement}).trim();
assert.equal(sql('SELECT DATABASE()'),'ack_smoke');
const f=JSON.parse(readFileSync('outputs/ack-manual-additions/fixtures.json','utf8'));
const id=Number(f.activity.id),base='http://127.0.0.1:18081/api/v1',code=encodeURIComponent(f.activity.code);
assert(Number.isSafeInteger(id)&&id>0);
assert.equal(Number(sql("SELECT COUNT(*) FROM customer WHERE normalized_dealer_full_name LIKE 'ackhttpload%';")),0,'Fixture already used');
const binding=sql(`SELECT data_type,current_version_id FROM activity_data_binding WHERE activity_id=${id}`).split('\n').map(l=>l.trim().split('\t'));
const whitelist=Number(binding.find(x=>x[0]==='WHITELIST')?.[1]);assert(whitelist>0);
const whitelistTask=Number(sql(`SELECT source_import_task_id FROM import_publish_version WHERE id=${whitelist}`));assert(whitelistTask>0);
const customerBase=990000000,productBase=990100000;
assert.equal(Number(sql(`SELECT COUNT(*) FROM customer WHERE id BETWEEN ${customerBase+1} AND ${customerBase+920}`)),0);
const statements=['START TRANSACTION;'];
for(let n=1;n<=920;n++){
 const customer=customerBase+n;
 statements.push(`INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES (${customer},'GENERAL','ACK HTTP load ${n}','ackhttpload${n}');`);
 statements.push(`INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,dealer_full_name,normalized_dealer_full_name,phone_lookup_hash,phone_masked,source_import_task_id,data_version_id) VALUES (${customer},${id},${customer},'GENERAL','ACK HTTP load ${n}','ackhttpload${n}',UNHEX(SHA2('ack-load-${n}',256)),'138****0000',${whitelistTask},${whitelist});`);
 statements.push(`INSERT INTO h5_session(activity_id,activity_customer_id,token_hash,csrf_token_hash,expires_at,last_seen_at) VALUES (${id},${customer},UNHEX(SHA2('ack-http-load-${n}',256)),UNHEX(SHA2('ack-http-load-csrf',256)),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY),UTC_TIMESTAMP(3));`);
}
const productsVersion=Number(binding.find(x=>x[0]==='PRODUCT')?.[1]);assert(productsVersion>0);
const productsTask=Number(sql(`SELECT source_import_task_id FROM import_publish_version WHERE id=${productsVersion}`));assert(productsTask>0);
for(let n=1;n<=180;n++)statements.push(`INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_code,material_name,product_line,case_pack,case_price,ton_case_factor,is_visible,is_orderable,sort_no,data_status,source_import_task_id,data_version_id) VALUES (${productBase+n},${id},'ALL','ALL','ack-http-${n}','ACKHTTP${n}','ACK HTTP product ${n}','HTTP load line','4',100,50,TRUE,TRUE,${n},'ACTIVE',${productsTask},${productsVersion});`);
statements.push('COMMIT;');sql(statements.join('\n'));
// A fresh catalog version prevents use of the already-warmed small fixture catalog.
sql(`UPDATE activity SET product_catalog_version=product_catalog_version+1 WHERE id=${id};`);
const items=Array.from({length:180},(_,i)=>({productId:productBase+i+1,quantity:1})),regular=[],burst=[],errors=[];
const before=Number(sql(`SELECT COUNT(*) FROM customer_order WHERE activity_id=${id}`));
async function request(replica,n,path,options={}){
 const r=await fetch(`http://127.0.0.1:${replica?18082:18081}/api/v1`+path,{...options,signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',Cookie:`ORDER_SHOW_H5_SESSION=ack-http-load-${n}; ORDER_SHOW_H5_CSRF=ack-http-load-csrf`,'X-CSRF-Token':'ack-http-load-csrf',...options.headers}});
 const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));return body.data;
}
async function journey(n,target){try{
 const replica=n%2;
 assert.equal((await request(replica,n,'/public/activities/'+code)).code,f.activity.code);
 const catalog=await request(replica,n,`/h5/activities/${code}/products`);assert(catalog.some(x=>x.id===productBase+180));
 const started=performance.now();
 const submitted=await request(replica,n,`/h5/activities/${code}/order?includeHistory=false`,{method:'PUT',headers:{'Idempotency-Key':'ack-http-load-'+n},body:JSON.stringify({expectedVersion:0,items})});
 const elapsed=performance.now()-started;assert.equal(Number(submitted.totalAmount),18000);
 const confirmed=await request(1-replica,n,`/h5/activities/${code}/order?includeHistory=false`);assert.equal(confirmed.items.length,180);assert.equal(confirmed.id,submitted.id);
 target.push(elapsed);
}catch(error){errors.push({customer:n,message:String(error)});}}
const started=performance.now(),pending=[];
for(let i=0;i<900;i++){
 await delay(Math.max(0,started+i*200-performance.now()));pending.push(journey(i+1,regular));
 if(i===450)for(let n=901;n<=920;n++)pending.push(journey(n,burst));
 if(i%300===299)console.log('HTTP_LOAD progress: '+(i+1)+'/900 regular dispatched');
}
await Promise.all(pending);
const percentile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*q)-1)]??null;
const counts=sql(`SELECT COUNT(*),SUM(total_amount) FROM customer_order WHERE activity_id=${id} AND activity_customer_id BETWEEN ${customerBase+1} AND ${customerBase+920}; SELECT COUNT(*) FROM order_item i JOIN customer_order o ON o.id=i.order_id WHERE o.activity_id=${id} AND o.activity_customer_id BETWEEN ${customerBase+1} AND ${customerBase+920}; SELECT COUNT(*) FROM order_version v JOIN customer_order o ON o.id=v.order_id WHERE o.activity_id=${id} AND o.activity_customer_id BETWEEN ${customerBase+1} AND ${customerBase+920};`).split(/\s+/).map(Number);
const mismatches=Number(sql(`SELECT COUNT(*) FROM customer_order o LEFT JOIN order_dashboard_stat s ON s.order_id=o.id WHERE o.activity_id=${id} AND o.activity_customer_id BETWEEN ${customerBase+1} AND ${customerBase+920} AND (s.order_id IS NULL OR s.dirty OR s.item_count<>180 OR o.total_amount<>(SELECT SUM(i.line_amount) FROM order_item i WHERE i.order_id=o.id) OR o.total_amount<>(SELECT SUM(p.line_amount) FROM order_dashboard_product_line_stat p WHERE p.order_id=o.id));`));
const result={targetOrdersPerMinute:300,durationSeconds:(performance.now()-started)/1000,regularSubmissions:regular.length,burstSubmissions:burst.length,regularP95Ms:percentile(regular,.95),regularMaxMs:percentile(regular,1),burstP95Ms:percentile(burst,.95),errors,counts,reconciliationMismatches:mismatches,itemsPerOrder:180,replicas:2,databasePoolPerReplica:10,beforeOrders:before};
const out='outputs/ack-release-'+(process.env.ACK_IMAGE_TAG??'20261101.2');mkdirSync(out,{recursive:true});writeFileSync(out+'/order-load.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
assert.deepEqual(errors,[]);assert.equal(regular.length,900);assert.equal(burst.length,20);assert.deepEqual(counts,[920,16560000,165600,920]);assert.equal(mismatches,0);assert(result.regularP95Ms<1000);assert(result.burstP95Ms<1000);
