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
  const props={active:true,revision:"first",rounds:[base,{...base,id:2,name:"第二轮"}],attendanceRows:[],activityId:1,customerCount:100,readOnly:false,
    onChange:rounds=>{props.rounds=rounds;}};
  const api={ApiError:class extends Error {},apiAssetUrl:url=>url,
    previewLotteryCandidates:async(id,input,signal)=>{calls.push(["preview",id,structuredClone(input),signal]);
      if(options.preview) return options.preview(id,input,signal);
      return {candidateCount:2,configuredWinnerCount:10,actualWinnerCount:2,unawardedCount:8,candidates:[{activityCustomerId:7,dealerFullName:"候选甲",customerType:"GENERAL"}],totalCandidateOrderAmount:20};},
    loadLotteryStatistics:async()=>{calls.push(["statistics"]);return{validWinnerCustomers:3,invalidatedWinnerRecords:0};},
    loadLotteryProductOptions:async()=>{calls.push(["options"]);return[{productLine:"项目A",varietyName:"品种A"},{productLine:"项目A",varietyName:"品种,B"},{productLine:"项目B",varietyName:"品种B"}];},
    createLotteryRule:async(id,body)=>{calls.push(["save",id,structuredClone(body)]);return {id:20,status:"DRAFT",rounds:body.rounds};},
    publishLotteryRule:async(id,ruleId)=>{calls.push(["publish",id,ruleId]);return {id:20,status:"PUBLISHED",rounds:calls.find(c=>c[0]==="save")[2].rounds.map((r,i)=>({...r,id:100+i,roundNo:i+1,status:"READY"}))};},
  };
  const h=hookHarness("app/features/lottery/Lottery.tsx","LotterySettings",[props],{"../../api":api,"../shared/components/FestivalDecor":{FestivalDecor:()=>null}});
  return {...h,props,calls,options,
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
  assert(h.find(n=>n.type==="button"&&n.props.className==="active"&&text(n).includes("第二轮")));
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
