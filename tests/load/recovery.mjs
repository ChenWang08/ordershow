// Explicit isolated-service restart test. Run separately from capacity measurements.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {base,compose,docker,guard,request,save} from './lib.mjs';
guard();
const service=process.argv[2];assert(['redis','backend'].includes(service));
const fixture=JSON.parse(readFileSync('outputs/load/fixture.json','utf8'));
const user=fixture.customers[2402],path=`/h5/activities/${user.code}/order`;
const previous=(await request(path,{session:user})).data;
const body={expectedVersion:previous?.currentVersion || 0,items:[{productId:fixture.activities[0].products[0],quantity:(previous?.totalQuantity || 0)+1}]};
const key=randomUUID();
const before=await request(path,{method:'PUT',session:user,key,body});assert.equal(before.status,200);
const started=Date.now();
docker([...compose,'restart',service]);
let ready=false;
while(Date.now()-started<120000) {
 try {const r=await fetch(base+'/actuator/health',{signal:AbortSignal.timeout(2000)});if((await r.json()).status==='UP'){ready=true;break;}}catch{/* Restart temporarily unavailable. */}
 await new Promise(r=>setTimeout(r,1000));
}
assert(ready,'Service failed to recover within 120s');
const replay=await request(path,{method:'PUT',session:user,key,body});assert.equal(replay.status,200);
assert.equal(replay.data.id,before.data.id);assert.equal(replay.data.currentVersion,before.data.currentVersion);assert.equal(replay.data.totalAmount,before.data.totalAmount);
const report={timestamp:new Date().toISOString(),service,recoveryMs:Date.now()-started,idempotentReplay:true,scope:'Restart after committed order; does not test in-flight rollback or lottery locks'};
save(`recovery-${service}-${Date.now()}.json`,report);console.log(report);
