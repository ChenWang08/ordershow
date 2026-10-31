// Guarded synthetic workload: 3000 customers, 500000 existing order items.
// Only the dedicated local Compose project is accepted. No business database settings.
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { project, base, resultsRoot, guard, sql, save, docker, compose, request } from './lib.mjs';
assert.equal(project,'order-show-load-lottery');
assert.equal(base,'http://127.0.0.1:8680/api/v1');
assert.equal(resultsRoot,'outputs/load-lottery');
guard();
const [mode,label,rateText]=process.argv.slice(2);
const sha=s=>createHash('sha256').update(s).digest('hex');
const phoneHash=s=>createHmac('sha256',Buffer.from(sha('load-only-hmac'),'hex')).update(s).digest('hex');
const fixtureFile=`${resultsRoot}/event-fixture.json`;
const activityId=101,code='LOAD-LOTTERY',preseed=2500,productCount=200;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));
if (mode === 'seed') {
  assert(['before', 'after', 'baseline', 'weighted', 'weighted-baseline'].includes(label));
  assert.equal(Number(sql("SELECT COUNT(*) FROM activity WHERE id=101 OR activity_code='LOAD-LOTTERY';").trim()), 0, 'Requires a fresh isolated fixture');
  assert.equal(Number(sql('SELECT COUNT(*) FROM customer_order;').trim()), 0, 'Requires no existing orders');
  const hasLive = Number(sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='order_ranking_stat';").trim());
  assert.equal(hasLive, 0, 'Uses current on-demand ranking schema');
  let fixture;
  if (existsSync(fixtureFile)) fixture = JSON.parse(readFileSync(fixtureFile, 'utf8'));
  else {
    fixture = { activityId, code, preseed, productCount, customers: [] };
    for (let id = 1; id <= 3000; id++) {
      const token = randomBytes(24).toString('hex'), csrf = randomBytes(24).toString('hex');
      fixture.customers.push({ id, code, type: id % 3 ? 'SPECIAL' : 'GENERAL', region: id % 5 ? `R${id % 4}` : null,
        phone: String(13900000000 + id), csrf, token, cookie: `ORDER_SHOW_H5_SESSION=${token}; ORDER_SHOW_H5_CSRF=${csrf}` });
    }
    save('event-fixture.json', fixture);
  }
  const statements = ["SET @admin=(SELECT id FROM admin_user WHERE username='load_admin');", 'START TRANSACTION;',
    "INSERT INTO department(id,department_code,department_name) VALUES(101,'LOAD-LOTTERY','Load ranking');",
    `INSERT INTO activity(id,department_id,activity_code,name,status,starts_at,ends_at,event_ends_at,published_at,created_by,updated_by) VALUES(101,101,'${code}','Synthetic lottery event','ACTIVE',UTC_TIMESTAMP()-INTERVAL 1 DAY,UTC_TIMESTAMP()+INTERVAL 2 DAY,UTC_TIMESTAMP()+INTERVAL 3 DAY,UTC_TIMESTAMP(),@admin,@admin);`];
  for (let i = 0; i < 2; i++) {
    const type = i ? 'WHITELIST' : 'PRODUCT', id = i + 1;
    statements.push(`INSERT INTO stored_file(id,activity_id,storage_provider,bucket_name,object_key,original_filename,content_type,size_bytes,sha256,file_purpose) VALUES(${id},101,'MINIO','order-show-load','fixture-${id}','SQL-fixture','application/octet-stream',0,UNHEX(SHA2('fixture',256)),'OTHER');`,
      `INSERT INTO import_task(id,activity_id,import_type,status,source_file_id,file_sha256,created_by) VALUES(${id},101,'${type}','COMPLETED',${id},UNHEX(SHA2('fixture',256)),@admin);`,
      `INSERT INTO import_publish_version(id,activity_id,data_type,version_no,source_import_task_id,status,row_count,created_by,published_at) VALUES(${id},101,'${type}',1,${id},'PUBLISHED',${i ? 3000 : 200},@admin,UTC_TIMESTAMP());`,
      `INSERT INTO activity_data_binding(activity_id,data_type,current_version_id,updated_by) VALUES(101,'${type}',${id},@admin);`);
  }
  for (let i = 0; i < 4; i++) statements.push(`INSERT INTO activity_region(activity_id,region_code,region_name) VALUES(101,'R${i}','Region ${i}');`);
  for (let p = 1; p <= productCount; p++) statements.push(`INSERT INTO activity_product(id,activity_id,customer_type,rebate_status,business_key,material_code,material_name,product_line,variety_name,case_price,ton_case_factor,source_import_task_id,data_version_id) VALUES(${p},101,'ALL','ALL','LOAD-${p}','P${p}','Load product ${p}','P${p % 4}','V${p % 20}',100,1000,1,1);`);
  for (const c of fixture.customers) statements.push(
    `INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES(${c.id},'${c.type}','Load customer ${c.id}','loadcustomer${c.id}');`,
    `INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,region_code,branch_name,normalized_branch_name,dealer_full_name,normalized_dealer_full_name,phone,phone_lookup_hash,phone_masked,source_import_task_id,data_version_id) VALUES(${c.id},101,${c.id},'${c.type}',${c.region ? `'${c.region}'` : 'NULL'},'Branch ${c.id % 30}','branch${c.id % 30}','Load customer ${c.id}','loadcustomer${c.id}','${c.phone}',UNHEX('${phoneHash(c.phone)}'),'139****${c.phone.slice(-4)}',2,2);`,
    `INSERT INTO h5_session(activity_id,activity_customer_id,token_hash,csrf_token_hash,expires_at,last_seen_at) VALUES(101,${c.id},UNHEX('${sha(c.token)}'),UNHEX('${sha(c.csrf)}'),UTC_TIMESTAMP()+INTERVAL 2 DAY,UTC_TIMESTAMP());`);
  statements.push(`INSERT INTO customer_order(id,activity_id,activity_customer_id,order_no,status,customer_type,region_code,branch_name_snapshot,dealer_full_name_snapshot,current_version_no,total_quantity,total_tons,total_amount,first_submitted_at,last_submitted_at,last_modified_at)
    SELECT id,101,id,CONCAT('LOAD-',id),'SUBMITTED',customer_type,region_code,branch_name,dealer_full_name,1,200,0.2,20000,'2026-10-30','2026-10-30','2026-10-30' FROM activity_customer WHERE id<=${preseed};`,
    `INSERT INTO order_item(order_id,activity_product_id,line_no,material_code,material_name,product_line,variety_name,rebate_status,is_gift_box,quantity,case_price,line_amount,ton_case_factor,line_tons)
    SELECT o.id,p.id,p.id,p.material_code,p.material_name,p.product_line,p.variety_name,'ALL',FALSE,1,100,100,1000,0.001 FROM customer_order o CROSS JOIN activity_product p;`,
    `INSERT INTO order_version(id,activity_id,order_id,version_no,customer_type,region_code,branch_name_snapshot,dealer_full_name_snapshot,total_quantity,total_tons,total_amount,submitted_source,submitted_at,request_idempotency_key)
    SELECT id,101,id,1,customer_type,region_code,branch_name_snapshot,dealer_full_name_snapshot,200,0.2,20000,'H5','2026-10-30',CONCAT('fixture-',id) FROM customer_order;`,
    `INSERT INTO order_version_item(order_version_id,line_no,activity_product_id,material_code,material_name,product_line,variety_name,customer_type,rebate_status,is_gift_box,quantity,case_price,line_amount,ton_case_factor,line_tons)
    SELECT i.order_id,i.line_no,i.activity_product_id,i.material_code,i.material_name,i.product_line,i.variety_name,'ALL','ALL',FALSE,1,100,100,1000,0.001 FROM order_item i;`,
    'INSERT INTO order_dashboard_stat(order_id,item_count,all_tons,eligible_tons,dirty) SELECT id,200,0.2,0.2,FALSE FROM customer_order;',
    'INSERT INTO order_dashboard_product_line_stat(order_id,product_line,is_gift_box,line_amount,quantity) SELECT order_id,product_line,FALSE,SUM(line_amount),SUM(quantity) FROM order_item GROUP BY order_id,product_line;');
  if (hasLive) statements.push('INSERT INTO order_ranking_stat(order_id,source_version) SELECT id,lock_version FROM customer_order;',
    'INSERT INTO order_ranking_product_stat(order_id,product_line,variety_name,amount,quantity,all_tons,eligible_tons) SELECT order_id,product_line,variety_name,SUM(line_amount),SUM(quantity),SUM(line_tons),SUM(line_tons) FROM order_item GROUP BY order_id,product_line,variety_name;');
  statements.push('COMMIT;', 'ANALYZE TABLE customer_order,order_item,order_dashboard_stat;');
  // Seeding is outside measurement; root migrations are complete and the app user writes the fixture.
  guard();
  docker([...compose, 'exec', '-T', '-e', 'MYSQL_PWD=load_only_password', 'mysql',
    'mysql', '-uorder_show_load', 'order_show_load'], { input: "SET time_zone='+00:00';\n" + statements.join('\n'), timeout: 300000 });
  console.log(JSON.stringify({ seeded: label, customers: 3000, orders: preseed, items: preseed * productCount }));
  process.exit(0);
}

assert.equal(mode,'run');
assert(/^(baseline|before|after|weighted|weighted-baseline)-(100|200)(-online1000)?$/.test(label||''));
const rate=Number(rateText);assert([100,200].includes(rate));
const online=Number(process.env.LOTTERY_LOAD_ONLINE||100);assert([100,1000].includes(online));
const baseline=label.startsWith('baseline')||label.startsWith('weighted-baseline'),weighted=label.startsWith('weighted-')&&!baseline,after=label.startsWith('after')||weighted;
const fixture=JSON.parse(readFileSync(fixtureFile,'utf8'));
const path=`/h5/activities/${code}`,lottery='/admin/activities/101/lottery';
const items=Array.from({length:200},(_,i)=>({productId:i+1,quantity:1}));
const observations=[],errors=[],draws=[],metrics=[];
let epoch=performance.now();
async function call(step,url,session,method='GET',body,key) {
  const start=performance.now();let r;
  try {
    r=await request(url,{session,method,body,key});
    observations.push({step,ms:performance.now()-start,status:r.status,at_ms:performance.now()-epoch});
    if(r.status!==200)throw Error(`${step}: HTTP ${r.status} ${r.code}`);
    return r.data;
  }catch(e){if(!r)observations.push({step,ms:performance.now()-start,status:0,at_ms:performance.now()-epoch});errors.push({step,customer:session?.id,message:e.message});throw e;}
}
const login=await request('/admin/auth/login',{method:'POST',body:{username:'load_admin',password:'LoadOnlyPassword123!'}});
assert.equal(login.status,200);const admin=login.session;
if(login.data.mustChangePassword)assert.equal((await request('/admin/auth/change-password',{method:'POST',session:admin,body:{currentPassword:'LoadOnlyPassword123!',newPassword:'LoadOnlyChanged123!'}})).status,200);
const common={winnerCount:10,candidateScope:'VALID_ORDERS',customerType:'ALL',minimumOrderAmount:0,minimumOrderBoxCount:0,
  qualificationMetric:'AMOUNT',probabilityMode:'ORDER_AMOUNT_WEIGHTED',excludePreviousWinners:false,displayNameType:'FULL_NAME'};
const filtered={...common,customerType:'SPECIAL',productLine:'P0',varieties:['V0','V4'],qualificationMetric:'TONS',minimumOrderTons:0.02};
function roundConfig(n) {
  if(weighted&&n===1)return {...common,probabilityMode:'ORDER_BOX_COUNT_WEIGHTED',qualificationMetric:'BOX_COUNT'};
  if(weighted&&n===2)return {...filtered,probabilityMode:'ORDER_BOX_COUNT_WEIGHTED',qualificationMetric:'BOX_COUNT',minimumOrderBoxCount:20,minimumOrderTons:0};
  if(weighted&&n>=3)return {...filtered,probabilityMode:'ORDER_TONS_WEIGHTED'};
  // Keep the previous mixed amount/ton threshold fixture for old baseline reports only.
  return after&&n>=2?{...filtered,qualificationMetric:'AMOUNT',minimumOrderAmount:2000,minimumOrderTons:0}:common;
}
const rounds=Array.from({length:10},(_,n)=>({...roundConfig(n),name:`Round ${n+1}`,prizeName:'Synthetic prize'}));
let rule=await call('setup_create',lottery+'/rules',admin,'POST',{name:'Synthetic lottery',rounds});
rule=await call('setup_publish',lottery+`/rules/${rule.id}/publish`,admin,'POST');
if(after){const opts=await call('setup_options',lottery+'/product-options',admin);assert.equal(opts.length,20);}
function validOrder(d,id,version=1){assert.equal(d.activityCustomerId,id);assert.equal(d.status,'SUBMITTED');assert.equal(d.currentVersion,version);assert.equal(d.totalQuantity,200*version);assert.equal(Number(d.totalAmount),20000*version);assert.equal(d.items.length,200);assert(d.items.every(i=>i.quantity===version));}
for(const c of fixture.customers.slice(0,10)) {assert.equal((await request(path+'/products',{session:c})).status,200);validOrder((await request(path+'/order?includeHistory=false',{session:c})).data,c.id);}
// Warm the same backend paths before timing. Drawing starts only during measured traffic.
if(!baseline)await call('warmup_preview',lottery+'/candidates/preview',admin,'POST',{...common,roundNo:1});
observations.length=0;
const backendId=docker([...compose,'ps','-q','backend']).trim();const c=JSON.parse(docker(['inspect',backendId]))[0];
const config={rate_per_minute:rate,duration_seconds:120,browsing_sessions:online,activity_streams:online,burst_orders:20,
  existing_order_increases:20,orders_before:preseed,items_per_order:200,lottery:!baseline,filtered_last_two:after,weighted_modes:weighted,
  jar_sha256:sha(readFileSync(process.env.LOTTERY_BENCH_JAR)),backend_cpus:c.HostConfig.NanoCpus/1e9,backend_memory:c.HostConfig.Memory,
  environment:c.Config.Env.filter(e=>/^(DB_POOL_SIZE|DASHBOARD_SUMMARY_ENABLED|JAVA_TOOL_OPTIONS|H5_WRITE_CONCURRENCY|VIRTUAL_THREADS_ENABLED)=/.test(e))};
const dbStatus=()=>sql("SHOW GLOBAL STATUS WHERE Variable_name IN ('Innodb_row_lock_waits','Innodb_row_lock_time','Innodb_deadlocks','Threads_running');");
const dbBefore=dbStatus();
let sampling=false;
async function sample(){if(sampling)return;sampling=true;try{metrics.push({at_ms:performance.now()-epoch,values:await Promise.all(['hikaricp.connections.active','hikaricp.connections.pending','process.cpu.usage','order_show.h5.write.admission.waiting','order_show.lottery.preview.active','order_show.lottery.draw.active'].map(async name=>{try{const r=await fetch(base+'/actuator/metrics/'+name,{signal:AbortSignal.timeout(3000)});return {name,data:await r.json()};}catch{return {name,unavailable:true};}}))});}finally{sampling=false;}}
epoch=performance.now();
const sampleTimer=setInterval(sample,1000),progress=setInterval(()=>console.log(JSON.stringify({label,elapsed_seconds:Math.round((performance.now()-epoch)/1000),requests:observations.length,errors:errors.length})),30000);
const abort=new AbortController(),streamTimer=setTimeout(()=>abort.abort(),120000);
let streamsOpened=0,streamBytes=0;
const tasks=Array.from({length:online},(_,i)=>(async()=>{await wait(epoch+i*10000/online-performance.now());try{
  const r=await fetch(base+`/public/activities/${code}/events`,{signal:abort.signal,headers:{Origin:'http://localhost:3200'}});assert.equal(r.status,200);streamsOpened++;for await(const b of r.body)streamBytes+=b.length;
  if(!abort.signal.aborted)throw Error('SSE ended unexpectedly');
}catch(e){if(!abort.signal.aborted){errors.push({step:'stream',message:e.message});throw e;}}})());
const submitted=new Set(),increased=new Set();
async function submit(customer,burst=false){
  const d=await call('submission_draft',path+'/order-draft',customer,'PUT',{customerId:customer.id,baseOrderVersion:0,items});assert.equal(d.items.length,200);
  validOrder(await call(burst?'burst_submit':'submit',path+'/order?includeHistory=false',customer,'PUT',{expectedVersion:0,items},`${label}-${customer.id}`),customer.id);
  submitted.add(customer.id);validOrder(await call('confirmation',path+'/order?includeHistory=false',customer),customer.id);
}
for(let i=0;i<online;i++)tasks.push((async()=>{const customer=fixture.customers[i];for(let cycle=0;cycle<8;cycle++){
  await wait(epoch+i*10000/online+cycle*15000-performance.now());assert.equal((await call('browse_products',path+'/products',customer)).length,200);
  const d=await call('browse_order',path+'/order?includeHistory=false',customer);
  if(i>=200&&i<220)assert([1,2].includes(d.currentVersion));
  validOrder(d,customer.id,i>=200&&i<220?d.currentVersion:1);
}})());
for(let i=0;i<rate*2;i++)tasks.push((async()=>{await wait(epoch+i*60000/rate-performance.now());await submit(fixture.customers[preseed+i]);})());
tasks.push((async()=>{await wait(epoch+90000-performance.now());const results=await Promise.allSettled(fixture.customers.slice(preseed+rate*2,preseed+rate*2+20).map(c=>submit(c,true)));assert(results.every(r=>r.status==='fulfilled'));})());
// Increase existing orders while draw snapshot FKs reference them, in addition to new orders.
for(let n=0;n<4;n++)tasks.push((async()=>{await wait(epoch+[22000,52000,90000,112000][n]-performance.now());const results=await Promise.allSettled(fixture.customers.slice(200+n*5,205+n*5).map(async customer=>{
  validOrder(await call('existing_increase',path+'/order?includeHistory=false',customer,'PUT',{expectedVersion:1,items:items.map(i=>({...i,quantity:2}))},`${label}-increase-${customer.id}`),customer.id,2);increased.add(customer.id);
}));assert(results.every(r=>r.status==='fulfilled'));})());
if(!baseline){
  for(let n=0;n<8;n++)tasks.push((async()=>{await wait(epoch+15000+n*14000-performance.now());await call('rules_read',lottery+'/rules',admin);await call('public_read',`/public/activities/${code}/lottery`);})());
  for(let n=0;n<4;n++)tasks.push((async()=>{await wait(epoch+7000+n*30000-performance.now());const filteredRound=after&&n>=2,setting=roundConfig(n);
    const p=await call(filteredRound?'filtered_preview':'preview',lottery+'/candidates/preview',admin,'POST',{...setting,roundNo:n+1});assert.equal(p.candidateCount,p.candidates.length);assert(p.candidateCount>=1600);
    if(filteredRound)assert(p.candidates.every(c=>Number(c.qualifyingOrderAmount)===2000||Number(c.qualifyingOrderAmount)===4000));
    if(weighted){const field=setting.probabilityMode==='ORDER_BOX_COUNT_WEIGHTED'?'qualifyingOrderBoxCount':setting.probabilityMode==='ORDER_TONS_WEIGHTED'?'qualifyingOrderTons':'qualifyingOrderAmount';
      const sum=p.candidates.reduce((s,c)=>s+Number(c[field]),0);assert(Math.abs(sum-Number(p.totalCandidateWeight))<0.000001);
      assert(p.candidates.every(c=>Number(c[field])>0&&Math.abs(Number(c.probabilityPercent)-Number(c[field])/sum*100)<0.00000001));}
  })());
  tasks.push((async()=>{for(let n=0;n<4;n++){
    await wait(epoch+[22000,52000,90000,112000][n]-performance.now());const r=await call(after&&n>=2?'filtered_draw':'draw',lottery+`/rounds/${rule.rounds[n].id}/draw`,admin,'POST');
    assert.equal(r.actualWinnerCount,10);assert.equal(new Set(r.winners.map(w=>w.activityCustomerId)).size,10);draws.push({...r,probabilityMode:roundConfig(n).probabilityMode});
    await call('complete',lottery+`/rounds/${r.roundId}/complete`,admin,'POST');
  }})());
}
let settled;
try{settled=await Promise.allSettled(tasks);await wait(epoch+120000-performance.now());}finally{clearInterval(sampleTimer);clearInterval(progress);clearTimeout(streamTimer);abort.abort();}
await sample();
const failures=settled.filter(r=>r.status==='rejected').map(r=>r.reason.message);
const expectedOrders=preseed+rate*2+20;
const final=sql(`SELECT COUNT(*),SUM(total_amount),SUM(total_quantity),SUM(total_tons) FROM customer_order WHERE activity_id=101 AND status='SUBMITTED';
  SELECT COUNT(*) FROM (SELECT o.id FROM customer_order o JOIN order_item i ON i.order_id=o.id GROUP BY o.id,o.total_amount,o.total_quantity,o.total_tons HAVING SUM(i.line_amount)<>o.total_amount OR SUM(i.quantity)<>o.total_quantity OR SUM(i.line_tons)<>o.total_tons) mismatch;
  SELECT COUNT(*) FROM customer_order o LEFT JOIN order_dashboard_stat s ON s.order_id=o.id WHERE s.order_id IS NULL OR s.dirty OR s.item_count<>200 OR s.all_tons<>o.total_tons;
  SELECT COUNT(*) FROM customer_order o LEFT JOIN order_version v ON v.order_id=o.id AND v.version_no=o.current_version_no WHERE v.id IS NULL OR v.total_amount<>o.total_amount OR v.total_quantity<>o.total_quantity OR v.total_tons<>o.total_tons;
  SELECT COUNT(*) FROM lottery_draw_attempt;
  SELECT COUNT(*) FROM lottery_candidate_snapshot;
  SELECT COUNT(*) FROM lottery_winner;
  SELECT COUNT(*) FROM lottery_draw_attempt a WHERE a.candidate_count<>(SELECT COUNT(*) FROM lottery_candidate_snapshot s WHERE s.draw_attempt_id=a.id) OR a.winner_count<>(SELECT COUNT(*) FROM lottery_winner w WHERE w.draw_attempt_id=a.id);
  SELECT COUNT(*) FROM lottery_winner w JOIN lottery_candidate_snapshot s ON s.id=w.candidate_snapshot_id WHERE s.activity_customer_id<>w.activity_customer_id OR s.draw_attempt_id<>w.draw_attempt_id;
  SELECT COUNT(*) FROM order_version;`).trim().split('\n');
const totals=final[0].split('\t').map(Number),units=expectedOrders+20;
const weightAuditMismatches=weighted?Number(sql(`SELECT COUNT(*) FROM lottery_draw_attempt a JOIN (
  SELECT draw_attempt_id,SUM(qualifying_order_amount) amount,SUM(qualifying_order_box_count) boxes,SUM(COALESCE(qualifying_order_tons,0)) tons
  FROM lottery_candidate_snapshot GROUP BY draw_attempt_id
) s ON s.draw_attempt_id=a.id WHERE CAST(JSON_UNQUOTE(JSON_EXTRACT(a.rule_snapshot_json,'$.totalCandidateWeight')) AS DECIMAL(38,6))
<> CASE JSON_UNQUOTE(JSON_EXTRACT(a.rule_snapshot_json,'$.weightMetric')) WHEN 'AMOUNT' THEN s.amount WHEN 'BOX_COUNT' THEN s.boxes WHEN 'TONS' THEN s.tons ELSE a.candidate_count END;`).trim()):0;
let historySamples=0;
for(const customer of [fixture.customers[0],fixture.customers[200],fixture.customers[preseed]]){
  const v=customer.id===201?2:1,d=(await request(path+'/order?includeHistory=true',{session:customer})).data;
  validOrder(d,customer.id,v);assert.equal(d.versions.length,v);assert(d.versions.every(v=>v.items.length===200));historySamples++;
}
const consistent=totals[0]===expectedOrders&&totals[1]===units*20000&&totals[2]===units*200&&Math.abs(totals[3]-units*.2)<.000001
  &&final.slice(1,4).every(x=>Number(x)===0)&&Number(final[4])===(baseline?0:4)&&Number(final[5])===draws.reduce((s,d)=>s+d.candidateCount,0)
  &&Number(final[6])===(baseline?0:40)&&Number(final[7])===0&&Number(final[8])===0&&Number(final[9])===expectedOrders+20&&weightAuditMismatches===0;
function percentiles(rows){if(!rows.length)return {samples:0};const values=rows.map(r=>r.ms).sort((a,b)=>a-b);return {samples:rows.length,failed:rows.filter(r=>r.status!==200).length,p50_ms:values[Math.ceil(values.length*.5)-1],p95_ms:values[Math.ceil(values.length*.95)-1],max_ms:values.at(-1)};}
const timings=Object.fromEntries([...new Set(observations.map(o=>o.step))].map(s=>[s,percentiles(observations.filter(o=>o.step===s))]));
const report={label,config,timings,submitted:submitted.size,increased:increased.size,failures,errors,consistent,draws,metrics,streamsOpened,streamBytes,
  reconciliation:{expected_orders:expectedOrders,totals,checks:final.slice(1).map(Number),history_samples:historySamples,weight_audit_mismatches:weightAuditMismatches},database_before:dbBefore,database_after:dbStatus()};
save(`${label}.json`,report);save(`${label}-requests.json`,observations);
writeFileSync(`${resultsRoot}/${label}-backend.log`,docker([...compose,'logs','--no-color','backend']));
console.log(JSON.stringify({label,timings,consistent,errors:errors.length,failed_tasks:failures.length}));
assert.equal(errors.length,0);assert.equal(failures.length,0);assert.equal(streamsOpened,online);assert(streamBytes>0);assert(consistent);
