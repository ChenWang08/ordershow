import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { compose, docker, guard, save, base, sql, resultsRoot } from './lib.mjs';
import { assessSoakDuration } from './soak-duration.mjs';
import { expectedAudits } from './audit-verification.mjs';
guard();
const readiness=await fetch(`${base}/actuator/health/readiness`,{signal:AbortSignal.timeout(5000)});
if(!readiness.ok || (await readiness.json()).status!=='UP') throw Error('Backend is not ready; no load was started');
const mode=process.argv[2] || 'read', vus=Number(process.argv[3] || 5), duration=process.argv[4] || '3m';
if(!['read','write','first','mixed','multi','dashboard','verify','peak-entry','peak-order'].includes(mode) || !Number.isInteger(vus) || vus<1 || vus>2000 || !/^\d+[smh]$/.test(duration)) throw Error('Invalid run arguments');
const run=`${mode}-${vus}-${Date.now()}`;
const config={mode,vus,duration,rate:process.env.RATE || null,think:process.env.THINK || '1',items:process.env.ITEMS || '10',offset:process.env.OFFSET || '0',lightweight:process.env.LIGHTWEIGHT==='1',phase:process.env.LOAD_PHASE || 'manual',peakUsers:process.env.PEAK_USERS || null,peakSeconds:process.env.PEAK_SECONDS || null,peakOffset:process.env.PEAK_OFFSET || null};
const backendId=docker([...compose,'ps','-q','backend']).trim();
const backend=JSON.parse(docker(['inspect',backendId]))[0];
config.backend={image:backend.Image,nanoCpus:backend.HostConfig.NanoCpus,memory:backend.HostConfig.Memory,
  settings:backend.Config.Env.filter(value=>/^(H5_WARMUP_ENABLED|H5_WRITE_CONCURRENCY|VIRTUAL_THREADS_ENABLED|SERVER_TOMCAT_THREADS_MAX|DB_POOL_SIZE|JAVA_TOOL_OPTIONS)=/.test(value))};
