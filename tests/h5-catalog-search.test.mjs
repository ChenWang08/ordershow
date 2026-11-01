/* eslint-disable react-hooks/rules-of-hooks -- deterministic hook harness rerenders mocked state slots, not React components. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadModule } from './helpers/load-ts-module.mjs';
const { accessibleCatalog, searchCatalog } = loadModule('app/features/h5/h5-catalog-search.ts');
const product = (id, name, line, rebate, extra = {}) => ({id, name, line, rebate, customerType:'综合', branchScope:[], status:'有效', isOrderable:true, ...extra});
const products = [product('1','金龙鱼清香米醋','醋',false), product('2','丸庄黑豆酱油','酱油',true,{materialCode:'JY-01'}), product('3','丸庄酱油另一规格','酱油',false), product('4','金龙鱼调味油','调味油',true)];
const browse = {rebate:'PARTICIPATING',line:'醋'};
const ids = result => Array.from(result.visibleProducts, p=>p.id);

test('search locates vinegar across rebate tabs and soy sauce across project groups',()=>{
  let result=searchCatalog(products,'金龙鱼清香米醋',browse,null);
  assert.equal(result.selection.rebate,'NOT_PARTICIPATING'); assert.equal(result.selection.line,'醋'); assert.deepEqual(ids(result),['1']);
  result=searchCatalog(products,'JY-01',browse,null);
  assert.equal(result.selection.rebate,'PARTICIPATING'); assert.equal(result.selection.line,'酱油'); assert.deepEqual(ids(result),['2']);
});
test('mixed rebates and groups show all matches, manual narrowing remains possible',()=>{
  let result=searchCatalog(products,'丸庄',browse,null);
  assert.equal(result.selection.rebate,'ALL'); assert.equal(result.selection.line,'酱油'); assert.deepEqual(ids(result),['2','3']);
  result=searchCatalog(products,'金龙鱼',browse,null);
  assert.equal(result.selection.line,'全部'); assert.deepEqual(ids(result),['1','4']);
  result=searchCatalog(products,'丸庄',browse,browse);
  assert.deepEqual(ids(result),[]); assert.equal(result.totalMatches,2);
});
test('project names, case-insensitive codes, blank search and genuine zero results',()=>{
  assert.deepEqual(ids(searchCatalog(products,'  jy-01  ',browse,null)),['2']);
  assert.deepEqual(ids(searchCatalog(products,'调味油',browse,null)),['4']);
  assert.equal(searchCatalog(products,'不存在',browse,null).totalMatches,0);
  assert.equal(searchCatalog(products,'   ',browse,null).searching,false);
  assert.equal(searchCatalog(products,'   ',browse,null).selection.line,'醋');
});
test('search preserves visibility restrictions, incomplete rows and unique product IDs',()=>{
  const source=[...products, products[0], product('5','其他分公司','醋',true,{branchScope:['其他']}),product('6','特渠','醋',true,{customerType:'特渠'}),product('7','待核对','醋',true,{status:'待核对'}),product('8','价格待完善','醋',true,{status:'待完善',isOrderable:false})];
  const allowed=accessibleCatalog(source,'综合',false,'本分公司');
  assert.deepEqual(Array.from(allowed,p=>p.id),['1','2','3','4','8']);
  assert.equal(allowed.at(-1).isOrderable,false);
  assert.ok(accessibleCatalog(source,'综合',true,'本分公司').some(p=>p.id==='6'));
});
test('single rebate, unspecified rebate and removed groups remain navigable',()=>{
  const all=product('9','通用商品','', '全部');
  let result=searchCatalog([all],'通用',browse,null);
  assert.equal(result.selection.rebate,'ALL'); assert.equal(result.selection.line,'未分类'); assert.deepEqual(ids(result),['9']);
  result=searchCatalog([products[1]],'',browse,null);
  assert.equal(result.selection.line,'全部'); assert.equal(result.selection.rebate,'ALL');
});

function harness() {
  const slots=[]; let cursor=0, changed=false; const effects=[]; const timers=new Map(); let nextTimer=0;
  const equal=(a,b)=>a?.length===b?.length && a.every((v,i)=>Object.is(v,b[i]));
  const react={
    useState(initial){ const i=cursor++; if(!(i in slots)) slots[i]=typeof initial==='function'?initial():initial; return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value; changed=true;}]; },
    useMemo(fn,deps){ const i=cursor++; if(!slots[i] || !equal(slots[i].deps,deps)) slots[i]={deps,value:fn()}; return slots[i].value; },
    useEffect(fn,deps){ const i=cursor++; if(!slots[i] || !equal(slots[i].deps,deps)) {slots[i]?.cleanup?.(); slots[i]={deps}; effects.push(()=>{slots[i].cleanup=fn();});} },
  };
  const {useH5CatalogSearch}=loadModule('app/features/h5/useH5CatalogSearch.ts',{react},{setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer;},clearTimeout(id){timers.delete(id);}});
  const context={products,scope:'customer-a',enabled:true};
  return {context,render(){let result;do{changed=false;cursor=0;result=useH5CatalogSearch(context.products,'综合',false,'',context.scope,context.enabled);}while(changed);while(effects.length)effects.shift()();return result;},flush(){const work=[...timers.values()];timers.clear();work.forEach(fn=>fn());},timerCount:()=>timers.size};
}
test('debounce, IME composition and immediate submit do not apply obsolete queries',()=>{
  const h=harness();h.render().setSearch('丸');h.render();assert.equal(h.timerCount(),1);
  h.render().startSearchComposition();h.render().setSearch('丸庄');h.render();assert.equal(h.timerCount(),0);
  h.flush();assert.equal(h.render().searching,false);
  h.render().endSearchComposition('丸庄');h.render();h.flush();assert.deepEqual(ids(h.render()),['2','3']);
  h.render().setSearch('米醋');h.render().submitSearch();assert.deepEqual(ids(h.render()),['1']);
  h.render().setSearch('');h.render();h.flush();assert.equal(h.render().searching,false);
});
test('manual filtering survives rerenders, new keywords search globally, clear restores original category',()=>{
  const h=harness();h.render().setLine('醋');h.render().setSearch('丸庄');h.render().submitSearch();
  assert.equal(h.render().selection.line,'酱油');h.render().setLine('醋');assert.equal(h.render().visibleProducts.length,0);
  h.render().showAllSearchResults();assert.deepEqual(ids(h.render()),['2','3']);
  h.render().setSearch('金龙鱼清香米醋');h.render();h.flush();assert.equal(h.render().selection.rebate,'NOT_PARTICIPATING');
  h.render().setSearch('');assert.equal(h.render().selection.line,'醋');assert.equal(h.render().selection.rebate,'PARTICIPATING');
});
test('leaving cancels delayed search and identity changes reset search and manual filters',()=>{
  const h=harness();h.render().setSearch('丸庄');h.render();h.context.enabled=false;h.render();assert.equal(h.timerCount(),0);
  h.context.scope='customer-b';assert.equal(h.render().search,'');assert.equal(h.render().selection.line,'全部');
  h.context.enabled=true;h.render();h.flush();assert.equal(h.render().searching,false);
});
test('updated catalog recalculates search and safely falls back from deleted project groups',()=>{
  const h=harness();h.render().setSearch('丸庄');h.render().submitSearch();h.render().setLine('酱油');
  h.context.products=[product('10','丸庄新商品','新品',false)];
  assert.equal(h.render().selection.line,'全部');assert.deepEqual(ids(h.render()),['10']);
});

test('integrated order flow preserves quantities and totals across global search and clearing',()=>{
  const slots=[];let cursor=0,changed=false;
  const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;changed=true;}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useMemo:fn=>fn(),useCallback:fn=>fn,useEffect:()=>{},useSyncExternalStore:(_subscribe,getSnapshot)=>getSnapshot()};
  const {useH5OrderFlow}=loadModule('app/features/h5/useH5OrderFlow.ts',{react,'../../api':{apiAssetUrl:u=>u},'./useH5Draft':{useH5Draft:()=>({})}});
  const rows=products.map(p=>({id:p.id,materialName:p.name,line:p.line,customerType:'综合',rebate:p.rebate?'参与':'不参与',branchScope:'',status:'有效',casePrice:'37.5'}));
  function render(){let model;do{changed=false;cursor=0;model=useH5OrderFlow({activityStatus:'running',importedRows:rows,importedWhitelistRows:[]});}while(changed);return model;}
  render().setChannel('综合客户');render().setStep('order');render().setLine('醋');
  render().setSearch('清香米醋');render().catalogSearch.submitSearch();
  assert.equal(render().effectiveRebateFilter,'NOT_PARTICIPATING');assert.equal(render().line,'醋');
  render().changeQty('1',2);assert.equal(render().totalAmount,75);
  render().setSearch('丸庄');render().catalogSearch.submitSearch();
  assert.equal(render().line,'酱油');assert.equal(render().totalBoxes,2);assert.equal(render().totalAmount,75);
  assert.deepEqual(Array.from(render().visibleProducts,p=>p.id),['2','3']);
  render().setSearch('');assert.equal(render().line,'醋');assert.equal(render().quantities['1'],2);assert.equal(render().totalAmount,75);
});
