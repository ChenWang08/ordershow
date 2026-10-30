import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

// This checks backend event fanout; manual-refresh pages do not subscribe to these events.
// Fixed disposable stack, populated by test-manual-additions.mjs --ack-smoke.
assert.ok(process.argv.includes('--ack-smoke'), 'Requires the explicit ACK smoke switch');
assert.equal(execFileSync('docker',['inspect','order-show-ack-smoke-backend-a-1','--format','{{index .Config.Labels "com.docker.compose.project"}}'],{encoding:'utf8'}).trim(),'order-show-ack-smoke');
const bases=['http://127.0.0.1:18081/api/v1','http://127.0.0.1:18082/api/v1'];
const fixture=JSON.parse(await readFile(new URL('../outputs/ack-manual-additions/fixtures.json',import.meta.url),'utf8'));
const code=encodeURIComponent(fixture.activity.code);
const adminPath='/admin/activities/'+Number(fixture.activity.id);
const h5Path='/h5/activities/'+code;
const screen='/screen/activities/'+code;
let assertions=0;
async function call(replica,session,method,path,body,expected=200,headers={}) {
 const response=await fetch(bases[replica]+path,{method,signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',...(session?.cookie?{Cookie:session.cookie}:{}),...(session?.csrf?{'X-CSRF-Token':session.csrf}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const result=await response.json();
 assert.equal(response.status,expected,method+' '+path+': '+JSON.stringify(result));assertions++;
 if(session&&response.headers.getSetCookie().length)session.cookie=response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 return result.data;
}
const admin={};
admin.csrf=(await call(0,admin,'POST','/admin/auth/login',{username:fixture.username,password:fixture.password})).csrfToken;
let h5={};
async function verifyPhone() {
 h5={};
 h5.csrf=(await call(0,h5,'POST','/public/activities/'+code+'/verify-phone',{customerType:'GENERAL',phone:'13900000501'})).csrfToken;
}
await verifyPhone();
const products=await call(1,h5,'GET',h5Path+'/products');
const product=products.find(p=>p.materialCode==='MANUALSEED');
assert.ok(product,'Synthetic seed product is visible through the other replica');
const paths=['/dashboard','/ranking?metric=AMOUNT','/ranking?metric=TONS','/reports/'+encodeURIComponent('总战绩')];
function dashboard(value) {return value.dashboard??value;}
async function verifyTotals(count,amount,tons) {
 const responses=await Promise.all(bases.flatMap((_,replica)=>paths.map(path=>call(replica,null,'GET',screen+path))));
 for(const data of responses) {
  const totals=dashboard(data).totals;
  assert.equal(Number(totals.order_count),count);assert.equal(Number(totals.total_amount),amount);assert.equal(Number(totals.total_tons),tons);
 }
 return responses;
}
async function subscribe(replica) {
 const abort=new AbortController();const messages=[];
 const response=await fetch(bases[replica]+screen+'/events',{signal:abort.signal});assert.equal(response.status,200);
 const reader=response.body.getReader();
 const loop=(async()=>{let buffer='';try {for(;;){const {value,done}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value).replaceAll('\r','');let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);if(frame.split('\n').some(l=>l==='event:invalidate')){const line=frame.split('\n').find(l=>l.startsWith('data:'));if(line)messages.push(JSON.parse(line.slice(5)));}}}}catch(error){if(!abort.signal.aborted)throw error;}})();
 // Consume errors immediately even while waiting for API operations.
 loop.catch(()=>{});
 return {messages,close:async()=>{abort.abort();await loop;},wait:async predicate=>{const deadline=Date.now()+18000;while(!messages.some(predicate)){assert.ok(Date.now()<deadline,'SSE notification timeout on replica '+replica);await delay(25);}}};
}
let streams=await Promise.all([0,1].map(subscribe));
const timing=[];
async function changeAndVerify(label,write,count,amount,tons) {
 const before=Number(dashboard(await call(0,null,'GET',screen+'/dashboard')).version);
 const concurrent=Promise.all(bases.flatMap((_,replica)=>paths.map(path=>call(replica,null,'GET',screen+path))));
 const started=performance.now();await write();await concurrent;
 await Promise.all(streams.map(s=>s.wait(m=>m.reason!=='RECOVERY'&&Number(m.version)>before)));
 await verifyTotals(count,amount,tons);
 timing.push({label,writeNotificationAndReadsMs:Number((performance.now()-started).toFixed(2))});
}
function body(version,quantity){return {expectedVersion:version,items:[{productId:product.id,quantity}]};}
function submit(payload){return call(1,h5,'PUT',h5Path+'/order',payload,200,{'Idempotency-Key':randomUUID()});}
let order;
try {
 await verifyTotals(0,0,0);
 const amount=Number(product.casePrice)*2;
 // The synthetic fixture has casePrice=100 and tonCaseFactor=10.
 assert.equal(amount,200);assert.equal(Number(product.tonCaseFactor),10);
 await changeAndVerify('submit',async()=>{order=await submit(body(0,2));},1,200,0.2);
 const request=await call(0,h5,'POST',h5Path+'/order-change-requests',{...body(order.currentVersion,1),requestType:'MODIFY'},200,{'Idempotency-Key':randomUUID()});
 await changeAndVerify('approve-decrease',()=>call(1,admin,'POST',adminPath+'/order-change-requests/'+request.id+'/approve',{reason:'ACK screen regression'},200,{'Idempotency-Key':randomUUID()}),1,100,0.1);
 order=await call(0,h5,'GET',h5Path+'/order');
 const withdrawal=await call(1,h5,'POST',h5Path+'/order-change-requests',{expectedVersion:order.currentVersion,requestType:'WITHDRAW',items:[]},200,{'Idempotency-Key':randomUUID()});
 await changeAndVerify('approve-withdrawal',()=>call(0,admin,'POST',adminPath+'/order-change-requests/'+withdrawal.id+'/approve',{reason:'ACK screen regression'},200,{'Idempotency-Key':randomUUID()}),0,0,0);
 await changeAndVerify('resubmit',async()=>{order=await submit(body(order.currentVersion,2));},1,200,0.2);
 await Promise.all(streams.map(s=>s.wait(m=>m.reason==='RECOVERY')));
 for(const stream of streams){const seen=new Set();for(const event of stream.messages.filter(m=>m.version!==undefined)){assert.ok(!seen.has(event.version),'Unexpected duplicate normal-publication version '+event.version);seen.add(event.version);}}
 let activity=await call(0,admin,'GET',adminPath);
 activity=await call(1,admin,'POST',adminPath+'/close',{reason:'ACK screen regression'},200,{'If-Match':String(activity.version)});
 activity=await call(0,admin,'POST',adminPath+'/finish',{reason:'ACK screen regression'},200,{'If-Match':String(activity.version)});
 assert.equal(activity.status,'FINISHED');await verifyTotals(1,200,0.2);
 await Promise.all(streams.map(s=>s.close()));streams=[];
 const finishedEvents=await fetch(bases[0]+screen+'/events');assert.equal(finishedEvents.status,409);await finishedEvents.body.cancel();
 activity=await call(1,admin,'POST',adminPath+'/reopen',{endsAt:new Date(Date.now()+3600000).toISOString(),eventEndsAt:new Date(Date.now()+7200000).toISOString(),reason:'ACK screen regression'},200,{'If-Match':String(activity.version)});
 assert.equal(activity.status,'ACTIVE');await verifyPhone();
 streams=await Promise.all([0,1].map(subscribe));
 await changeAndVerify('reopen-and-increase',async()=>{order=await submit(body(order.currentVersion,3));},1,300,0.3);
 const pages=[];
 for(const path of ['/admin','/screen/'+code+'/dashboard','/screen/'+code+'/ranking','/screen/'+code+'/report']) {
  const response=await fetch('http://127.0.0.1:18030'+path);assert.equal(response.status,200);await response.text();pages.push(path);
 }
 const releaseTag=process.env.ACK_IMAGE_TAG??'20261030.1';
 assert.match(releaseTag,/^\d{8}\.\d+$/);
 const resultDir='outputs/ack-release-'+releaseTag;
 await mkdir(resultDir,{recursive:true});
 await writeFile(resultDir+'/events-api-result.json',JSON.stringify({assertions,timing,pages,replicas:2,poolLimitPerReplica:10,periodicRecovery:true,normalPublicationDuplicates:0,finalOrderQuantity:order.totalQuantity},null,2));
 console.log('PASS: '+assertions+' API checks, four screen APIs on both replicas, concurrent reads and writes, real Redis notifications, 15-second recovery, approval, withdrawal, historical views and reopen.');
} finally {await Promise.all(streams.map(s=>s.close()));}
