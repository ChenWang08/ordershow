import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { base, request, save, guard, sql, resultsRoot } from './lib.mjs';
guard();
const fixture=JSON.parse(readFileSync(`${resultsRoot}/fixture.json`,'utf8'));
const count=Number(process.argv[2] || 10);
assert(Number.isInteger(count) && count>0 && count<=100);
const user=fixture.customers[2401], path='/h5/activities/LOAD-1/order';
const controllers=[], tasks=[], times=[];
let expectedId, started, baselineEvent=0;
try {
 for(let n=0;n<count;n++) {
  const controller=new AbortController();controllers.push(controller);
  const response=await fetch(base+'/screen/activities/LOAD-1/events',{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
  assert.equal(response.status,200);
  const reader=response.body.getReader();
  const decoder=new TextDecoder();let buffer='';
  tasks.push((async()=>{
    while(true) {
      const {value,done}=await reader.read(); if(done) throw Error('SSE ended early');
      buffer+=decoder.decode(value,{stream:true}).replace(/\r/g,'');
      let end;
      while((end=buffer.indexOf('\n\n'))>=0) {
        const event=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(event.includes('event:invalidate') && expectedId) {
          const line=event.split('\n').find(s=>s.startsWith('data:'));
          if(line) {
            const data=JSON.parse(line.slice(5));
            // This isolated probe is the only writer after baselineEvent. New publishers invalidate the entire activity.
            const version=data.scope==='ACTIVITY' && Number(data.activityId)===user.activityId ? data.version
              : String(data.aggregateId)===String(expectedId) ? data.version : 0;
            if(Number(version)>baselineEvent) {times.push(performance.now()-started);return;}
          }
        }
      }
    }
  })());
  tasks.at(-1).catch(()=>{});
 }
 const current=(await request(path,{session:user})).data;
 // Create the order first if absent, then wait for its prior outbox to drain.
 if(!current) {
  assert.equal((await request(path,{method:'PUT',session:user,key:randomUUID(),body:{expectedVersion:0,items:[{productId:fixture.activities[0].products[0],quantity:1}]}})).status,200);
 }
 await new Promise(r=>setTimeout(r,3000));
 const order=(await request(path,{session:user})).data;
 baselineEvent=Number(sql('SELECT COALESCE(MAX(id),0) FROM domain_event_outbox;').trim());
 expectedId=order.id;started=performance.now();
 const updated=await request(path,{method:'PUT',session:user,key:randomUUID(),body:{expectedVersion:order.currentVersion,items:[{productId:fixture.activities[0].products[0],quantity:order.items[0].quantity+1}]}});
 assert.equal(updated.status,200);
 await Promise.all(tasks);
 times.sort((a,b)=>a-b);
 const report={timestamp:new Date().toISOString(),connections:count,notifications:times.length,p95Ms:times[Math.ceil(times.length*.95)-1],maxMs:times.at(-1),measurement:'request start to matching invalidate event; browser refresh not included'};
 save(`sse-${count}-${Date.now()}.json`,report);console.log(report);
 assert(report.maxMs<=3000,'SSE latency exceeded 3 seconds');
} finally {for(const c of controllers)c.abort();}
