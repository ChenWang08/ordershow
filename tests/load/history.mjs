// Populate first orders through real H5 APIs, with bounded concurrency; run outside measured load.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {request,save,guard} from './lib.mjs';
guard();
const fixture=JSON.parse(readFileSync('outputs/load/fixture.json','utf8'));
const count=Number(process.argv[2] || 1000);
assert(Number.isInteger(count) && count>0 && count<=2000);
let next=0,created=0,existing=0;
const start=Date.now();
await Promise.all(Array.from({length:5},async()=>{
 while(next<count) {
  const user=fixture.customers[next++], path=`/h5/activities/${user.code}/order`;
  const current=await request(path,{session:user});assert.equal(current.status,200);
  if(current.data) {existing++;continue;}
  const result=await request(path,{method:'PUT',session:user,key:randomUUID(),body:{expectedVersion:0,items:fixture.activities[0].products.slice(0,10).map(productId=>({productId,quantity:2}))}});
  assert.equal(result.status,200);created++;
 }
}));
const report={count,created,existing,ms:Date.now()-start};save(`history-${Date.now()}.json`,report);console.log(report);
