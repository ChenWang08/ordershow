// Synthetic outbox events only. Domain orders and amounts must remain unchanged.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {base,compose,guard,sql,save,request} from './lib.mjs';
guard();
const fixture=JSON.parse(readFileSync('outputs/load/fixture.json','utf8'));
const count=Number(process.argv[2] || 12000), connections=Number(process.argv[3] || 100);
assert(Number.isInteger(count) && count>=2 && count<=16000 && count%2===0);
assert(Number.isInteger(connections) && connections>=2 && connections<=100 && connections%2===0);
const run=`notify-${Date.now().toString(36)}`;
const activities=fixture.activities;
assert(activities.every(a=>Number.isSafeInteger(a.id)));
assert.equal(Number(sql("SELECT COUNT(*) FROM domain_event_outbox WHERE status='PENDING' AND available_at<=UTC_TIMESTAMP(3);").trim()),0,'Wait for existing due events to drain before an isolated burst');
const before=sql('SELECT COUNT(*),SUM(total_amount),SUM(total_quantity) FROM customer_order; SELECT COUNT(*) FROM order_version;');
const snapshots=await Promise.all(activities.map(a=>request(`/screen/activities/${a.code}/dashboard`).then(r=>{assert.equal(r.status,200);return r.data.dashboard.totals;})));
const controllers=[],tasks=[],observations=[];
const started=Date.now();
let origin=0,futureId;
function execute(query) {
 return new Promise((resolve,reject)=>{
  const p=spawn('docker',[...compose,'exec','-T','-e','MYSQL_PWD=load_only_password','mysql','mysql','-uorder_show_load','--batch','--skip-column-names','order_show_load'],{windowsHide:true});
  let stdout='',stderr='';p.stdout.on('data',b=>{stdout+=b;});p.stderr.on('data',b=>{stderr+=b;});
  p.on('error',reject);p.on('close',code=>code===0?resolve(stdout):reject(Error(stderr)));
  p.stdin.on('error',reject);p.stdin.end(query);
 });
}
try {
 for(let n=0;n<connections;n++) {
  const a=activities[n%2],controller=new AbortController();controllers.push(controller);
  const response=await fetch(`${base}/screen/activities/${a.code}/events`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
  assert.equal(response.status,200);const reader=response.body.getReader();
  tasks.push((async()=>{
   const decoder=new TextDecoder();let buffer='',seen=0,frames=0;
   while(true) {
    const chunk=await reader.read();if(chunk.done)throw Error('SSE closed before burst completed');
    buffer+=decoder.decode(chunk.value,{stream:true}).replace(/\r/g,'');let end;
    while((end=buffer.indexOf('\n\n'))>=0) {
     const event=buffer.slice(0,end);buffer=buffer.slice(end+2);
     if(!event.includes('event:invalidate'))continue;
     const line=event.split('\n').find(l=>l.startsWith('data:'));if(!line)continue;
     const data=JSON.parse(line.slice(5));if(data.eventType!=='LOAD_BACKLOG_TEST')continue;
     assert.equal(data.activityId,a.id,'Events must not cross activity streams');assert.equal(data.scope,'ACTIVITY');
     seen+=data.eventCount;frames++;
     if(seen>=count/2) {
      assert.equal(seen,count/2);
      const receivedAt=Date.now();let refreshedAt;
      // Ten screens also reload their real dashboard API after the final notification.
      if(n<10) {
       const refreshed=await request(`/screen/activities/${a.code}/dashboard`);assert.equal(refreshed.status,200);
       assert.equal(Number(refreshed.data.dashboard.totals.total_amount),Number(snapshots[n%2].total_amount));
       assert.equal(Number(refreshed.data.dashboard.totals.order_count),Number(snapshots[n%2].order_count));
       refreshedAt=Date.now();
      }
      observations.push({activity:a.code,frames,seen,receivedAt,refreshedAt});return;
     }
    }
   }
  })());tasks.at(-1).catch(()=>{});
 }
 const values=Array.from({length:count},(_,i)=>`(${activities[i%2].id},'LOAD_BACKLOG_TEST','${run}-${i}','LOAD_BACKLOG_TEST','{}',@stamp,@stamp)`);
 const result=await execute(`START TRANSACTION; SET @stamp=UTC_TIMESTAMP(3);
 INSERT INTO domain_event_outbox(activity_id,aggregate_type,aggregate_id,event_type,payload_json,available_at,created_at)
 VALUES (${activities[0].id},'LOAD_BACKLOG_TEST','${run}-future','LOAD_BACKLOG_TEST','{}',@stamp+INTERVAL 1 HOUR,@stamp);
 SET @future=LAST_INSERT_ID();
 INSERT INTO domain_event_outbox(activity_id,aggregate_type,aggregate_id,event_type,payload_json,available_at,created_at) VALUES ${values.join(',')};
 COMMIT; SELECT @future,DATE_FORMAT(@stamp,'%Y-%m-%dT%H:%i:%s.%fZ');`);
 const columns=result.trim().split('\t');futureId=Number(columns[0]);origin=Date.parse(columns[1]);
 assert(Number.isSafeInteger(futureId) && Number.isFinite(origin));
 await Promise.all(tasks);
 const rows=sql(`SELECT status,COUNT(*),MAX(TIMESTAMPDIFF(MICROSECOND,created_at,published_at))/1000 FROM domain_event_outbox WHERE aggregate_type='LOAD_BACKLOG_TEST' AND aggregate_id LIKE '${run}-%' AND id<>${futureId} GROUP BY status;`).trim().split('\t');
 assert.equal(rows[0],'PUBLISHED');assert.equal(Number(rows[1]),count);
 assert.equal(sql(`SELECT status FROM domain_event_outbox WHERE id=${futureId};`).trim(),'PENDING','A lower-ID future event must not be acknowledged');
 assert.equal(sql('SELECT COUNT(*),SUM(total_amount),SUM(total_quantity) FROM customer_order; SELECT COUNT(*) FROM order_version;'),before);
 const latencies=observations.map(o=>o.receivedAt-origin).sort((a,b)=>a-b);
 const refresh=observations.filter(o=>o.refreshedAt).map(o=>o.refreshedAt-origin);
 const report={run,events:count,connections,perActivity:count/2,notificationP95Ms:latencies[Math.ceil(latencies.length*.95)-1],notificationMaxMs:latencies.at(-1),dashboardRefreshMaxMs:Math.max(...refresh),refreshedScreens:refresh.length,databasePublishMaxMs:Number(rows[2]),framesPerConnection:[...new Set(observations.map(o=>o.frames))],futureEventPreserved:true,domainDataUnchanged:true,elapsedMs:Date.now()-started,measurement:'server event creation to client receipt/API refresh, including fixture transaction time'};
 save(`${run}.json`,report);console.log(report);
 assert(report.notificationMaxMs<=3000,'Notification latency exceeds 3s');
 assert(report.dashboardRefreshMaxMs<=3000,'Ten-screen API refresh exceeds 3s');
} finally {
 for(const c of controllers)c.abort();
 if(Number.isSafeInteger(futureId))sql(`DELETE FROM domain_event_outbox WHERE id=${futureId} AND aggregate_type='LOAD_BACKLOG_TEST' AND aggregate_id='${run}-future';`);
}
