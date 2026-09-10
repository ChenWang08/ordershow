import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { request, sql, save, resultsRoot } from './lib.mjs';
const fixture=JSON.parse(readFileSync(`${resultsRoot}/fixture.json`,'utf8'));
const user=fixture.customers[2400], path=`/h5/activities/${user.code}/order`;
const call=(body,key)=>request(path,{method:'PUT',body,session:user,key});
const before=(await request(path,{session:user})).data;
const version=before?.currentVersion || 0;
const body={expectedVersion:version,items:[{productId:fixture.activities[0].products[0],quantity:17+version}]};
const key=randomUUID();
const replay=await Promise.all(Array.from({length:10},()=>call(body,key)));
assert(replay.every(r=>r.status===200 && r.data.currentVersion===version+1));
const conflict=await call({...body,items:[{...body.items[0],quantity:99}]},key);
assert.equal(conflict.status,409); assert.equal(conflict.code,'IDEMPOTENCY_KEY_REUSED');
const races=await Promise.all(Array.from({length:10},(_,i)=>call({expectedVersion:version+1,items:[{productId:body.items[0].productId,quantity:100+i}]},randomUUID())));
assert.equal(races.filter(r=>r.status===200).length,1);
assert(races.filter(r=>r.status!==200).every(r=>r.status===409 && r.code==='ORDER_VERSION_CONFLICT'));
const foreign=await request('/h5/activities/LOAD-2/order',{session:user});
assert([403,404].includes(foreign.status));
const login=await request('/public/activities/LOAD-1/verify-phone',{method:'POST',body:{phone:user.phone,customerType:'SPECIAL'}});
assert.equal(login.status,200);
assert.equal((await request(path,{session:login.session})).data.activityCustomerId,user.id);
const checks={
  wrongTotals:`SELECT COUNT(*) FROM customer_order o LEFT JOIN (SELECT order_id,SUM(line_amount) amount,SUM(quantity) quantity FROM order_item GROUP BY order_id) i ON i.order_id=o.id WHERE i.order_id IS NULL OR o.total_amount<>i.amount OR o.total_quantity<>i.quantity;`,
  wrongVersions:`SELECT COUNT(*) FROM customer_order o LEFT JOIN (SELECT order_id,MAX(version_no) latest,COUNT(*) n FROM order_version GROUP BY order_id) v ON v.order_id=o.id WHERE v.order_id IS NULL OR o.current_version_no<>v.latest OR v.latest<>v.n;`,
  wrongLines:`SELECT COUNT(*) FROM order_item WHERE line_amount<>ROUND(case_price*quantity,2);`,
  unfinishedIdempotency:`SELECT COUNT(*) FROM api_idempotency WHERE status<>'COMPLETED';`
};
const results={timestamp:new Date().toISOString(),parallelReplay:10,parallelModify:{success:1,conflict:9},crossActivity:'passed',phoneLogin:'passed'};
for(const [name,query] of Object.entries(checks)) {results[name]=Number(sql(query).trim());assert.equal(results[name],0,name);}
results.counts=sql('SELECT COUNT(*),COALESCE(SUM(total_amount),0) FROM customer_order; SELECT COUNT(*) FROM order_version;').trim();
results.dashboard=[];
for(const activity of fixture.activities) {
 const expected=sql(`SELECT COUNT(*),COALESCE(SUM(total_amount),0) FROM customer_order WHERE activity_id=${activity.id} AND status='SUBMITTED';`).trim().split('\t').map(Number);
 const dashboard=await request(`/screen/activities/${activity.code}/dashboard`);
 assert.equal(dashboard.status,200);
 const totals=dashboard.data.dashboard.totals;
 assert.equal(Number(totals.order_count),expected[0]);assert.equal(Number(totals.total_amount),expected[1]);
 results.dashboard.push({activity:activity.code,orders:expected[0],amount:expected[1],matched:true});
}
save(`verify-${Date.now()}.json`,results); console.log(results);
