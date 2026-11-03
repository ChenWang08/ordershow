import assert from "node:assert/strict";
import test from "node:test";
import { hookHarness } from "./helpers/hook-harness.mjs";

function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!element || typeof element !== "object") return [];
  return [element,...nodes(element.props?.children)];
}
function text(element) {
  if (Array.isArray(element)) return element.map(text).join("");
  if (element == null || typeof element === "boolean") return "";
  return typeof element === "object" ? text(element.props?.children) : String(element);
}
function harness(options={}) {
  const calls=[];
  const base={id:1,name:"第一轮",prize:"奖品",winnerCount:10,customerType:"全部客户",scope:"all",minAmount:0,
    qualificationMetric:"AMOUNT",probabilityMode:"ORDER_AMOUNT_WEIGHTED",minBoxCount:0,excludeWinners:false,status:"draft",candidateCount:0};
  const props={active:true,revision:"first",rounds:options.rounds ?? [base,{...base,id:2,name:"第二轮"}],attendanceRows:[],activityId:1,customerCount:100,readOnly:false,
    onChange:rounds=>{props.rounds=rounds;}};
  props.onOrderSaved=rounds=>{props.rounds=rounds;calls.push(["order-saved"]);};
  const api={ApiError:class extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}},apiAssetUrl:url=>url,
    reorderLotteryRounds:async(activity,rule,revision,ids)=>{calls.push(["reorder",activity,rule,revision,[...ids]]);
      if(options.reorder)return options.reorder(activity,rule,revision,ids);
      return {ruleId:rule,revision:revision+1,status:"PUBLISHED",rounds:ids.map((id,index)=>({id,roundNo:index+1,status:props.rounds.find(r=>r.id===id).serverStatus,currentAttemptNo:0}))};},
    loadLotteryRules:async()=>{calls.push(["rules"]);return options.rules();},
    previewLotteryCandidates:async(id,input,signal)=>{calls.push(["preview",id,structuredClone(input),signal]);
      if(options.preview) return options.preview(id,input,signal);
      return {candidateCount:2,configuredWinnerCount:10,actualWinnerCount:2,unawardedCount:8,candidates:[{activityCustomerId:7,dealerFullName:"候选甲",customerType:"GENERAL"}],totalCandidateOrderAmount:20};},
    loadLotteryStatistics:async()=>{calls.push(["statistics"]);return{validWinnerCustomers:3,invalidatedWinnerRecords:0};},
    loadLotteryProductOptions:async()=>{calls.push(["options"]);return[{productLine:"项目A",varietyName:"品种A"},{productLine:"项目A",varietyName:"品种,B"},{productLine:"项目B",varietyName:"品种B"}];},
    createLotteryRule:async(id,body)=>{calls.push(["save",id,structuredClone(body)]);return {id:20,status:"DRAFT",rounds:body.rounds};},
    updateLotteryRule:async(id,ruleId,body)=>{calls.push(["update",id,ruleId,structuredClone(body)]);return {id:ruleId,status:"PUBLISHED",revision:body.expectedRevision+1,rounds:body.rounds.map((round,i)=>({...round,id:body.roundIds[i] ?? 1000+i,roundNo:i+1,status:props.rounds[i].serverStatus}))};},
    publishLotteryRule:async(id,ruleId)=>{calls.push(["publish",id,ruleId]);return {id:20,status:"PUBLISHED",rounds:calls.find(c=>c[0]==="save")[2].rounds.map((r,i)=>({...r,id:100+i,roundNo:i+1,status:"READY"}))};},
  };
  const h=hookHarness("app/features/lottery/Lottery.tsx","LotterySettings",[props],{"../../api":api,"../shared/components/FestivalDecor":{FestivalDecor:()=>null}});
  return {...h,props,calls,options,ApiError:api.ApiError,
    get tree(){return h.model;},
    text:()=>text(h.model),
    find:predicate=>nodes(h.model).find(predicate),
    button:label=>nodes(h.model).find(n=>n.type==="button"&&text(n)===label),
    field:label=>nodes(h.model).find(n=>n.props?.["aria-label"]===label),
    async click(label){const button=nodes(h.model).find(n=>n.type==="button"&&text(n)===label);assert.ok(button,label);button.props.onClick();await h.flush();},
    async patch(patch){props.rounds=props.rounds.map(r=>r.id===1?{...r,...patch}:r);h.render([props]);await h.flush();},
  };
}
test("entry and reentry read saved statistics; editing and switching rounds never calculate candidates",async()=>{
  const h=harness();await h.flush();assert.deepEqual(h.calls.map(c=>c[0]),["statistics"]);assert.match(h.text(),/待试算/);
  await h.patch({winnerCount:4,scope:"ordered",minAmount:100});assert.deepEqual(h.calls.map(c=>c[0]),["statistics","options"]);
  await h.click("02第二轮奖品草稿10 人");
  await h.runTimers();assert.equal(h.calls.filter(c=>c[0]==="preview").length,0);
  assert.equal(h.intervals.size,0);h.props.active=false;h.render([h.props]);h.props.active=true;h.render([h.props]);await h.flush();
  assert.equal(h.calls.filter(c=>c[0]==="preview").length,0);assert.equal(h.calls.filter(c=>c[0]==="statistics").length,2);h.unmount();
});
test("manual calculation queries only the selected round, deduplicates clicks, and viewing names reuses the response",async()=>{
  const h=harness();await h.flush();const click=h.button("手动试算").props.onClick;click();click();await h.flush();
  assert.equal(h.calls.filter(c=>c[0]==="preview").length,1);assert.equal(h.calls.find(c=>c[0]==="preview")[2].roundNo,1);assert.match(h.text(),/候选不足/);
  await h.click("查看候选名单");assert.match(h.text(),/候选甲/);assert.equal(h.calls.filter(c=>c[0]==="preview").length,1);
  assert.equal(h.button("刷新中奖统计"),undefined);assert.equal(h.calls.filter(c=>c[0]==="statistics").length,1);h.unmount();
});
test("project changes reset varieties, restrict available choices and submit tons and exact names",async()=>{
  const h=harness();await h.patch({scope:"ordered"});
  h.field("抽奖项目组").props.onChange({target:{value:"value:项目A"}});await h.flush();
  assert.match(h.text(),/品种A/);assert.match(h.text(),/品种,B/);assert.doesNotMatch(h.text(),/品种B/);
  const variety=h.find(n=>n.type==="label"&&text(n)==="品种,B");nodes(variety).find(n=>n.type==="input").props.onChange({target:{checked:true}});await h.flush();
  await h.patch({qualificationMetric:"TONS",minTons:0.25});await h.click("手动试算");
  const input=h.calls.find(c=>c[0]==="preview")[2];assert.equal(input.productLine,"项目A");assert.deepEqual(input.varieties,["品种,B"]);assert.equal(input.minimumOrderTons,0.25);
  h.field("抽奖项目组").props.onChange({target:{value:"value:项目B"}});await h.flush();
  assert.equal(h.props.rounds[0].varieties,null);assert.match(h.text(),/待试算/);assert.equal(h.button("查看候选名单").props.disabled,true);
  h.unmount();
});

