import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {request,sql,save,guard} from './lib.mjs';
guard();
const fixture=JSON.parse(readFileSync('outputs/load/fixture.json','utf8'));
let login=await request('/admin/auth/login',{method:'POST',body:{username:'load_admin',password:'LoadOnlyChanged123!'}});
assert.equal(login.status,200);const session=login.session;
const activity=fixture.activities[0],root=`/admin/activities/${activity.id}`;
const product=()=>request(root+'/products',{session}).then(r=>{assert.equal(r.status,200);return r.data.find(p=>p.id===activity.products[0]);});
const changePrice=async price=>{const p=await product();const r=await request(root+`/products/${p.id}`,{method:'PATCH',session,headers:{'If-Match':String(p.version)},body:{casePrice:price,casePriceSet:true,reason:'LOAD concurrent pricing regression'}});assert.equal(r.status,200);};
const historicalMax=Number(sql('SELECT COALESCE(MAX(id),0) FROM order_version;').trim());
const historySql=`SELECT SUM(i.line_amount),SUM(i.quantity),SUM(i.case_price) FROM order_version_item i WHERE i.order_version_id<=${historicalMax};`;
const historyBefore=sql(historySql);
const users=fixture.customers.slice(2300,2310);
const writers=users.map(async user=>{
 const path=`/h5/activities/${user.code}/order?includeHistory=false`;
 for(let n=0;n<5;n++) {
  const current=await request(path,{session:user});assert.equal(current.status,200);
  const result=await request(path,{method:'PUT',session:user,key:randomUUID(),body:{expectedVersion:current.data?.currentVersion || 0,items:[{productId:activity.products[0],quantity:n+20}]}});
  assert.equal(result.status,200);assert.equal(result.data.activityCustomerId,user.id);
  assert([100,101].includes(Number(result.data.items[0].casePrice)));
  assert.equal(Number(result.data.totalAmount),Number(result.data.items[0].casePrice)*(n+20));
  assert.deepEqual(result.data.versions,[]);assert.deepEqual(result.data.operations,[]);
 }
});
try {
 const results=await Promise.allSettled([...writers,(async()=>{for(const price of [101,100,101,100])await changePrice(price);})()]);
 for(const r of results)assert.equal(r.status,'fulfilled',r.reason?.message);
}finally {await changePrice(100);}
assert.equal(sql(historySql),historyBefore,'Old history must remain unchanged during repricing');
assert.equal(Number(sql(`SELECT COUNT(*) FROM order_item i JOIN customer_order o ON o.id=i.order_id WHERE o.activity_id=${activity.id} AND i.activity_product_id=${activity.products[0]} AND i.case_price<>100;`).trim()),0);
const user=users[0], path=`/h5/activities/${user.code}/order`;
const full=(await request(path,{session:user})).data, light=(await request(path+'?includeHistory=false',{session:user})).data;
assert(full.versions.length>=5);assert.deepEqual(light,{...full,versions:[],operations:[]});
const withdrawn=await request(path+'/withdraw?includeHistory=false',{method:'POST',session:user,key:randomUUID(),body:{expectedVersion:full.currentVersion}});
assert.equal(withdrawn.status,200);assert.equal(withdrawn.data.status,'WITHDRAWN');
assert.deepEqual(withdrawn.data.versions,[]);assert.deepEqual(withdrawn.data.operations,[]);
const resubmitted=await request(path+'?includeHistory=false',{method:'PUT',session:user,key:randomUUID(),body:{expectedVersion:full.currentVersion,items:full.items.map(i=>({productId:i.productId,quantity:i.quantity}))}});
assert.equal(resubmitted.status,200);assert.equal(resubmitted.data.currentVersion,full.currentVersion+1);

// Use only the secondary LOAD activity. Restore its fixture status after the close race.
const secondary=fixture.activities[1],adminPath=`/admin/activities/${secondary.id}`;
const before=(await request(adminPath,{session})).data;assert.equal(before.status,'ACTIVE');
const candidates=fixture.customers.filter(c=>c.code===secondary.code).slice(10,30);
const prepared=await Promise.all(candidates.map(async c=>{
 const current=(await request(`/h5/activities/${c.code}/order`,{session:c})).data;
 return {c,version:current?.currentVersion || 0,quantity:(current?.totalQuantity || 3)+1};
}));
let results;
try {
 results=await Promise.all(prepared.map(({c,version,quantity})=>request(`/h5/activities/${c.code}/order`,{method:'PUT',session:c,key:randomUUID(),body:{expectedVersion:version,items:[{productId:secondary.products[0],quantity}]}})).concat([
   request(adminPath+'/close',{method:'POST',session,headers:{'If-Match':String(before.version)},body:{reason:'LOAD close/submit concurrency regression'}})
 ]));
 assert.equal(results.at(-1).status,200);
 for(const r of results.slice(0,-1))assert([200,409].includes(r.status),r.code);
 for(const [i,r] of results.slice(0,-1).entries())if(r.status===200)assert.equal(r.data.currentVersion,prepared[i].version+1);
 const after=await request(`/h5/activities/${secondary.code}/order`,{method:'PUT',session:candidates[0],key:randomUUID(),body:{expectedVersion:0,items:[{productId:secondary.products[0],quantity:5}]}});
 assert.equal(after.status,409);assert.equal(after.code,'ACTIVITY_NOT_WRITABLE');
 assert.equal(Number(sql(`SELECT COUNT(*) FROM customer_order o JOIN activity a ON a.id=o.activity_id WHERE a.id=${secondary.id} AND o.last_submitted_at>a.closed_at;`).trim()),0);
}finally {
 sql(`UPDATE activity SET status='ACTIVE',closed_at=NULL WHERE id=${secondary.id} AND activity_code='LOAD-2';`);
}
const report={timestamp:new Date().toISOString(),concurrentPricing:'50 writes and 4 price changes passed',historicalPrices:'unchanged',lightweightResponse:'same current fields; history omitted',lightweightWithdrawal:'withdraw and resubmit passed',closeRace:results?.slice(0,-1).map(r=>r.status),postCloseWrite:'rejected'};
save(`optimization-checks-${Date.now()}.json`,report);console.log(report);
