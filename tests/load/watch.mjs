import {readFileSync} from 'node:fs';
const run=process.argv[2];
if(!/^[\w-]+$/.test(run || ''))throw Error('Pass the run ID printed by run.mjs');
const p=JSON.parse(readFileSync(`outputs/load/${run}-progress.json`,'utf8'));
function metric(name,statistic='VALUE') {return p.latestMetrics?.values.find(v=>v.name===name)?.value?.measurements.find(m=>m.statistic===statistic)?.value;}
console.log({run,stage:p.stage,minutes:Math.round(p.elapsedSeconds/6)/10,sampledAt:p.latestMetrics?.time,
  jvmMiB:Math.round((metric('jvm.memory.used') || 0)/1048576),activeConnections:metric('hikaricp.connections.active'),
  waitingConnections:metric('hikaricp.connections.pending'),gcMaxMs:Math.round((metric('jvm.gc.pause','MAX') || 0)*1000),
  unavailableMetrics:p.latestMetrics?.values.filter(v=>v.unavailable || v.status!==200).map(v=>v.name)});