test("choosing another round does not calculate it until explicitly requested",async()=>{
  const h=harness(); await h.flush(); await h.click("手动试算");
  assert.equal(h.calls.filter(c=>c[0]==="preview").length,1);
  await h.click("02第二轮奖品草稿10 人");
  assert.equal(h.calls.filter(c=>c[0]==="preview").length,1);
  assert.match(h.text(),/待试算/);
  await h.click("手动试算");
  assert.deepEqual(h.calls.filter(c=>c[0]==="preview").map(c=>c[2].roundNo),[1,2]);
  assert.equal(h.calls.filter(c=>c[0]==="statistics").length,1); h.unmount();
});
test("obsolete requests are cancelled on edits and navigation, and late names cannot replace the current result",async()=>{
  const pending=[];const h=harness({preview:(_id,_input,signal)=>new Promise(resolve=>pending.push({resolve,signal}))});
  await h.click("手动试算");assert.equal(pending.length,1);
  h.find(n=>n.type==="input"&&n.props.type==="number"&&n.props.value===10).props.onChange({target:{value:"3"}});await h.flush();
  assert.equal(pending[0].signal.aborted,true);assert.match(h.text(),/待试算/);
  pending[0].resolve({candidateCount:999,candidates:[]});await h.flush();assert.doesNotMatch(h.text(),/999/);
  await h.click("手动试算");h.props.active=false;h.render([h.props]);assert.equal(pending[1].signal.aborted,true);h.unmount();
});

