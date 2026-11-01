// Fixed disposable ACK stack; public HTTP metadata across two final-image replicas.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
assert(process.argv.includes('--ack-smoke'));
const docker=a=>execFileSync('docker',a,{encoding:'utf8',timeout:30000,windowsHide:true});
for(const name of ['backend-a','backend-b','mysql','redis'])assert.equal(docker(['inspect',`order-show-ack-smoke-${name}-1`,'--format','{{index .Config.Labels "com.docker.compose.project"}}']).trim(),'order-show-ack-smoke');
const fixture=JSON.parse(readFileSync('outputs/ack-manual-additions/fixtures.json','utf8'));
const bases=[18081,18082].map(p=>`http://127.0.0.1:${p}/api/v1`),admin={},h5={};let checks=0;
const ap='/admin/activities/'+fixture.activity.id,code=encodeURIComponent(fixture.activity.code),publicPath='/public/activities/'+code;
async function call(replica,session,method,path,body,headers={}){
 const r=await fetch(bases[replica]+path,{method,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(session.cookie?{Cookie:session.cookie}:{}),...(session.csrf?{'X-CSRF-Token':session.csrf}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const j=await r.json();assert.equal(r.status,200,JSON.stringify(j));checks++;
 if(r.headers.getSetCookie().length)session.cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return j.data;
}
async function metadata(replica,tag,status=200){
 const r=await fetch(bases[replica]+publicPath,{headers:tag?{'If-None-Match':tag}:{},signal:AbortSignal.timeout(10000)});
 assert.equal(r.status,status);assert.match(r.headers.get('content-type')??'',/json|^$/);assert(r.headers.get('etag'));checks++;
 if(status===304){assert.equal(await r.text(),'');return {tag:r.headers.get('etag')};}
 const data=(await r.json()).data;assert.equal(data.code,fixture.activity.code);return {tag:r.headers.get('etag'),data};
}
admin.csrf=(await call(0,admin,'POST','/admin/auth/login',{username:fixture.username,password:fixture.password})).csrfToken;
h5.csrf=(await call(0,h5,'POST',publicPath+'/verify-phone',{customerType:'GENERAL',phone:'13900000501'})).csrfToken;
const initial=await Promise.all([0,1].map(i=>metadata(i)));
assert.equal(initial[0].tag,initial[1].tag);
await Promise.all([0,1].map(i=>metadata(i,initial[i].tag,304)));
let activity=await call(0,admin,'GET',ap);const originalUrl=activity.liveRoomUrl;
const url='https://smoke.invalid/http-sync-'+Date.now();
activity=await call(0,admin,'PATCH',ap+'/live-room',{liveRoomUrl:url},{'If-Match':String(activity.version)});
await delay(2150);
const changed=await Promise.all([0,1].map(i=>metadata(i,initial[i].tag)));
for(const value of changed){assert.equal(value.data.liveRoomUrl,url);assert.notEqual(value.tag,initial[0].tag);}
assert.equal(changed[0].tag,changed[1].tag);
await Promise.all([0,1].map(i=>metadata(i,changed[i].tag,304)));
await call(1,admin,'PATCH',ap+'/live-room',{liveRoomUrl:originalUrl??''},{'If-Match':String(activity.version)});
await delay(2150);
const restored=await Promise.all([0,1].map(i=>metadata(i,changed[i].tag)));
for(const value of restored)assert.equal(value.data.liveRoomUrl??'',originalUrl??'');
const sql=s=>docker(['exec','-i','-e','MYSQL_PWD=isolated_smoke_password','order-show-ack-smoke-mysql-1','mysql','-uack_smoke','-N','ack_smoke','-e',s]).trim();
assert.equal(sql('SELECT DATABASE()'),'ack_smoke');
sql(`UPDATE activity SET status='ACTIVE',starts_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 6 SECOND),event_ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY),public_info_version=public_info_version+1 WHERE id=${Number(fixture.activity.id)}`);
await delay(2150);
const active=await Promise.all([0,1].map(i=>metadata(i)));active.forEach(x=>assert.equal(x.data.status,'ACTIVE'));
await delay(4100);
const closed=await Promise.all([0,1].map(i=>metadata(i,active[i].tag)));closed.forEach(x=>assert.equal(x.data.status,'CLOSED'));
activity=await call(0,admin,'GET',ap);
await call(1,admin,'POST',ap+'/reopen',{endsAt:new Date(Date.now()+3600000).toISOString(),eventEndsAt:new Date(Date.now()+7200000).toISOString(),reason:'isolated HTTP reopen verification'},{'If-Match':String(activity.version)});
await delay(2150);
const reopened=await Promise.all([0,1].map(i=>metadata(i,closed[i].tag)));reopened.forEach(x=>assert.equal(x.data.status,'ACTIVE'));
const hp='/h5/activities/'+code;
const catalogs=await Promise.all([0,1].map(i=>call(i,h5,'GET',hp+'/products'))),product=catalogs[0].find(p=>p.materialCode==='MANUALSEED');assert(product);
const adminProduct=(await call(0,admin,'GET',ap+'/products')).find(p=>p.id===product.id);
const price=Number(product.casePrice)+1;
const patched=await call(0,admin,'PATCH',ap+'/products/'+product.id,{casePrice:price,casePriceSet:true,reason:'ACK synthetic cache invalidation'},{'If-Match':String(adminProduct.version)});
try{for(const i of [0,1])assert.equal(Number((await call(i,h5,'GET',hp+'/products')).find(p=>p.id===product.id).casePrice),price);}
finally{await call(1,admin,'PATCH',ap+'/products/'+product.id,{casePrice:product.casePrice,casePriceSet:true,reason:'Restore synthetic fixture price'},{'If-Match':String(patched.version)});}
const result={passed:true,checks,replicas:2,http200And304:true,crossReplicaUpdate:true,deadlineAndReopen:true,catalogInvalidation:true,databasePoolPerReplica:10,realCloudResourcesAccessed:false};
const out='outputs/ack-release-'+(process.env.ACK_IMAGE_TAG??'20261101.2');mkdirSync(out,{recursive:true});writeFileSync(out+'/activity-sync-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
