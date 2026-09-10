// Read-only verification around recreating only the isolated backend. No business requests are written.
import assert from 'node:assert/strict';
import {guard,sql,docker,compose,base,save} from './lib.mjs';
guard();
assert(['true','false'].includes(process.env.LOAD_H5_WARMUP_ENABLED || 'true'));
const snapshot=()=>sql(`SELECT COUNT(*),COALESCE(SUM(total_amount),0),COALESCE(SUM(total_quantity),0) FROM customer_order;
SELECT COUNT(*) FROM order_version; SELECT COUNT(*) FROM h5_session; SELECT COUNT(*) FROM audit_log;
SELECT COUNT(*) FROM h5_order_draft; SELECT COUNT(*) FROM domain_event_outbox;`);
const before=snapshot(),started=Date.now(),run=`startup-${started}`,observations=[];
docker([...compose,'up','-d','--no-deps','--no-build','--force-recreate','backend']);
let ready=false;
while(Date.now()-started<90000) {
  const states=await Promise.all(['/actuator/health/readiness','/h5/activities/LOAD-1/products'].map(async path=>{
    try {const r=await fetch(base+path,{signal:AbortSignal.timeout(1000)});await r.arrayBuffer();return r.status;}
    catch{return null;}
  }));
  observations.push({elapsedMs:Date.now()-started,health:states[0],business:states[1]});
  if(states[0]===200) {ready=true;break;}
  await new Promise(resolve=>setTimeout(resolve,200));
}
const logs=docker([...compose,'logs','--no-color','--since',new Date(started).toISOString(),'backend'])
  .split('\n').filter(line=>line.includes('Read-only H5 warmup') || line.includes('Started OrderShow'));
const unchanged=snapshot()===before;
const result={run,warmupEnabled:process.env.LOAD_H5_WARMUP_ENABLED!=='false',ready,recreateToReadyMs:Date.now()-started,
  businessDataUnchanged:unchanged,observations,logs};
save(`${run}.json`,result);console.log(result);
assert(ready,'Backend failed to become ready');assert(unchanged,'Startup changed domain/session/audit counts');
