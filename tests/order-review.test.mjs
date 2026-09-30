import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/load-ts-module.mjs';
const {OrderChangeRequestPanel}=loadModule('app/components/orders/OrderChangeRequestPanel.tsx',{'../../api':{ApiError:class extends Error{}}});
const item=(productId,materialName,quantity)=>({productId,materialName,quantity,casePrice:10,lineAmount:quantity*10,productLine:'调味油'});
const order={id:1,orderNo:'ORDER1',status:'SUBMITTED',currentVersion:2,totalQuantity:60,totalAmount:600,items:[item(1,'新正式订单商品',60)],versions:[]};
const request={id:2,orderId:1,orderNo:'ORDER1',dealerName:'测试经销商',requestType:'MODIFY',status:'PENDING',baseVersion:1,currentVersion:2,requestedAt:'2026-09-30T02:00:00Z',requestedTotalQuantity:40,requestedTotalAmount:400,items:[item(1,'食用油',30),item(3,'新增酱油',10)],originalOrder:{...order,currentVersion:1,totalQuantity:30,totalAmount:300,items:[item(1,'食用油',20),item(2,'删除商品',10)]}};
const render=(selected=request)=>renderToStaticMarkup(React.createElement(OrderChangeRequestPanel,{model:{changeRequests:{selected,original:order,requests:[request],pending:[{id:2,orderId:1}],filters:{status:'PENDING',type:'ALL',keyword:'',page:1,size:20,newest:false},total:1,reason:'',error:'',busyId:null}}}));
test('review detail compares the immutable request baseline, including added and removed items without images',()=>{
 const html=render();
 assert.match(html,/删除商品/);assert.match(html,/新增酱油/);assert.match(html,/\+10/);
 assert.match(html,/原数量/);assert.match(html,/查看完整原订单/);assert.match(html,/¥300\.00/);
 assert.doesNotMatch(html,/<img/);assert.doesNotMatch(html,/新正式订单商品/);
});
test('processed review shows reason and offers no approval action',()=>{
 const html=render({...request,status:'REJECTED',reviewReason:'已被客户新申请替代'});
 assert.match(html,/已被客户新申请替代/);assert.doesNotMatch(html,/>审核通过<\/button>/);
});
test('review list remains available when no requests match filters',()=>{
 const html=renderToStaticMarkup(React.createElement(OrderChangeRequestPanel,{model:{changeRequests:{requests:[],filters:{status:'PENDING',type:'ALL',keyword:'',page:1,size:20,newest:false},total:0}}}));
 assert.match(html,/暂无符合条件的申请/);assert.match(html,/搜索订单号/);
});
