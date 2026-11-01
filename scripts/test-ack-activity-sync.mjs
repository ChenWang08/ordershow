// Fixed disposable ACK stack; exercises both deployed replicas and real Redis.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
assert(process.argv.includes('--ack-smoke'));
const docker=a=>execFileSync('docker',a,{encoding:'utf8',timeout:30000});
for(const name of ['backend-a','backend-b','redis'])assert.equal(docker(['inspect',`order-show-ack-smoke-${name}-1`,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim(),'order-show-ack-smoke');
const bases=[18081,18082].map(p=>`http://127.0.0.1:${p}/api/v1`);
const fixture=JSON.parse(readFileSync('outputs/ack-manual-additions/fixtures.json','utf8'));
const admin={},h5={};let checks=0;
async function call(replica,session,method,path,body,headers={}){
 const r=await fetch(bases[replica]+path,{method,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(session.cookie?{Cookie:session.cookie}:{}),...(session.csrf?{'X-CSRF-Token':session.csrf}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));checks++;
 if(r.headers.getSetCookie().length)session.cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return j.data;
}
admin.csrf=(await call(0,admin,'POST','/admin/auth/login',{username:fixture.username,password:fixture.password})).csrfToken;
const ap='/admin/activities/'+fixture.activity.id,code=encodeURIComponent(fixture.activity.code),hp='/h5/activities/'+code;
h5.csrf=(await call(0,h5,'POST',`/public/activities/${code}/verify-phone`,{customerType:'GENERAL',phone:'13900000501'})).csrfToken;
async function stream(replica){
 const abort=new AbortController(),messages=[];
 const r=await fetch(bases[replica]+`/public/activities/${code}/events`,{signal:abort.signal});assert.equal(r.status,200);
 const reader=r.body.getReader();let buffer='';
 const loop=(async()=>{try{for(;;){const {value,done}=await reader.read();if(done)break;buffer+=new TextDecoder().decode(value).replaceAll('\r','');let n;while((n=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,n);buffer=buffer.slice(n+2);if(frame.split('\n').some(l=>/^event:\s*activity$/.test(l))){const data=frame.split('\n').find(l=>l.startsWith('data:'));if(data)messages.push(JSON.parse(data.slice(5)));}}}}catch(e){if(!abort.signal.aborted)throw e;}})();loop.catch(()=>{});
 return {messages,close:async()=>{abort.abort();await loop;},wait:async predicate=>{const end=Date.now()+15000;while(!messages.some(predicate)){assert(Date.now()<end,'Activity SSE timeout');await delay(30);}}};
}
const streams=await Promise.all([0,1].map(stream));
try{
 await Promise.all(streams.map(s=>s.wait(m=>m.activity?.id===fixture.activity.id)));
 let activity=await call(0,admin,'GET',ap);const originalUrl=activity.liveRoomUrl;
 const url='https://smoke.invalid/activity-sync-'+Date.now();
 activity=await call(0,admin,'PATCH',ap+'/live-room',{liveRoomUrl:url},{'If-Match':String(activity.version)});
 await Promise.all(streams.map(s=>s.wait(m=>m.activity?.liveRoomUrl===url)));
 await call(1,admin,'PATCH',ap+'/live-room',{liveRoomUrl:originalUrl??''},{'If-Match':String(activity.version)});
 const initial=await Promise.all([0,1].map(i=>call(i,h5,'GET',hp+'/products'))),product=initial[0].find(p=>p.materialCode==='MANUALSEED');assert(product);
 const price=Number(product.casePrice)+1;
 const adminProduct=(await call(0,admin,'GET',ap+'/products')).find(p=>p.id===product.id);assert(adminProduct);
 const patched=await call(0,admin,'PATCH',ap+'/products/'+product.id,{casePrice:price,casePriceSet:true,reason:'ACK synthetic cache invalidation'},{'If-Match':String(adminProduct.version)});
 try { for(const i of [0,1]){const list=await call(i,h5,'GET',hp+'/products');assert.equal(Number(list.find(p=>p.id===product.id).casePrice),price);} } finally {
 await call(1,admin,'PATCH',ap+'/products/'+product.id,{casePrice:product.casePrice,casePriceSet:true,reason:'Restore synthetic fixture price'},{'If-Match':String(patched.version)});
 }
 const redis=['exec','order-show-ack-smoke-redis-1','redis-cli'];
 for(const channel of ['order-show:ack-smoke:events:activity-info:v1','order-show:ack-smoke:events:product-catalog:v1']){const count=docker([...redis,'--raw','PUBSUB','NUMSUB',channel]).trim().split(/\r?\n/).at(-1);assert.equal(Number(count),2);}
 assert.equal(Number(docker([...redis,'PUBLISH','order-show:other-environment:events:activity-info:v1','{}']).trim()),0);
 const removed=await fetch(bases[0]+`/public/activities/${code}`);assert.equal(removed.status,404);
 const result={passed:true,checks,replicas:2,publicActivitySse:true,crossReplicaUpdate:true,catalogInvalidation:true,environmentChannels:true,legacyActivityGetStatus:404,realCloudResourcesAccessed:false};
 writeFileSync('outputs/ack-release-'+(process.env.ACK_IMAGE_TAG??'20261101.1')+'/activity-sync-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await Promise.all(streams.map(s=>s.close()));}
