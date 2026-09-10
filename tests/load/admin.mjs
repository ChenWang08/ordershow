import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { base, request, save, guard, sql } from './lib.mjs';
guard();
let login=await request('/admin/auth/login',{method:'POST',body:{username:'load_admin',password:'LoadOnlyPassword123!'}});
if(login.status!==200) login=await request('/admin/auth/login',{method:'POST',body:{username:'load_admin',password:'LoadOnlyChanged123!'}});
assert.equal(login.status,200);
const session=login.session;
if(login.data.mustChangePassword) assert.equal((await request('/admin/auth/change-password',{method:'POST',session,body:{currentPassword:'LoadOnlyPassword123!',newPassword:'LoadOnlyChanged123!'}})).status,200);
const fixture=JSON.parse(readFileSync('outputs/load/fixture.json','utf8'));
const activity=fixture.activities[0], root=`/admin/activities/${activity.id}`;
const timings=[];
for(const path of ['/orders?page=1&size=20','/orders?keyword=LOAD&page=1&size=20','/orders?status=SUBMITTED&page=1&size=20']) {
 const samples=[];
 for(let n=0;n<10;n++) {const start=performance.now();assert.equal((await request(root+path,{session})).status,200);samples.push(performance.now()-start);}
 samples.sort((a,b)=>a-b);timings.push({path,p95Ms:samples[9],samples});
}
const start=performance.now();
const exported=await fetch(base+root+'/orders/export',{headers:{Cookie:session.cookie},signal:AbortSignal.timeout(60000),redirect:'error'});
assert.equal(exported.status,200); const file=await exported.arrayBuffer();
assert(file.byteLength>100 && new Uint8Array(file)[0]===80 && new Uint8Array(file)[1]===75);
const exportResult={ms:performance.now()-start,bytes:file.byteLength};
const product=(await request(root+'/products',{session})).data.find(p=>p.id===activity.products[0]);
const snapshotSql=`SELECT COALESCE(SUM(total_amount),0) FROM customer_order WHERE activity_id=${activity.id}; SELECT COUNT(*) FROM order_version WHERE activity_id=${activity.id}; SELECT SUM(i.line_amount),SUM(i.case_price),SUM(i.quantity) FROM order_version_item i JOIN order_version v ON v.id=i.order_version_id WHERE v.activity_id=${activity.id};`;
const before=sql(snapshotSql).trim().split('\n');
const expectedDelta=Number(sql(`SELECT COALESCE(SUM(quantity),0) FROM order_item WHERE activity_product_id=${product.id};`).trim());
const priceStart=performance.now();
const changed=await request(root+`/products/${product.id}`,{method:'PATCH',session,headers:{'If-Match':String(product.version)},body:{casePrice:101,casePriceSet:true,reason:'LOAD performance verification'}});
assert.equal(changed.status,200);
const priceMs=performance.now()-priceStart;
const after=sql(snapshotSql).trim().split('\n');
// Restore first, even if the comparison below exposes a product regression.
assert.equal((await request(root+`/products/${product.id}`,{method:'PATCH',session,headers:{'If-Match':String(changed.data.version)},body:{casePrice:100,casePriceSet:true,reason:'LOAD restore fixture price'}})).status,200);
assert.equal(Number(after[0])-Number(before[0]),expectedDelta);assert.equal(after[1],before[1]);assert.equal(after[2],before[2]);
const report={timestamp:new Date().toISOString(),timings,export:exportResult,priceSync:{ms:priceMs,expectedDelta,historyUnchanged:true},orders:Number(sql(`SELECT COUNT(*) FROM customer_order WHERE activity_id=${activity.id};`).trim())};
save(`admin-${Date.now()}.json`,report);console.log(report);
