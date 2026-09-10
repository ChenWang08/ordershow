import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';
const customers=new SharedArray('peak customers',()=>JSON.parse(open('/results/peak-fixture.json')).customers);
const activity=new SharedArray('peak activity',()=>[JSON.parse(open('/results/peak-fixture.json')).activity])[0];
const total=Number(__ENV.PEAK_USERS || 1000), seconds=Number(__ENV.PEAK_SECONDS || 60), offset=Number(__ENV.PEAK_OFFSET || 0);
const vus=Number(__ENV.VUS || 100), mode=__ENV.MODE, run=__ENV.RUN;
if(!['peak-entry','peak-order'].includes(mode) || !/^[\w-]+$/.test(run || '') || !Number.isInteger(total) || total<1 || total>1000 || !Number.isInteger(offset) || offset<0 || offset+total>customers.length || !Number.isInteger(seconds) || seconds<1 || seconds>300) throw Error('Invalid peak configuration');
const started=new Counter('peak_started'), completed=new Counter('peak_completed'), commits=new Counter('order_commits');
const boundary=new Counter('boundary_iterations'), failures=new Rate('business_failures'), errors=new Rate('data_errors');
const reads=new Trend('read_ms',true), writes=new Trend('write_ms',true), flow=new Trend('flow_ms',true), arrival=new Trend('arrival_delay_ms',true);
const base='http://backend:8080/api/v1';
const names=mode==='peak-entry'?['verify','products']:['current','submit','readback'];
export const options={
  scenarios:{peak:{executor:'constant-arrival-rate',rate:total,timeUnit:`${seconds}s`,duration:`${seconds}s`,preAllocatedVUs:vus,maxVUs:vus,gracefulStop:'45s'}},
  maxRedirects:0,summaryTrendStats:['avg','min','med','max','p(95)','p(99)'],
  thresholds:{
    peak_started:[`count==${total}`],peak_completed:[`count==${total}`],dropped_iterations:['count==0'],
    business_failures:[{threshold:'rate<0.01',abortOnFail:true,delayAbortEval:'15s'}],
    data_errors:[{threshold:'rate==0',abortOnFail:true,delayAbortEval:'5s'}],checks:['rate==1'],http_req_failed:['rate<0.01'],
    read_ms:['p(95)<=500','p(99)<=3000'],write_ms:['p(95)<=1500','p(99)<=3000'],flow_ms:['p(95)<=3000'],arrival_delay_ms:['p(95)<=1000'],
    ...Object.fromEntries(names.map(n=>[`http_req_duration{name:${n}}`,[`p(95)<=${['verify','submit'].includes(n)?1500:500}`,'p(99)<=3000']]))
  }
};
function request(method,path,user,body,name,key) {
  const headers={Origin:'http://localhost:3200','Content-Type':'application/json',Cookie:user.cookie,'X-CSRF-Token':user.csrf};
  headers['X-Request-Id']=`${run}-${__VU}-${__ITER}-${name}`;
  if(key)headers['Idempotency-Key']=key;
  const r=http.request(method,base+path,body?JSON.stringify(body):null,{headers,timeout:'15s',tags:{name}});
  (method==='GET'?reads:writes).add(r.timings.duration);
  const ok=r.status>=200 && r.status<300;failures.add(!ok);check(r,{[name+' success']:()=>ok});
  let data;try{data=r.json('data');}catch{/* Counted as HTTP or payload failure. */}
  return {ok,data,response:r};
}
function valid(value) { errors.add(!value);check(value,{'business payload correct':v=>v});return value; }
export default function peakIteration() {
  const index=exec.scenario.iterationInTest;
  // The executor can schedule a boundary iteration exactly at duration; it must not repeat a customer.
  if(index>=total){boundary.add(1);return;}
  const begin=Date.now(), user=customers[offset+index], path=`/h5/activities/${user.code}/order?includeHistory=false`;
  started.add(1);arrival.add(Math.max(0,begin-(exec.scenario.startTime+index*seconds*1000/total)));
  if(mode==='peak-entry') {
    const login=request('POST',`/public/activities/${user.code}/verify-phone`,user,{phone:user.phone,customerType:'SPECIAL'},'verify');
    if(!login.ok || !valid(login.data?.customer?.customerId===user.id))return;
    const cookie=Object.entries(login.response.cookies).flatMap(([name,values])=>values.map(v=>`${name}=${v.value}`)).join('; ');
    if(!valid(Boolean(cookie && login.data.csrfToken)))return;
    const catalog=request('GET',`/h5/activities/${user.code}/products`,{cookie,csrf:login.data.csrfToken},null,'products');
    if(!catalog.ok || !valid(Array.isArray(catalog.data) && catalog.data.length===300))return;
  } else {
    const current=request('GET',path,user,null,'current');
    if(!current.ok || !valid(current.data==null))return;
    const items=activity.products.slice(0,10).map(productId=>({productId,quantity:2}));
    const order=request('PUT',path,user,{expectedVersion:0,items},'submit',`${run}-${index}`);
    if(!order.ok)return;
    commits.add(1);
    if(!valid(order.data?.activityCustomerId===user.id && order.data.currentVersion===1 && Number(order.data.totalAmount)===2000 && order.data.totalQuantity===20))return;
    const readback=request('GET',path,user,null,'readback');
    if(!readback.ok || !valid(readback.data?.id===order.data.id && readback.data.currentVersion===1 && Number(readback.data.totalAmount)===2000))return;
  }
  completed.add(1);flow.add(Date.now()-begin);
}
export function handleSummary(data) {return {[`/results/${run}.json`]:JSON.stringify(data,null,2)};}
