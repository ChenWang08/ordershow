import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/load-ts-module.mjs';

function harness() {
  let selected=null;
  const {H5SubmittedPage:Page}=loadModule('app/features/h5/H5SubmittedPage.tsx',{
    react:{...React,useState:()=>[selected,v=>{selected=v;}]},
    '../../api':{apiAssetUrl:url=>url},
    './ProductArt':{ProductArt:()=>null},
  });
  const item={productId:1,materialName:'正式商品',productLine:'调味油',quantity:10,casePrice:10,lineAmount:100};
  const model={visibleStep:'submitted',runtimeMessage:'',orderStatus:'submitted',activityClosed:false,customerOrderReadOnly:false,orderVersion:1,orderEvents:[],catalog:[],dealerName:'测试客户',orderUpdatedAt:'2026/9/30',runtimeOrder:{orderNo:'ORDER1',currentVersion:1,items:[item],totalQuantity:10,totalAmount:100},pendingChangeRequest:{id:1,status:'PENDING',requestType:'MODIFY',requestedAt:'2026-09-30T02:00:00Z',items:[{...item,materialName:'申请商品',quantity:30,casePrice:5,lineAmount:150}],requestedTotalQuantity:30,requestedTotalAmount:150}};
  const html=()=>renderToStaticMarkup(React.createElement(Page,{model}));
  function find(node,text) {
    if(!node||typeof node!=='object')return;
    if(node.type==='button'&&node.props.children===text)return node;
    for(const child of [node.props?.children].flat(Infinity)){const found=find(child,text);if(found)return found;}
  }
  return {model,html,click:text=>find(Page({model}),text).props.onClick()};
}
test('pending modification defaults to saved application items and totals, not formal V1',()=>{
 const h=harness();const html=h.html();
 assert.match(html,/申请商品/);assert.match(html,/申请总金额/);assert.match(html,/150\.00/);
 assert.doesNotMatch(html,/正式商品/);assert.doesNotMatch(html,/V2/);assert.doesNotMatch(html,/申请已更新/);
 assert.match(html,/审核通过后生效/);
});
test('formal order toggle returns to request and a replaced request resets to latest content',()=>{
 const h=harness();h.click('查看当前生效订单 V1');assert.match(h.html(),/正式商品/);
 h.click('查看待审核申请');assert.match(h.html(),/申请商品/);
 h.click('查看当前生效订单 V1');h.model.pendingChangeRequest.id=2;assert.match(h.html(),/申请商品/);
});
test('withdrawal request retains original items; closed requests remain visible without editing',()=>{
 const h=harness();h.model.pendingChangeRequest.requestType='WITHDRAW';h.model.pendingChangeRequest.items=[];
 assert.match(h.html(),/撤回申请待审核/);assert.match(h.html(),/正式商品/);
 h.model.activityClosed=true;h.model.customerOrderReadOnly=true;
 assert.doesNotMatch(h.html(),/>继续修改申请<\/button>/);assert.match(h.html(),/仍可由后台审核/);
});
test('rejection shows formal order and reason; approval displays the new formal version',()=>{
 const h=harness();h.model.pendingChangeRequest.status='REJECTED';h.model.pendingChangeRequest.reviewReason='数量需核对';
 assert.match(h.html(),/正式商品/);assert.match(h.html(),/数量需核对/);assert.doesNotMatch(h.html(),/申请商品/);
 h.model.pendingChangeRequest=null;h.model.runtimeOrder.currentVersion=2;
 assert.match(h.html(),/V2/);assert.doesNotMatch(h.html(),/待审核/);
});

test('formal multi-tier order shows every charged segment and the server total',()=>{
 const h=harness();h.model.pendingChangeRequest=null;h.model.runtimeOrder.totalAmount=350980;
 h.model.runtimeOrder.items[0]={...h.model.runtimeOrder.items[0],quantity:1200,lineAmount:350980,casePrice:300,pricingDetails:{tiers:[],segments:[
   {quantity:499,casePrice:300,amount:149700},{quantity:500,casePrice:290,amount:145000},{quantity:201,casePrice:280,amount:56280},
 ]}};
 const html=h.html();
 assert.match(html,/499 箱 × ¥300\.00 ＝ ¥149,700\.00/);
 assert.match(html,/500 箱 × ¥290\.00 ＝ ¥145,000\.00/);
 assert.match(html,/201 箱 × ¥280\.00 ＝ ¥56,280\.00/);
 assert.match(html,/350,980\.00/);assert.doesNotMatch(html,/¥300\.00\/箱/);
});
