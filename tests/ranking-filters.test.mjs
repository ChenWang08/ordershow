import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/load-ts-module.mjs";

const { rankingChoices, rankingFilters, rankingOptionValue, changeRankingSelection, initialRankingSelection: initial } = loadModule("app/features/screens/ranking-filters.ts");
const options = { customers: [
  { customerType: "GENERAL", regionCode: "EAST", regionName: "华东" },
  { customerType: "SPECIAL", regionName: "未填写" },
], products: [
  { productLine: "项目A", varietyName: "品种A" }, { productLine: "项目B", varietyName: "品种B" },
  { productLine: "项目A", varietyName: "品种A" }, { productLine: "项目A", varietyName: "品种,B" }, {},
  { productLine: "未填写", varietyName: "未填写" }, { productLine: "全部", varietyName: "ALL" },
] };
const values = choices => Array.from(choices, ([value]) => value);

test("ranking cascades regions by type and varieties by project, preserving all and literal labels", () => {
  assert.deepEqual(values(rankingChoices(options).varieties).sort(), ["empty","value:ALL","value:品种,B","value:品种A","value:品种B","value:未填写"].sort());
  const selection = { ...initial, customerType: "GENERAL", productLine: "value:项目A" };
  const choices = rankingChoices(options, selection);
  assert.deepEqual(values(choices.regions), ["value:EAST"]);
  assert.deepEqual(values(choices.varieties).sort(), ["value:品种A","value:品种,B"].sort());
  assert.deepEqual(values(rankingChoices(options, { ...initial, productLine: "empty" }).varieties), ["empty"]);
  assert.ok(rankingChoices(options).lines.some(([,label]) => label === "未填写（项目组名称）"));
  assert.ok(rankingChoices(options).varieties.some(([,label]) => label === "未填写（品种名称）"));
  assert.deepEqual(values(rankingChoices(options, selection, false).varieties), []);
});

test("ranking resets descendants only when an upstream value changes", () => {
  const chosen = { ...initial, customerType: "GENERAL", region: "value:EAST", productLine: "value:项目A", varieties: ["value:品种A"], metric: "TONS" };
  const type = changeRankingSelection(chosen, { customerType: "SPECIAL" });
  assert.equal(type.region, "all"); assert.equal(type.productLine, "all"); assert.equal(type.varieties, null); assert.equal(type.metric, "TONS");
  const region = changeRankingSelection(chosen, { region: "empty" });
  assert.equal(region.customerType,"GENERAL"); assert.equal(region.productLine,"all"); assert.equal(region.varieties,null);
  assert.equal(changeRankingSelection(chosen, { productLine: "all" }).varieties,null);
  assert.deepEqual(Array.from(changeRankingSelection(chosen, { metric: "AMOUNT" }).varieties), ["value:品种A"]);
  assert.deepEqual(Array.from(changeRankingSelection(chosen, { productLine: "value:项目A" }).varieties), ["value:品种A"]);
});

test("ranking handles real omitted fields, null, empty and spaces without converting them to literal undefined", () => {
  for (const value of [undefined,null,"","   "]) assert.equal(rankingOptionValue(value),"empty");
  assert.equal(rankingOptionValue(" 未填写 "),"value:未填写");
  assert.equal(rankingOptionValue("undefined"),"value:undefined");
  const choices=rankingChoices({customers:[{customerType:"SPECIAL",regionName:"未填写"}],products:[{}]});
  const filter=rankingFilters({...initial,customerType:"SPECIAL",region:choices.regions[0][0],productLine:choices.lines[0][0],varieties:[choices.varieties[0][0]]});
  assert.equal(filter.regionUnassigned,true); assert.equal(filter.productLineUnassigned,true); assert.equal(filter.includeUnspecifiedVariety,true);
  assert.equal(filter.regionCode,undefined); assert.equal(filter.productLine,undefined); assert.deepEqual(Array.from(filter.varieties),[]);
});

test("ranking options forwards only upstream scope and cancellation", async () => {
  const calls=[]; const controller=new AbortController();
  const api=loadModule("app/services/api/dashboard.ts",{
    "./client":{api:async(url,init)=>{calls.push({url,init});return {data:options};}},
    "./context":{activeActivityPath:()=>"fixture"},
  },{URLSearchParams});
  await api.loadRankingOptions(controller.signal,{customerType:"SPECIAL",regionUnassigned:true});
  assert.equal(calls[0].url,"/screen/activities/fixture/ranking/options?customerType=SPECIAL&regionUnassigned=true");
  assert.equal(calls[0].init.signal,controller.signal);
  await api.loadRankingOptions(controller.signal,{customerType:"ALL"});
  assert.equal(calls[1].url,"/screen/activities/fixture/ranking/options");
});
