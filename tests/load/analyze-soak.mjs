import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {save} from './lib.mjs';
import {assessSoakDuration} from './soak-duration.mjs';
const run=process.argv[2];assert(/^[\w-]+$/.test(run || ''));
const read=name=>JSON.parse(readFileSync(`outputs/load/${name}.json`,'utf8'));
const summary=read(run),monitor=read(run+'-monitor'),reconciliation=read(run+'-reconciliation');
const value=(point,name,stat='VALUE')=>point.values.find(v=>v.name===name)?.value?.measurements.find(m=>m.statistic===stat)?.value;
const samples=monitor.metrics;
const values=(name,stat)=>samples.map(p=>value(p,name,stat)).filter(Number.isFinite);
const range=xs=>xs.length?{min:Math.min(...xs),max:Math.max(...xs),mean:xs.reduce((s,v)=>s+v,0)/xs.length}:null;
const elapsed=summary.state.testRunDurationMs;
const m=summary.metrics;
const durationVerdict=assessSoakDuration(monitor.config,summary);
const report={run,config:monitor.config,durationMs:elapsed,fullHour:durationVerdict.accepted,durationVerdict,
  thresholdsPassed:Object.values(m).every(v=>Object.values(v.thresholds || {}).every(t=>t.ok)),
  requests:m.http_reqs.values,iterations:m.iterations.values,commits:m.order_commits.values,dropped:m.dropped_iterations?.values,
  httpFailures:m.http_req_failed.values,dataErrors:m.data_errors.values,readMs:m.read_ms.values,writeMs:m.write_ms.values,
  reconciliation,samples:samples.length,unavailableSamples:samples.filter(p=>p.values.some(v=>v.unavailable || v.status!==200)).length,
  jvmMiB:range(values('jvm.memory.used').map(v=>v/1048576)),activeConnections:range(values('hikaricp.connections.active')),
  waitingConnections:range(values('hikaricp.connections.pending')),gcMaxMs:Math.max(...values('jvm.gc.pause','MAX'))*1000,
  gcCountDelta:values('jvm.gc.pause','COUNT').at(-1)-values('jvm.gc.pause','COUNT')[0],
  gcPauseSecondsDelta:values('jvm.gc.pause','TOTAL_TIME').at(-1)-values('jvm.gc.pause','TOTAL_TIME')[0],windows:[]};
for(let bucket=0;bucket<6;bucket++) {
 const points=samples.filter(p=>{const age=Date.parse(p.time)-Date.parse(monitor.start);return age>=bucket*600000 && age<(bucket+1)*600000;});
 report.windows.push({minutes:`${bucket*10}-${(bucket+1)*10}`,samples:points.length,jvmMiB:range(points.map(p=>value(p,'jvm.memory.used')/1048576).filter(Number.isFinite)),maxWaiting:Math.max(0,...points.map(p=>value(p,'hikaricp.connections.pending')).filter(Number.isFinite))});
}
report.passed=report.fullHour && report.thresholdsPassed && reconciliation.matched && monitor.code===0;
save(`${run}-analysis.json`,report);console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