function databaseSnapshot() {
 try {return docker([...compose,'exec','-T','-e','MYSQL_PWD=load_only_root','mysql','mysql','-uroot','--batch','-e',
  "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Slow_queries','Innodb_row_lock_waits','Innodb_row_lock_time','Innodb_deadlocks','Created_tmp_disk_tables'); SELECT COUNT(*) lock_waits FROM performance_schema.data_lock_waits; SHOW ENGINE INNODB STATUS; SELECT DIGEST, LEFT(DIGEST_TEXT,500) sql_text, COUNT_STAR calls, SUM_TIMER_WAIT total_picoseconds, SUM_ROWS_EXAMINED rows_examined FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME='order_show_load' ORDER BY SUM_TIMER_WAIT DESC LIMIT 40;"]);
 }catch{return 'Database diagnostics unavailable';}
}
const databaseBefore=databaseSnapshot();
const versionsBefore=Number(sql('SELECT COUNT(*) FROM order_version;').trim());
const metrics=[], resources=[];
const names=['jvm.memory.used','jvm.gc.pause','hikaricp.connections.active','hikaricp.connections.pending','hikaricp.connections.acquire','hikaricp.connections.usage','order_show.h5.write.admission.active','order_show.h5.write.admission.waiting','process.cpu.usage','system.cpu.usage'];
const controller=new AbortController();
let busy=false;
async function sample() {
 if(busy) return; busy=true;
 try {
  const values=await Promise.all(names.map(async name=>{
    try {const r=await fetch(`${base}/actuator/metrics/${name}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(3000)])});return {name,status:r.status,value:await r.json()};}catch{return {name,unavailable:true};}
  }));
  const point={time:new Date().toISOString(),values};metrics.push(point);
  appendFileSync(`${resultsRoot}/${run}-samples.jsonl`,JSON.stringify(point)+'\n');
 } finally {busy=false;}
}
const timer=setInterval(sample,5000); await sample();
// No fixed ID list: include the k6 container created after sampling starts, plus shared-host load.
const stats=spawn('docker',['stats','--format','{{json .}}'],{windowsHide:true});
stats.stdout.on('data',b=>resources.push({time:new Date().toISOString(),text:b.toString().replace(/\u001b\[[0-9;]*[A-Za-z]/g,'')}));
stats.stderr.on('data',()=>{});
const args=[...compose,'run','--rm','-T','-e',`MODE=${mode}`,'-e',`VUS=${vus}`,'-e',`DURATION=${duration}`,'-e',`RUN=${run}`];
for(const name of ['RATE','THINK','ITEMS','OFFSET','LIGHTWEIGHT','PEAK_USERS','PEAK_SECONDS','PEAK_OFFSET']) if(process.env[name]) args.push('-e',`${name}=${process.env[name]}`);
if(config.phase==='60-minute-soak')args.push('-e','MIN_ITERATIONS=72000');
args.push('k6','run','--quiet',mode.startsWith('peak-')?'/scripts/peak.js':'/scripts/scenarios.js');
const start=Date.now();
function progress(stage) {
 const point={run,stage,config,start:new Date(start).toISOString(),elapsedSeconds:Math.round((Date.now()-start)/1000),latestMetrics:metrics.at(-1)};
 save(`${run}-progress.json`,point);
 console.log('PROGRESS',run,stage,point.elapsedSeconds+'s');
}
progress('running');const progressTimer=setInterval(()=>progress('running'),30000);
const child=spawn('docker',args,{stdio:'inherit',windowsHide:true});
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
clearInterval(timer);clearInterval(progressTimer);controller.abort();stats.kill();
const versionsAfter=Number(sql('SELECT COUNT(*) FROM order_version;').trim());
save(`${run}-monitor.json`,{config,start:new Date(start).toISOString(),elapsedMs:Date.now()-start,code,metrics,resources,databaseBefore,databaseAfter:databaseSnapshot(),versionsBefore,versionsAfter});
try {
 const summary=JSON.parse(readFileSync(`${resultsRoot}/${run}.json`,'utf8'));
 if(config.phase==='60-minute-soak') {
   const durationVerdict=assessSoakDuration(config,summary);save(`${run}-duration-verdict.json`,durationVerdict);
   if(!durationVerdict.accepted) {console.error('Soak duration or scheduled work is incomplete.');process.exitCode=1;}
   else if(!durationVerdict.strictDurationPassed) console.warn('Statistics clock boundary; retain raw timing:',durationVerdict);
 }
 const commits=summary.metrics.order_commits?.values.count || 0;
 const expectedAudit=expectedAudits(summary);
 let auditRows=0,uniqueAudit=0;const auditDeadline=Date.now()+5000;
 do {
   [auditRows,uniqueAudit]=sql(`SELECT COUNT(*),COUNT(DISTINCT trace_id) FROM audit_log WHERE trace_id LIKE '${run}-%';`).trim().split('\t').map(Number);
   if(auditRows>=expectedAudit)break;
   await new Promise(resolve=>setTimeout(resolve,100));
 } while(Date.now()<auditDeadline);
 const auditVerification={expected:expectedAudit,actual:auditRows,uniqueTraceIds:uniqueAudit,matched:auditRows===expectedAudit && uniqueAudit===auditRows};
 save(`${run}-audit-verification.json`,auditVerification);console.log('audit',auditVerification);
 if(!auditVerification.matched) {console.error('Audit reconciliation failed; retain interruption details and investigate.');process.exitCode=1;}
 if(['mixed','write','first','multi','peak-order'].includes(mode)) {
   const reconciliation={commits,versionIncrease:versionsAfter-versionsBefore,matched:commits===versionsAfter-versionsBefore};
   save(`${run}-reconciliation.json`,reconciliation);console.log('reconciliation',reconciliation);
   if(!reconciliation.matched) {console.error('Version delta differs from acknowledged commits; investigate interrupted requests before re-running.');process.exitCode=1;}
 }
 for(const key of ['http_reqs','http_req_failed','read_ms','write_ms','business_failures','data_errors','order_commits','dropped_iterations','peak_started','peak_completed','arrival_delay_ms','flow_ms']) if(summary.metrics[key]) console.log(key,summary.metrics[key].values);
 for(const [key,metric] of Object.entries(summary.metrics)) if(key.startsWith('http_req_duration{name:')) console.log(key,metric.values);
}catch {console.error('No readable summary or reconciliation; inspect execution failure.');process.exitCode=1;}
progress(code===0 && !process.exitCode?'complete':'failed');
console.log('RESULT',run,'exit',code); process.exitCode=process.exitCode || code || 0;