test("small tonnage thresholds and candidate values retain all six decimal places",async()=>{
  const h=harness({preview:async()=>({candidateCount:1,actualWinnerCount:1,unawardedCount:0,candidates:[{activityCustomerId:7,dealerFullName:"微量候选",qualifyingOrderTons:0.000001}]})});
  await h.patch({scope:"ordered",qualificationMetric:"TONS",minTons:0.000001});
  assert.match(h.text(),/订货满 0\.000001 吨/);
  await h.click("手动试算");await h.click("查看候选名单");assert.match(h.text(),/0\.000001 吨/);h.unmount();
});

test("saving preserves linked filters and tonnage and keeps the selected round without calculating",async()=>{
  const h=harness();
  h.props.rounds=h.props.rounds.map(r=>({...r,scope:"ordered",qualificationMetric:"TONS",minTons:0.000001,productLine:"项目A",varieties:["品种,B"]}));
  h.render([h.props]);await h.flush();await h.click("02第二轮奖品草稿10 人");await h.click("保存并发布");
  const body=h.calls.find(c=>c[0]==="save")[2];
  assert.equal(body.rounds[1].minimumOrderTons,0.000001);assert.equal(body.rounds[1].productLine,"项目A");assert.deepEqual(body.rounds[1].varieties,["品种,B"]);
  assert.equal(h.props.rounds[1].id,101);assert.equal(h.props.rounds[1].minTons,0.000001);assert.deepEqual(h.props.rounds[1].varieties,["品种,B"]);
  assert(h.find(n=>n.type==="button"&&n.props.className?.split(" ").includes("active")&&text(n).includes("第二轮")));
  assert.equal(h.calls.filter(c=>c[0]==="preview").length,0);h.unmount();
});

test("weighting selection binds the matching threshold without automatic calculation",async()=>{
  const h=harness();await h.patch({scope:"ordered",minAmount:100,minBoxCount:50,minTons:0.25});
  for(const [mode,metric] of [["ORDER_BOX_COUNT_WEIGHTED","BOX_COUNT"],["ORDER_TONS_WEIGHTED","TONS"],["ORDER_AMOUNT_WEIGHTED","AMOUNT"]]) {
    const previousPreviews=h.calls.filter(c=>c[0]==="preview").length;
    h.field("抽取方式").props.onChange({target:{value:mode}});await h.flush();
    assert.equal(h.props.rounds[0].probabilityMode,mode);assert.equal(h.props.rounds[0].qualificationMetric,metric);
    assert.equal(h.field("门槛依据").props.value,metric);assert.equal(h.field("门槛依据").props.disabled,true);
    assert.equal(h.calls.filter(c=>c[0]==="preview").length,previousPreviews);
    await h.click("手动试算");const input=h.calls.filter(c=>c[0]==="preview").at(-1)[2];
    assert.equal(input.probabilityMode,mode);assert.equal(input.qualificationMetric,metric);
  }
  h.field("抽取方式").props.onChange({target:{value:"EQUAL"}});await h.flush();
  assert.equal(h.field("门槛依据").props.disabled,false);assert.match(h.text(),/待试算/);h.unmount();
});

