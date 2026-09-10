// Read-only SSE observer: safe to run alongside the existing write-load runner without changing its version delta.
import assert from 'node:assert/strict';
import {base,guard,save} from './lib.mjs';
guard();
const seconds=Number(process.argv[2] || 330),count=Number(process.argv[3] || 100);
assert(Number.isInteger(seconds) && seconds>=10 && seconds<=600);
assert(Number.isInteger(count) && count>=1 && count<=100);
const run=`sse-observe-${Date.now()}`,controller=new AbortController(),start=Date.now();
const frames=Array(count).fill(0),delays=[],failures=[];
let coveredEvents=0,ready=0;
const deadline=setTimeout(()=>controller.abort(),seconds*1000);
const report=()=>{
 const sorted=[...delays].sort((a,b)=>a-b);
 return {run,seconds:(Date.now()-start)/1000,connections:count,ready,frames:frames.reduce((s,n)=>s+n,0),minimumFramesPerConnection:Math.min(...frames),coveredEventsOnFirstConnection:coveredEvents,lagP95Ms:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:null,lagMaxMs:sorted.at(-1)??null,failures};
};
const progress=setInterval(()=>{save(`${run}-progress.json`,report());console.log('SSE OBSERVER',report());},30000);
try {
 await Promise.all(Array.from({length:count},async(_,index)=>{
  try {
   const response=await fetch(`${base}/screen/activities/LOAD-1/events`,{signal:controller.signal});assert.equal(response.status,200);
   ready++;if(ready===count){save(`${run}-progress.json`,report());console.log('SSE OBSERVER READY',run,ready);}
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   while(!controller.signal.aborted) {
    const chunk=await reader.read();if(chunk.done)throw Error('Stream ended unexpectedly');
    buffer+=decoder.decode(chunk.value,{stream:true}).replace(/\r/g,'');assert(buffer.length<1048576);
    let end;
    while((end=buffer.indexOf('\n\n'))>=0) {
     const event=buffer.slice(0,end);buffer=buffer.slice(end+2);if(!event.includes('event:invalidate'))continue;
     const data=JSON.parse(event.split('\n').find(l=>l.startsWith('data:')).slice(5));
     assert.equal(data.scope,'ACTIVITY');assert.equal(data.activityId,101);
     const created=Date.parse(data.oldestEventAt);assert(Number.isFinite(created));
     frames[index]++;delays.push(Math.max(0,Date.now()-created));if(index===0)coveredEvents+=data.eventCount;
    }
   }
  }catch(error){if(!controller.signal.aborted)failures.push({index,message:error.message});}
 }));
} finally {controller.abort();clearTimeout(deadline);clearInterval(progress);}
const result=report();save(`${run}.json`,result);console.log(result);
assert.equal(failures.length,0);assert(result.minimumFramesPerConnection>0);assert(result.lagMaxMs<=3000,'Observed event delivery exceeded 3 seconds');
