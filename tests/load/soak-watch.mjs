// Read-only companion: queue age and dashboard API probes, not a continuous SSE/browser test.
import assert from 'node:assert/strict';
import {base,guard,sql,save} from './lib.mjs';
guard();
const seconds=Number(process.argv[2] || 3660);
assert(Number.isInteger(seconds) && seconds>=30 && seconds<=3720);
const started=Date.now(),run=`soak-watch-${started}`,samples=[];
let error=null;
const report=()=>({run,elapsedSeconds:(Date.now()-started)/1000,requestedSeconds:seconds,error,samples,
  observation:'Read-only queue and dashboard probes every 30s; no continuous SSE connection or browser rendering'});
try {
  while(Date.now()-started<seconds*1000) {
    const [pending,oldestMs,versions]=sql(`SELECT COUNT(*),COALESCE(TIMESTAMPDIFF(MICROSECOND,MIN(created_at),UTC_TIMESTAMP(3))/1000,0)
      FROM domain_event_outbox WHERE status='PENDING' AND available_at<=UTC_TIMESTAMP(3);
      SELECT COUNT(*) FROM order_version;`).trim().split(/\s+/).map(Number);
    const begin=Date.now();
    const response=await fetch(`${base}/screen/activities/LOAD-1/dashboard`,{signal:AbortSignal.timeout(3000)});
    assert.equal(response.status,200);
    const body=await response.json(),screenMs=Date.now()-begin;
    assert(Number.isFinite(Number(body.data?.dashboard?.totals?.order_count)));
    const sample={elapsedSeconds:(Date.now()-started)/1000,pending,oldestMs,versions,screenMs};
    samples.push(sample);save(`${run}-progress.json`,report());
    console.log('WATCH',sample);
    assert(oldestMs>=0,'Negative notification age: check database timezones');
    assert(oldestMs<=3000,'Pending notifications exceed 3 seconds');assert(screenMs<=3000,'Dashboard probe exceeds 3 seconds');
    const remaining=seconds*1000-(Date.now()-started);
    if(remaining>0)await new Promise(resolve=>setTimeout(resolve,Math.min(30000,remaining)));
  }
}catch(failure){error=failure.message;process.exitCode=1;}
save(`${run}.json`,report());console.log('WATCH RESULT',run,{samples:samples.length,error,elapsedSeconds:(Date.now()-started)/1000});
