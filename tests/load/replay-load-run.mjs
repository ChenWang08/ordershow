// Reconcile interrupted client responses by replaying the original idempotent requests in the isolated DB.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sql,request,save,guard} from './lib.mjs';
guard();
const run=process.argv[2];assert(/^mixed-\d+-\d+$/.test(run || ''));
const fixture=JSON.parse(readFileSync('outputs/load/fixture.json','utf8'));
const customers=new Map(fixture.customers.map(c=>[c.id,c]));
const rows=sql(`SELECT v.id,v.request_idempotency_key,o.activity_customer_id,v.version_no-1,i.activity_product_id,i.quantity FROM order_version v JOIN customer_order o ON o.id=v.order_id JOIN order_version_item i ON i.order_version_id=v.id WHERE v.request_idempotency_key LIKE '${run}-%' ORDER BY v.id,i.line_no;`).trim();
assert(rows,'No committed requests for this run');
const requests=new Map();
for(const line of rows.split('\n')) {
 const [id,key,customerId,version,productId,quantity]=line.split('\t');
 if(!requests.has(id))requests.set(id,{key,user:customers.get(Number(customerId)),body:{expectedVersion:Number(version),items:[]}});
 requests.get(id).body.items.push({productId:Number(productId),quantity:Number(quantity)});
}
const before=sql('SELECT COUNT(*) FROM customer_order; SELECT COUNT(*) FROM order_version; SELECT SUM(total_amount),SUM(total_quantity) FROM customer_order;');
for(const {key,user,body} of requests.values()) {
 assert(user);const result=await request(`/h5/activities/${user.code}/order?includeHistory=false`,{method:'PUT',session:user,key,body});
 assert.equal(result.status,200);assert.equal(result.data.activityCustomerId,user.id);assert(result.data.currentVersion>=body.expectedVersion+1);
}
assert.equal(sql('SELECT COUNT(*) FROM customer_order; SELECT COUNT(*) FROM order_version; SELECT SUM(total_amount),SUM(total_quantity) FROM customer_order;'),before);
const summary=JSON.parse(readFileSync(`outputs/load/${run}.json`,'utf8'));
const result={run,acknowledged:summary.metrics.order_commits.values.count,committed:requests.size,replayed:requests.size,additionalVersions:0,additionalOrders:0,amountsUnchanged:true};
save(`${run}-replay-verification.json`,result);console.log(result);
