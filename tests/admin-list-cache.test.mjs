import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";
const { createDealerCandidateCache } = loadModule("app/features/admin/dealer-candidate-cache.ts", {}, { Error });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
test("dealer selections share reads for 60 seconds, including an empty whitelist", async () => {
  let time = 0, reads = 0;
  const cache = createDealerCandidateCache(async () => { reads++; return []; }, () => time);
  const [a,b] = await Promise.all([cache.read(), cache.read()]); assert.equal(a,b); assert.equal(reads,1);
  time=59999; await cache.read(); assert.equal(reads,1);
  time=60000; await cache.read(); assert.equal(reads,2);
  cache.clear(); await cache.read(); assert.equal(reads,3);
});
test("whitelist changes abort and reject old in-flight candidates without poisoning the next read", async () => {
  const calls=[];
  const cache=createDealerCandidateCache(signal => { const d=deferred(); calls.push({...d, signal}); return d.promise; });
  const old=cache.read(); const rejected=assert.rejects(old, /客户名单已变化/); await Promise.resolve();
  cache.clear(); assert.equal(calls[0].signal.aborted,true);
  const fresh=cache.read(); await Promise.resolve(); calls[1].resolve([{customerId:2}]); await fresh;
  calls[0].resolve([{customerId:1}]); await rejected;
  assert.equal((await cache.read())[0].customerId,2);
});
test("candidate failures can retry and activity/account caches are independent", async () => {
  let fail=true, reads=0;
  const one=createDealerCandidateCache(async()=>{reads++; if(fail) throw new Error("offline"); return [{customerId:1}];});
  const two=createDealerCandidateCache(async()=>[{customerId:2}]);
  await assert.rejects(one.read(),/offline/); fail=false;
  assert.equal((await one.read())[0].customerId,1); assert.equal(reads,2);
  assert.equal((await two.read())[0].customerId,2); one.clear(); assert.equal((await two.read())[0].customerId,2);
});
test("targeted product state maps scopes without reading full products or scopes and escapes group names", async()=>{
  const calls=[], signal=new AbortController().signal;
  const api=loadModule("app/services/api/products.ts", {"./client": {api:async(path,opts)=>{
    calls.push({path,opts}); return {data:path.includes("editor-state") ? {products:[{id:8}], scopes:{8:{scopes:[{branchName:"A"}],effectiveCount:3,restricted:true}},reviews:[]} : []};
  }}}, {URLSearchParams});
  const result=await api.loadAdminProductEditorState(7,8,["商品 A&B,规格"]);
  assert.equal(calls.length,1); const url=new URL(calls[0].path,"https://test.invalid");
  assert.equal(url.searchParams.get("imageGroupNames"),"商品 A&B,规格");
  assert.equal(result.products[0].effectiveDealerCount,3); assert.equal(result.products[0].dealerScopeRestricted,true);
  await api.loadDealerCandidates(7,signal); assert.equal(calls[1].opts.signal,signal);
});
