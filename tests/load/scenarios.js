import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Rate, Trend, Counter } from 'k6/metrics';
const users = new SharedArray('customers', () => JSON.parse(open('/results/fixture.json')).customers);
const secondaryUsers = new SharedArray('secondary customers', () => JSON.parse(open('/results/fixture.json')).customers.filter(c=>c.code==='LOAD-2'));
const activities = new SharedArray('activities', () => JSON.parse(open('/results/fixture.json')).activities);
const mode = __ENV.MODE || 'read';
const vus = Number(__ENV.VUS || 5);
const duration = __ENV.DURATION || '3m';
const run = __ENV.RUN;
if (!run || !/^[\w-]+$/.test(run) || vus < 1 || vus > 2000) throw Error('Invalid run or VUS');
if(mode==='multi' && vus>100) throw Error('Multi-activity fixture supports at most 100 VUs');
const failures = new Rate('business_failures');
const correctness = new Rate('data_errors');
const reads = new Trend('read_ms', true);
const writes = new Trend('write_ms', true);
const committed = new Counter('order_commits');
const endpointNames=mode==='verify'?['verify']:mode==='dashboard'?['dashboard']:mode==='read'?['products']:['write','first'].includes(mode)?['current','submit']:['products','current','draft','submit'];
const base = 'http://backend:8080/api/v1';
const scenario = mode==='first' ? {executor:'per-vu-iterations',vus,iterations:1,maxDuration:duration,gracefulStop:'20s'} : __ENV.RATE ? {
  executor: 'constant-arrival-rate', rate: Number(__ENV.RATE), timeUnit: '1s',
  duration, preAllocatedVUs: vus, maxVUs: vus, gracefulStop: '20s'
} : { executor: 'constant-vus', vus, duration, gracefulStop: '20s' };
export const options = {
  scenarios: { load: scenario }, maxRedirects: 0,
  summaryTrendStats: ['avg','min','med','max','p(95)','p(99)'],
  thresholds: {
    business_failures: [{threshold:'rate<0.01', abortOnFail:true, delayAbortEval:'30s'}],
    data_errors: [{threshold:'rate==0', abortOnFail:true, delayAbortEval:'5s'}],
    http_req_failed: ['rate<0.01'], checks: ['rate==1'],
    ...(__ENV.MIN_ITERATIONS ? {iterations:[`count>=${Number(__ENV.MIN_ITERATIONS)}`]} : {}),
    ...Object.fromEntries(endpointNames.map(name=>[`http_req_duration{name:${name}}`,[`p(95)<=${['submit','draft','verify'].includes(name)?1500:500}`,'p(99)<=3000']])),
    ...(mode === 'verify' ? {} : {read_ms:['p(95)<=500','p(99)<=3000']}),
    ...(['write','first','mixed','multi','verify'].includes(mode) ? {write_ms:['p(95)<=1500','p(99)<=3000']} : {}),
    ...(__ENV.RATE ? {dropped_iterations:['count==0']} : {})
  }
};
function req(method,path,user,body,name,key) {
  if(__ENV.LIGHTWEIGHT==='1' && (name==='current' || name==='submit')) path+='?includeHistory=false';
  const headers = {Cookie:user.cookie,'X-CSRF-Token':user.csrf,Origin:'http://localhost:3200','Content-Type':'application/json'};
  headers['X-Request-Id']=`${run}-${__VU}-${__ITER}-${name}`;
  if(key) headers['Idempotency-Key']=key;
  const r=http.request(method,base+path,body ? JSON.stringify(body) : null,{headers,timeout:'15s',tags:{name}});
  (method==='GET'?reads:writes).add(r.timings.duration);
  let data; try {data=r.json('data');}catch { /* Failure remains counted below. */ }
  const ok=r.status>=200 && r.status<300;
  failures.add(!ok); check(r,{[`${name} success`]:()=>ok});
  return {ok,data};
}
export default function loadIteration() {
  let user=users[__VU-1+Number(__ENV.OFFSET || 0)];
  if(!user) throw Error('Insufficient distinct fixture customers');
  if(mode==='multi' && __VU%2===0) user=secondaryUsers[Math.floor((__VU-1)/2)];
  const path=`/h5/activities/${user.code}`;
  const activity=activities.find(a=>a.id===user.activityId);
  if(mode==='verify') {
    const r=req('POST',`/public/activities/${user.code}/verify-phone`,user,{phone:user.phone,customerType:'SPECIAL'},'verify');
    correctness.add(r.ok && r.data?.customer?.customerId!==user.id);
  } else if(mode==='dashboard') {
    const r=req('GET',`/screen/activities/${user.code}/dashboard`,user,null,'dashboard');
    correctness.add(r.ok && !r.data);
  } else {
    if(!['write','first'].includes(mode)) {
      const r=req('GET',path+'/products',user,null,'products');
      correctness.add(r.ok && (!Array.isArray(r.data) || r.data.length!==300));
    }
    if(['write','first','mixed','multi'].includes(mode)) {
      const current=req('GET',path+'/order',user,null,'current');
      if(!current.ok) return;
      if(mode==='first' && current.data) {correctness.add(true);throw Error('First-order test requires unused customer OFFSET');}
      const version=current.data?.currentVersion || 0;
      const quantity=(current.data?.items?.[0]?.quantity || 1)===2 ? 3 : 2;
      const items=activity.products.slice(0,Number(__ENV.ITEMS || 10)).map(productId=>({productId,quantity}));
      if(!['write','first'].includes(mode)) req('PUT',path+'/order-draft',user,{customerId:user.id,baseOrderVersion:version,items},'draft');
      const r=req('PUT',path+'/order',user,{expectedVersion:version,items},'submit',`${run}-${__VU}-${__ITER}`);
      if(r.ok) {
        committed.add(1);
        correctness.add(!r.data || r.data.activityCustomerId!==user.id || r.data.currentVersion!==version+1 || Number(r.data.totalAmount)!==items.length*quantity*100);
      }
    }
  }
  if(!__ENV.RATE) sleep(Number(__ENV.THINK || 1));
}
export function handleSummary(data) { return { [`/results/${run}.json`]:JSON.stringify(data,null,2) }; }
