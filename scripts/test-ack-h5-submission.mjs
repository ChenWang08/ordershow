import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
assert(process.argv.includes('--ack-smoke'));
assert.equal(execFileSync('docker',['inspect','order-show-ack-smoke-backend-a-1','--format','{{index .Config.Labels "com.docker.compose.project"}}'],{encoding:'utf8'}).trim(),'order-show-ack-smoke');
const f=JSON.parse(readFileSync('outputs/ack-manual-additions/fixtures.json'));
const bases=['http://127.0.0.1:18081/api/v1','http://127.0.0.1:18082/api/v1'];
let checks=0;
async function call(replica,session,method,path,body,expected=200,key){
 const r=await fetch(bases[replica]+path,{method,signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(session.cookie?{Cookie:session.cookie}:{}),...(session.csrf?{'X-CSRF-Token':session.csrf}:{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const json=await r.json();if(expected!==null)assert.equal(r.status,expected,JSON.stringify(json));checks++;
 if(r.headers.getSetCookie().length)session.cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 return {status:r.status,...json};
}
const admin={};admin.csrf=(await call(0,admin,'POST','/admin/auth/login',{username:f.username,password:f.password})).data.csrfToken;
const path='/admin/activities/'+f.activity.id, products=[];
const stamp=Date.now();
for(let i=0;i<180;i++){
 const r=await call(i%2,admin,'POST',path+'/products',{customerType:'ALL',rebateStatus:'ALL',materialCode:`ACKLARGE${stamp}-${i}`,materialName:`ACK合成大单商品${i}`,casePrice:100,tonCaseFactor:10,reason:'ACK isolated verification'});
 products.push(r.data.id);
}
const records=[];
for(const [type,size,phone] of [['GENERAL',180,'13900000801'],['SPECIAL',41,'13900000802']]){
 await call(0,admin,'POST',path+'/customers',{customerType:type,branchName:'ACK隔离分公司',dealerShortName:type+stamp,dealerFullName:type+stamp,phone,reason:'ACK isolated verification'});
 const h5={};h5.csrf=(await call(0,h5,'POST',`/public/activities/${f.activity.code}/verify-phone`,{customerType:type,phone,...(type==='GENERAL'?{regionCode:'UNASSIGNED'}:{})})).data.csrfToken;
 const endpoint=`/h5/activities/${f.activity.code}/order`, items=products.slice(0,size).map(productId=>({productId,quantity:1}));
 const key=randomUUID(), firstBody={expectedVersion:0,items},start=performance.now();
 const first=await Promise.all([0,1].map(replica=>call(replica,h5,'PUT',endpoint,firstBody,200,key)));
 assert.deepEqual(first[0].data,first[1].data);const order=first[0].data;
 assert.equal(Number(order.totalAmount),size*100);assert.equal(Number(order.totalQuantity),size);assert.equal(order.items.length,size);
 const unchanged=(await call(1,h5,'PUT',endpoint,{expectedVersion:order.currentVersion,items},200,randomUUID())).data;
 assert.equal(unchanged.currentVersion,order.currentVersion);
 const increased={expectedVersion:order.currentVersion,items:items.map(x=>({...x,quantity:2}))};
 const races=await Promise.all([0,1].map(replica=>call(replica,h5,'PUT',endpoint,increased,null,randomUUID())));
 assert.deepEqual(races.map(x=>x.status).sort(),[200,409]);
 const current=(await call(0,h5,'GET',endpoint)).data;
 assert.equal(current.currentVersion,order.currentVersion+1);assert.equal(current.items.length,size);assert.equal(Number(current.totalAmount),size*200);
 const reduced=await call(1,h5,'PUT',endpoint,{expectedVersion:current.currentVersion,items},409,randomUUID());assert.equal(reduced.code,'ORDER_CHANGE_REVIEW_REQUIRED');
 const replay=(await call(1,h5,'PUT',endpoint,firstBody,200,key)).data;assert.deepEqual(replay,order);
 const sql=`SELECT (SELECT COUNT(*) FROM order_item WHERE order_id=${Number(order.id)}),(SELECT COUNT(*) FROM order_version WHERE order_id=${Number(order.id)}),(SELECT COUNT(*) FROM order_version_item i JOIN order_version v ON v.id=i.order_version_id WHERE v.order_id=${Number(order.id)});`;
 const values=execFileSync('docker',['exec','-e','MYSQL_PWD=isolated_smoke_password','order-show-ack-smoke-mysql-1','mysql','-uack_smoke','-N','ack_smoke','-e',sql],{encoding:'utf8'}).trim().split('\t').map(Number);
 assert.deepEqual(values,[size,2,size*2]);records.push({type,size,orderId:order.id,counts:values,scenarioMs:performance.now()-start});
}
const releaseTag=process.env.ACK_IMAGE_TAG??'20261029.3';
assert.match(releaseTag,/^\d{8}\.\d+$/);
const resultDir='outputs/ack-release-'+releaseTag;mkdirSync(resultDir,{recursive:true});
writeFileSync(resultDir+'/h5-submission-result.json',JSON.stringify({checks,records},null,2));
console.log('PASS',JSON.stringify({checks,records}));
