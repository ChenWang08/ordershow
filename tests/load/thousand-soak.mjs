import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { guard, save, sql } from './lib.mjs';
guard();
const id=Date.now(), report={startedAt:new Date().toISOString(),status:'running',phases:[],notRun:[]};
function checkpoint(){save(`thousand-soak-${id}.json`,report);}
async function run(script,args=[],extra={}) {
  const start=Date.now(), files=new Set(readdirSync('outputs/load'));
  report.current={script,args,extra,startedAt:new Date(start).toISOString()};checkpoint();
  console.log('SUITE PHASE',script,...args,extra);
  const env={...process.env,RATE:'',THINK:'',OFFSET:'',LIGHTWEIGHT:'1',PEAK_USERS:'',PEAK_SECONDS:'',PEAK_OFFSET:'',LOAD_PHASE:'thousand-soak',...extra};
  const child=spawn(process.execPath,[`tests/load/${script}.mjs`,...args],{env,stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  const resultFiles=readdirSync('outputs/load').filter(f=>!files.has(f) && /^(mixed|peak-entry|peak-order)-\d+-\d+\.json$/.test(f));
  const phase={script,args,extra,code,elapsedMs:Date.now()-start,results:resultFiles};report.phases.push(phase);report.current=null;checkpoint();
  for(const f of resultFiles) {
    const summary=JSON.parse(readFileSync(`outputs/load/${f}`,'utf8'));
    assert.equal(summary.metrics.data_errors?.values.rate || 0,0,'Data correctness threshold failed; stop all load');
  }
  return code===0;
}
async function verify(){assert(await run('verify'),'Database/API consistency gate failed');}
try {
  await verify();assert(await run('prepare-peak'),'Peak fixture preparation failed');
  for(const mode of ['peak-entry','peak-order']) {
    assert(await run('run',[mode,'10','10s'],{PEAK_USERS:'20',PEAK_SECONDS:'10',PEAK_OFFSET:'1000',LOAD_PHASE:'peak-smoke'}),'Peak script smoke gate failed');
  }
  for(const n of [200,500,1000]) {
    const passed=await run('run',['mixed',String(n),'5m'],{LOAD_PHASE:'high-frequency'});
    await verify();
    if(!passed) {
      report.notRun.push(...[200,500,1000].filter(v=>v>n).map(v=>({stage:`high-frequency-${v}`,reason:`${n}-user stage exceeded thresholds`})));checkpoint();break;
    }
  }
  const entry=await run('run',['peak-entry','100','60s'],{PEAK_USERS:'1000',PEAK_SECONDS:'60',LOAD_PHASE:'thousand-entry'});
  await verify();
  const order=await run('run',['peak-order','100','60s'],{PEAK_USERS:'1000',PEAK_SECONDS:'60',LOAD_PHASE:'thousand-order'});
  await verify();
  const fixture=JSON.parse(readFileSync('outputs/load/peak-fixture.json','utf8'));
  const ids=fixture.customers.slice(0,1000).map(c=>c.id);assert(ids.every(Number.isSafeInteger));
  const cohort=sql(`SELECT COUNT(*),COALESCE(SUM(total_amount),0),MIN(current_version_no),MAX(current_version_no) FROM customer_order WHERE activity_customer_id IN (${ids.join(',')});`).trim().split('\t').map(Number);
  report.peakOrderCohort={orders:cohort[0],amount:cohort[1],minVersion:cohort[2],maxVersion:cohort[3]};checkpoint();
  if(order)assert.deepEqual(cohort,[1000,2000000,1,1]);
  if(entry && order) {
    await run('sse',['100']);
    const warm=await run('run',['mixed','100','3m'],{RATE:'20',LOAD_PHASE:'soak-preflight'});
    await verify();
    if(warm) {
      await run('run',['mixed','100','60m'],{RATE:'20',LOAD_PHASE:'60-minute-soak'});
      await verify();await run('sse',['100']);
    } else report.notRun.push({stage:'60-minute-soak',reason:'20-flow/s preflight failed'});
  } else report.notRun.push({stage:'60-minute-soak',reason:'Thousand-customer peak gate failed'});
  await run('diagnose');await run('report');
  report.status=report.phases.some(p=>p.code!==0)?'completed-with-failures':'completed';
} catch(error) {
  report.status='stopped';report.error=error.message;console.error(error);process.exitCode=1;
} finally {
  report.finishedAt=new Date().toISOString();report.current=null;checkpoint();
  console.log('SUITE REPORT',`outputs/load/thousand-soak-${id}.json`,report.status);
}