test("tons weighting saves zero threshold, preserves six decimals and displays weight share",async()=>{
  const h=harness({preview:async()=>({candidateCount:1,actualWinnerCount:1,unawardedCount:0,missingTonnageCustomers:1,
    candidates:[{activityCustomerId:7,dealerFullName:"吨数候选",qualifyingOrderTons:0.000001,probabilityPercent:100}]})});
  await h.patch({scope:"ordered"});h.field("抽取方式").props.onChange({target:{value:"ORDER_TONS_WEIGHTED"}});await h.flush();
  await h.click("手动试算");assert.equal(h.calls.find(c=>c[0]==="preview")[2].minimumOrderTons,0);
  assert.match(h.text(),/缺失部分按0计/);await h.click("查看候选名单");
  assert.match(h.text(),/0\.000001 吨/);assert.match(h.text(),/抽取权重占比 100\.00%/);assert.match(h.text(),/首位抽中概率/);
  assert.equal(h.calls.filter(c=>c[0]==="preview").length,1);
  await h.click("关闭");await h.click("保存并发布");
  const saved=h.calls.find(c=>c[0]==="save")[2].rounds[0];assert.equal(saved.probabilityMode,"ORDER_TONS_WEIGHTED");
  assert.equal(saved.qualificationMetric,"TONS");assert.equal(saved.minimumOrderTons,0);
  assert.equal(h.props.rounds[0].probabilityMode,"ORDER_TONS_WEIGHTED");h.unmount();
});

test("legacy mixed metrics are retained on load and locked rounds cannot change weighting",async()=>{
  const h=harness();await h.patch({scope:"ordered",qualificationMetric:"TONS",minTons:1});
  assert.equal(h.props.rounds[0].probabilityMode,"ORDER_AMOUNT_WEIGHTED");assert.equal(h.field("门槛依据").props.value,"TONS");
  assert.match(h.text(),/保留原规则的门槛/);await h.patch({serverStatus:"DRAWN"});
  assert.equal(h.field("抽取方式").props.disabled,true);assert.equal(h.field("门槛依据").props.disabled,true);h.unmount();
});

test("copying a legacy mixed rule binds the new copy and preserves the original",async()=>{
  const h=harness();await h.patch({scope:"ordered",qualificationMetric:"TONS",minTons:1});
  await h.click("复制");assert.equal(h.props.rounds[0].qualificationMetric,"TONS");
  assert.equal(h.props.rounds.at(-1).probabilityMode,"ORDER_AMOUNT_WEIGHTED");assert.equal(h.props.rounds.at(-1).qualificationMetric,"AMOUNT");
  assert.equal(h.calls.filter(c=>c[0]==="preview").length,0);h.unmount();
});

