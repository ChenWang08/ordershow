// Fixed disposable ACK stack only. Closed-loop 10 writers + 5 readers; summaries stay ON.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
assert(process.argv.includes('--ack-smoke'));
const seconds=Number(process.argv.find(x=>/^--seconds=/.test(x))?.split('=')[1]??90);
assert([90,300].includes(seconds));
const releaseTag=process.env.ACK_IMAGE_TAG??'20261030.1';assert.match(releaseTag,/^\d{8}\.\d+$/);
const out=`outputs/ack-release-${releaseTag}`;mkdirSync(out,{recursive:true});
const docker=args=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:32*1024*1024,timeout:30000});
const resources={};
for(const name of ['backend-a','backend-b','mysql']) {
 const c=JSON.parse(docker(['inspect',`order-show-ack-smoke-${name}-1`]))[0];
 assert.equal(c.Config.Labels['com.docker.compose.project'],'order-show-ack-smoke');
 assert(c.HostConfig.Memory>0,'Bound isolated resources before running pressure');
 resources[name]={memoryBytes:c.HostConfig.Memory,nanoCpus:c.HostConfig.NanoCpus};
 if(name==='mysql')assert.equal(c.Mounts.find(m=>m.Destination==='/var/lib/mysql')?.Type,'volume');
 if(name.startsWith('backend')) {
  assert(c.Config.Env.includes('DASHBOARD_SUMMARY_ENABLED=true'));
  assert(c.Config.Env.includes('H5_SESSION_CACHE_TTL_MS=0'));
  assert(c.Config.Env.includes('DB_POOL_SIZE=10'));
 }
}
const sql=s=>docker(['exec','-e','MYSQL_PWD=isolated_smoke_password','order-show-ack-smoke-mysql-1','mysql','-uack_smoke','-N','ack_smoke','-e',s]).trim();
assert.equal(sql('SELECT DATABASE()'),'ack_smoke');
const f=JSON.parse(readFileSync('outputs/ack-manual-additions/fixtures.json'));
const bases=['http://127.0.0.1:18081/api/v1','http://127.0.0.1:18082/api/v1'];
const metrics={},errors=[],users=[];let stopped=false,commits=0;
async function call(replica,session,method,path,body,key,metric) {
 const start=performance.now();
 const r=await fetch(bases[replica]+path,{method,signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',...(session?.cookie?{Cookie:session.cookie}:{}),...(session?.csrf?{'X-CSRF-Token':session.csrf}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const j=await r.json();if(metric)(metrics[metric]??=[]).push(performance.now()-start);
 assert.equal(r.status,200,`${method} ${path}: ${JSON.stringify(j)}`);
 if(session&&r.headers.getSetCookie().length)session.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 return j.data;
}
const admin={};admin.csrf=(await call(0,admin,'POST','/admin/auth/login',{username:f.username,password:f.password})).csrfToken;
const adminPath=`/admin/activities/${f.activity.id}`,h5=`/h5/activities/${f.activity.code}`;
const products=(await call(0,admin,'GET',adminPath+'/products')).filter(p=>p.materialCode.startsWith('ACKLARGE')).slice(-180);
assert.equal(products.length,180);
const stamp=Date.now();
for(let i=0;i<10;i++) {
 const type=i%2===0?'GENERAL':'SPECIAL',phone=`138${String(stamp+i).slice(-8)}`;
 const customer=await call(i%2,admin,'POST',adminPath+'/customers',{customerType:type,branchName:'ACK隔离分公司',dealerShortName:`load-${stamp}-${i}`,dealerFullName:`load-${stamp}-${i}`,phone,reason:'ACK bounded synthetic pressure'});
 const session={};session.csrf=(await call(i%2,session,'POST',`/public/activities/${f.activity.code}/verify-phone`,{customerType:type,phone,...(type==='GENERAL'?{regionCode:'UNASSIGNED'}:{})})).csrfToken;
 users.push({session,id:customer.id,type,products:products.slice(0,type==='GENERAL'?180:41).map(p=>p.id),commits:0});
}
const started=Date.now(),deadline=started+seconds*1000;
const deadlocks=()=>{
 const raw=docker(['exec','-e','MYSQL_PWD=isolated_smoke_root','order-show-ack-smoke-mysql-1','mysql','-uroot','-N','ack_smoke','-e',"SELECT COUNT FROM information_schema.INNODB_METRICS WHERE NAME='lock_deadlocks'"]).trim();
 assert.match(raw,/^\d+$/,'Required deadlock counter is missing');return Number(raw);
};
const deadlocksBefore=deadlocks();
const progress=setInterval(()=>{
 const snapshot={started,seconds,elapsedSeconds:(Date.now()-started)/1000,commits,errors,stopped,complete:false};
 writeFileSync(`${out}/progress-${stamp}.json`,JSON.stringify(snapshot,null,2));
 console.log(JSON.stringify({elapsedSeconds:snapshot.elapsedSeconds,commits,errors:errors.length}));
},15000);
process.on('SIGINT',()=>{stopped=true;errors.push('Interrupted by operator');});
function valid(order,user,quantity,version) {
 assert.equal(order.activityCustomerId,user.id);assert.equal(order.currentVersion,version);
 assert.equal(order.items.length,user.products.length);assert.equal(Number(order.totalAmount),user.products.length*quantity*100);
 assert.equal(Number(order.totalQuantity),user.products.length*quantity);
 for(const item of order.items){assert(user.products.includes(item.productId));assert.equal(item.quantity,quantity);assert.equal(Number(item.lineAmount),quantity*100);}
}
async function protect(fn){try{await fn();}catch(e){errors.push(e.stack);stopped=true;}}
await Promise.all([
 ...users.map((user,index)=>protect(async()=>{
  while(!stopped&&Date.now()<deadline) {
   const replica=(index+user.commits)%2;
   const current=await call(replica,user.session,'GET',h5+'/order?includeHistory=false',undefined,undefined,'current');
   const version=current?.currentVersion??0,quantity=(current?.items?.[0]?.quantity??0)+1;
   const items=user.products.map(productId=>({productId,quantity}));
   const draft=await call(1-replica,user.session,'PUT',h5+'/order-draft',{customerId:user.id,baseOrderVersion:version,items},undefined,'draft');
   assert.equal(draft.customerId,user.id);assert.equal(draft.items.length,items.length);
   const submitStart=performance.now();
   const order=await call(replica,user.session,'PUT',h5+'/order?includeHistory=false',{expectedVersion:version,items},randomUUID(),'submit');
   (metrics['submit_'+user.type]??=[]).push(performance.now()-submitStart);
   user.commits++;commits++;valid(order,user,quantity,version+1);
   const confirm=await call(1-replica,user.session,'GET',h5+'/order?includeHistory=false',undefined,undefined,'confirm');
   valid(confirm,user,quantity,version+1);assert.equal(confirm.id,order.id);
  }
 })),
 ...Array.from({length:5},(_,index)=>protect(async()=>{
  const paths=['/dashboard','/ranking?metric=AMOUNT','/ranking?metric=TONS','/reports/'+encodeURIComponent('总战绩')];let n=index;
  while(!stopped&&Date.now()<deadline){const p=n++%4;await call(n%2,null,'GET',`/screen/activities/${f.activity.code}`+paths[p],undefined,undefined,'read_'+p);}
 })),
]);
const measuredEnd=Date.now();
clearInterval(progress);
const reconciliation=[];
await protect(async()=>{
 for(const user of users) {
  assert(user.commits>0);
  const order=await call(0,user.session,'GET',h5+'/order?includeHistory=false');
  valid(order,user,user.commits,user.commits);
  const counts=sql(`SELECT (SELECT COUNT(*) FROM customer_order WHERE activity_customer_id=${user.id}),(SELECT COUNT(*) FROM order_version WHERE order_id=${order.id}),(SELECT COUNT(*) FROM order_operation WHERE order_id=${order.id});`).split('\t').map(Number);
  assert.deepEqual(counts,[1,user.commits,user.commits]);reconciliation.push({type:user.type,orderId:order.id,commits:user.commits,counts});
 }
 const activityIds=sql('SELECT DISTINCT activity_id FROM customer_order').split(/\s+/).map(Number);
 for(const id of activityIds){assert(id>0);const log=docker(['exec','order-show-ack-smoke-backend-a-1','java','-Dloader.main=com.fengyi.ordershow.maintenance.DashboardSummaryCommand','-cp','/app/app.jar','org.springframework.boot.loader.launch.PropertiesLauncher','check',String(id)]);writeFileSync(`${out}/load-${stamp}-summary-${id}.log`,log);assert.match(log,/differences=0/);}
});
const summary=Object.fromEntries(Object.entries(metrics).map(([name,values])=>{
 values.sort((a,b)=>a-b);const q=p=>values[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
 return [name,{count:values.length,p95:q(.95),p99:q(.99),max:values.at(-1)}];
}));
const limits={current:500,confirm:500,draft:1000,submit:1000,submit_GENERAL:1000,submit_SPECIAL:1000,read_0:1500,read_1:1500,read_2:1500,read_3:1500};
const failedThresholds=Object.entries(limits).filter(([name,limit])=>!summary[name]||summary[name].p95>=limit).map(([name,limit])=>({name,limit,actual:summary[name]?.p95}));
const deadlockDelta=deadlocks()-deadlocksBefore;
const result={seconds,actualSeconds:(measuredEnd-started)/1000,writers:10,readers:5,replicas:2,poolPerReplica:10,summaryEnabled:true,identityCacheTtlMs:0,resources,mysqlStorage:'isolated anonymous disk volume',commits,errors,deadlockDelta,metrics:summary,limits,failedThresholds,reconciliation,
 passed:errors.length===0&&deadlockDelta===0&&failedThresholds.length===0&&!stopped};
writeFileSync(`${out}/mixed-${seconds}-${stamp}.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result));process.exitCode=result.passed?0:1;
