import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as settle} from 'node:timers/promises';
import {loadModule} from './helpers/load-ts-module.mjs';
const {createRefreshQueue}=loadModule('app/features/screens/refresh-queue.ts');
function clock() {
 let now=0;const timers=new Set();
 return {now:()=>now,schedule(callback,delay){const timer={at:now+delay,callback};timers.add(timer);return()=>timers.delete(timer);},
  async advance(value){now=value;for(const timer of [...timers])if(timer.at<=now){timers.delete(timer);timer.callback();}await settle();},
  get timerCount(){return timers.size;}};
}

test('a burst while a refresh is in flight produces exactly one trailing refresh',async()=>{
 let count=0,active=0,maxActive=0;const release=[];
 const queue=createRefreshQueue(async()=>{count++;active++;maxActive=Math.max(active,maxActive);await new Promise(r=>release.push(r));active--;});
 const initial=queue.refresh();await settle();
 for(let n=0;n<1000;n++)queue.refresh();
 assert.equal(count,1);release.shift()();await settle();assert.equal(count,2);
 release.shift()();await initial;assert.equal(count,2);assert.equal(maxActive,1);
 await settle();assert.equal(count,2);
});

test('disposing drops trailing work and future refreshes',async()=>{
 let release,count=0;
 const queue=createRefreshQueue(async()=>{count++;await new Promise(r=>{release=r;});});
 const initial=queue.refresh();await settle();queue.refresh();queue.dispose();release();await initial;
 await queue.refresh();assert.equal(count,1);
});

test('a failed task does not permanently block a subsequent refresh',async()=>{
 let count=0;
 const queue=createRefreshQueue(async()=>{if(++count===1)throw Error('failed');});
 await assert.rejects(queue.refresh(),/failed/);await queue.refresh();assert.equal(count,2);
});


test('polling and ACK recovery share one read per fifteen seconds',async()=>{
 let now=0,count=0;
 const queue=createRefreshQueue(async()=>{count++;},()=>now,()=>()=>{});
 await queue.refresh();
 now=14999;await queue.periodic();await queue.invalidate('{"reason":"RECOVERY"}');assert.equal(count,1);
 now=15000;await queue.periodic();await queue.invalidate('{"reason":"RECOVERY"}');assert.equal(count,2);
 now=29999;await queue.invalidate('{"reason":"RECOVERY"}');assert.equal(count,2);
 now=30000;await queue.invalidate('{"reason":"RECOVERY"}');await queue.periodic();assert.equal(count,3);
});

test('a recovery during an in-flight poll does not create a duplicate trailing read',async()=>{
 let now=0,count=0;const release=[];
 const queue=createRefreshQueue(async()=>{count++;await new Promise(r=>release.push(r));},()=>now,()=>()=>{});
 const first=queue.refresh();await settle();release.shift()();await first;
 now=15000;const poll=queue.periodic();await settle();
 now=16000;void queue.invalidate('{"reason":"RECOVERY"}');
 release.shift()();await poll;assert.equal(count,2);
});

test('real changes arriving during a read always retain a trailing read, including lower event IDs',async()=>{
 let count=0;const release=[];
 const queue=createRefreshQueue(async()=>{count++;await new Promise(r=>release.push(r));},()=>0,()=>()=>{});
 const first=queue.refresh();await settle();
 void queue.invalidate('{"version":100}');void queue.invalidate('{"version":3}');
 release.shift()();await settle();assert.equal(count,2);
 release.shift()();await first;
});

test('a read lasting over fifteen seconds retains the recovery check',async()=>{
 let now=0,count=0;const release=[];
 const queue=createRefreshQueue(async()=>{count++;await new Promise(r=>release.push(r));},()=>now,()=>()=>{});
 const first=queue.refresh();await settle();
 now=15000;void queue.periodic();void queue.invalidate('{"reason":"RECOVERY"}');
 release.shift()();await settle();assert.equal(count,2);
 release.shift()();await first;
});

test('failed periodic reads retry at the next deadline and unknown notifications force a read',async()=>{
 let now=0,count=0;
 const queue=createRefreshQueue(async()=>{if(++count===1)throw Error('offline');},()=>now,()=>()=>{});
 await assert.rejects(queue.periodic(),/offline/);
 now=15000;await queue.periodic();assert.equal(count,2);
 await queue.invalidate('invalid json');await queue.invalidate();assert.equal(count,4);
 queue.dispose();now=30000;await queue.periodic();assert.equal(count,4);
});


test('a real change between ticks never delays periodic recovery beyond its fifteen-second deadline',async()=>{
 const time=clock();const starts=[];
 const queue=createRefreshQueue(async()=>{starts.push(time.now());},time.now,time.schedule);
 await queue.refresh();
 await time.advance(7000);await queue.invalidate('{"version":9}');
 await time.advance(15000);await queue.periodic();assert.deepEqual(starts,[0,7000]);
 await time.advance(20000);await queue.invalidate('{"reason":"RECOVERY"}');assert.equal(time.timerCount,1);
 await time.advance(22000);assert.deepEqual(starts,[0,7000,22000]);
 await time.advance(30000);await queue.periodic();
 await time.advance(37000);assert.deepEqual(starts,[0,7000,22000,37000]);
 queue.dispose();
});

test('new real changes reschedule pending recovery and cleanup cancels the deadline',async()=>{
 const time=clock();const starts=[];
 const queue=createRefreshQueue(async()=>{starts.push(time.now());},time.now,time.schedule);
 await queue.refresh();await time.advance(7000);await queue.periodic();
 await time.advance(12000);await queue.refresh();
 await time.advance(15000);assert.deepEqual(starts,[0,12000]);assert.equal(time.timerCount,1);
 await time.advance(27000);assert.deepEqual(starts,[0,12000,27000]);
 await time.advance(28000);await queue.periodic();assert.equal(time.timerCount,1);
 queue.dispose();assert.equal(time.timerCount,0);
 await time.advance(50000);assert.deepEqual(starts,[0,12000,27000]);
});