function publishedRounds(statuses=["COMPLETED","READY","READY"]) {
  return statuses.map((serverStatus,i)=>({id:i+1,ruleId:20,ruleRevision:4,currentAttemptNo:serverStatus==="COMPLETED"?1:0,
    name:"轮次"+(i+1),prize:"奖品"+(i+1),winnerCount:2,customerType:"全部客户",scope:"all",minAmount:0,
    qualificationMetric:"AMOUNT",probabilityMode:"EQUAL",minBoxCount:0,excludeWinners:true,
    serverStatus,status:serverStatus==="COMPLETED"?"completed":"published",candidateCount:0}));
}
test("moving future rounds saves once by identity and never recalculates or reloads statistics",async()=>{
  const h=harness({rounds:publishedRounds()});await h.flush();
  await h.click("手动试算");const previews=h.calls.filter(c=>c[0]==="preview").length;
  await h.field("下移轮次2").props.onClick();await h.flush();
  assert.deepEqual(h.calls.find(c=>c[0]==="reorder").slice(1),[1,20,4,[1,3,2]]);
  assert.deepEqual(Array.from(h.props.rounds,r=>r.id),[1,3,2]);assert.equal(h.props.rounds[2].prize,"奖品2");
  assert.equal(h.props.rounds[2].ruleRevision,5);assert.match(h.text(),/抽奖顺序已更新/);
  assert.match(h.text(),/待试算/);assert.equal(h.calls.filter(c=>c[0]==="preview").length,previews);
  assert.equal(h.calls.filter(c=>c[0]==="statistics").length,1);assert.equal(h.calls.filter(c=>c[0]==="rules").length,0);
  assert.equal(h.intervals.size,0);await h.runTimers();assert.equal(h.calls.filter(c=>c[0]==="reorder").length,1);h.unmount();
});
test("dragging only a handle waits until drop; cancelled and same-position drags send nothing",async()=>{
  const h=harness({rounds:publishedRounds()});await h.flush();
  const event={preventDefault(){},dataTransfer:{setData(){}}};
  const handle=()=>h.field("拖动调整轮次2顺序");
  handle().props.onDragStart(event);
  h.find(n=>n.props?.["data-round-id"]===3).props.onDragOver(event);await h.flush();
  assert.equal(h.calls.filter(c=>c[0]==="reorder").length,0);
  handle().props.onDragEnd();await h.flush();assert.deepEqual(Array.from(h.props.rounds,r=>r.id),[1,2,3]);
  handle().props.onDragStart(event);h.find(n=>n.props?.["data-round-id"]===2).props.onDrop(event);await h.flush();
  assert.equal(h.calls.filter(c=>c[0]==="reorder").length,0);
  handle().props.onDragStart(event);h.find(n=>n.props?.["data-round-id"]===3).props.onDrop(event);await h.flush();
  assert.equal(h.calls.filter(c=>c[0]==="reorder").length,1);assert.deepEqual(Array.from(h.props.rounds,r=>r.id),[1,3,2]);h.unmount();
});
test("drawn, drawing, reset and formerly drawn rounds lock their complete prefix",async()=>{
  for(const status of ["DRAWING","DRAWN","RESET","COMPLETED"]) {
    const rounds=publishedRounds(["READY",status,"READY"]);rounds[1].currentAttemptNo=1;
    const h=harness({rounds});await h.flush();
    assert.equal(h.field("轮次1位置已锁定").props.disabled,true);assert.equal(h.field("轮次2位置已锁定").props.disabled,true);
    assert.equal(h.field("上移轮次3").props.disabled,true);h.unmount();
  }
  const rounds=publishedRounds(["READY","READY","READY"]);rounds[1].currentAttemptNo=1;
  const h=harness({rounds});assert.equal(h.field("轮次2位置已锁定").props.disabled,true);h.unmount();
});
test("unsaved published edits block sorting and local drafts reorder without network",async()=>{
  const h=harness({rounds:publishedRounds()});await h.flush();
  h.find(n=>n.type==="input"&&n.props.value==="奖品2").props.onChange({target:{value:"修改奖品"}});await h.flush();
  assert.equal(h.field("下移轮次2").props.disabled,true);await h.field("下移轮次2").props.onClick();await h.flush();
  assert.equal(h.calls.filter(c=>c[0]==="reorder").length,0);assert.match(h.text(),/请先保存规则/);h.unmount();
  const drafts=publishedRounds(["DRAFT","DRAFT"]).map((r,i)=>({...r,id:-1-i,ruleId:undefined,status:"draft"}));
  const d=harness({rounds:drafts});await d.flush();await d.field("下移轮次1").props.onClick();await d.flush();
  assert.deepEqual(Array.from(d.props.rounds,r=>r.id),[-2,-1]);assert.equal(d.calls.filter(c=>c[0]==="reorder").length,0);d.unmount();
});
test("a synchronous action lock prevents duplicate saves and known failures restore the old order",async()=>{
  let reject;const h=harness({rounds:publishedRounds(),reorder:()=>new Promise((_yes,no)=>{reject=no;})});await h.flush();
  const click=h.field("下移轮次2").props.onClick;click();click();await h.flush();
  assert.equal(h.calls.filter(c=>c[0]==="reorder").length,1);assert.equal(h.field("下移轮次3").props.disabled,true);
  reject(new h.ApiError(409,"LOTTERY_RULE_BUSY","开奖正在处理"));await h.flush();
  assert.deepEqual(Array.from(h.props.rounds,r=>r.id),[1,2,3]);assert.match(h.text(),/开奖正在处理/);
  assert.equal(h.calls.filter(c=>c[0]==="rules").length,0);h.unmount();
});
test("lost responses reconcile once without resubmitting and failed reconciliation blocks further writes",async()=>{
  const rounds=publishedRounds();
  const rule={id:20,status:"PUBLISHED",revision:5,rounds:[rounds[0],rounds[2],rounds[1]].map(r=>({...r,status:r.serverStatus,prizeName:r.prize}))};
  const h=harness({rounds,reorder:async()=>{throw new Error("lost response");},rules:async()=>[rule]});await h.flush();
  await h.field("下移轮次2").props.onClick();await h.flush();
  assert.deepEqual(Array.from(h.props.rounds,r=>r.id),[1,3,2]);assert.equal(h.calls.filter(c=>c[0]==="rules").length,1);
  assert.equal(h.calls.filter(c=>c[0]==="reorder").length,1);assert.equal(h.calls.filter(c=>c[0]==="statistics").length,1);h.unmount();
  const failed=harness({rounds:publishedRounds(),reorder:async()=>{throw new Error("offline");},rules:async()=>{throw new Error("offline");}});await failed.flush();
  await failed.field("下移轮次2").props.onClick();await failed.flush();assert.match(failed.text(),/暂时无法确认最新顺序/);
  assert.equal(failed.field("下移轮次2").props.disabled,true);assert.equal(failed.button("保存规则修改").props.disabled,true);failed.unmount();
});
test("a late sorting response cannot replace another activity",async()=>{
  let resolve;const h=harness({rounds:publishedRounds(),reorder:()=>new Promise(yes=>{resolve=yes;})});await h.flush();
  h.field("下移轮次2").props.onClick();await h.flush();h.props.activityId=2;h.props.rounds=publishedRounds().map(r=>({...r,id:r.id+10}));h.render([h.props]);
  resolve({ruleId:20,revision:5,rounds:[1,3,2].map((id,i)=>({id,roundNo:i+1,status:"READY",currentAttemptNo:0}))});await h.flush();
  assert.deepEqual(Array.from(h.props.rounds,r=>r.id),[11,12,13]);h.unmount();
});

test("saving configuration after sorting sends the latest version and the same round identities",async()=>{
  const h=harness({rounds:publishedRounds()});await h.flush();await h.field("下移轮次2").props.onClick();await h.flush();
  h.find(n=>n.type==="input"&&n.props.value==="奖品2").props.onChange({target:{value:"改后的奖品2"}});await h.flush();
  await h.click("保存规则修改");const body=h.calls.find(c=>c[0]==="update")[3];
  assert.equal(body.expectedRevision,5);assert.deepEqual(body.roundIds,[1,3,2]);assert.equal(body.rounds[2].prizeName,"改后的奖品2");
  assert.equal(body.rounds[0].excludePreviousWinners,true);
  assert.deepEqual(Array.from(h.props.rounds,r=>r.id),[1,3,2]);assert.equal(h.props.rounds[2].prize,"改后的奖品2");
  assert.equal(h.calls.filter(c=>c[0]==="preview").length,0);h.unmount();
});
