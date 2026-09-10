import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as settle} from 'node:timers/promises';
import {loadModule} from './helpers/load-ts-module.mjs';
const {createRefreshQueue}=loadModule('app/features/screens/refresh-queue.ts');

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
