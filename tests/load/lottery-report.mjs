import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
const root='outputs/load-lottery';
const labels=['baseline-100','before-100','after-100','baseline-200','before-200','after-200','after-200-online1000','baseline-200-online1000','weighted-baseline-200-online1000','weighted-200-online1000'];
function status(text){return Object.fromEntries(text.trim().split('\n').map(s=>s.split('\t')).map(([k,v])=>[k,Number(v)]));}
function peak(r,name){const values=r.metrics.flatMap(s=>s.values.filter(v=>v.name===name).flatMap(v=>v.data?.measurements||[]).map(m=>m.value));return values.length?Math.max(...values):null;}
const reports=labels.filter(label=>existsSync(`${root}/${label}.json`)).map(label=>{
  const r=JSON.parse(readFileSync(`${root}/${label}.json`,'utf8'));assert.equal(r.label,label);assert(r.consistent);
  const before=status(r.database_before),after=status(r.database_after);
  const obs=JSON.parse(readFileSync(`${root}/${label}-requests.json`,'utf8'));
  const range=name=>{const v=obs.filter(o=>o.step===name).map(o=>o.ms);return v.length?{samples:v.length,min_ms:Math.min(...v),max_ms:Math.max(...v)}:null;};
  return {label,config:r.config,submitted:r.submitted,increased:r.increased,requests:obs.length,streams:r.streamsOpened,
    errors:r.errors.length,consistent:r.consistent,timings:r.timings,
    draw:range('draw'),filtered_draw:range('filtered_draw'),preview:range('preview'),filtered_preview:range('filtered_preview'),
    db_lock_waits:after.Innodb_row_lock_waits-before.Innodb_row_lock_waits,
    db_lock_time_ms:after.Innodb_row_lock_time-before.Innodb_row_lock_time,
    pool_active_peak:peak(r,'hikaricp.connections.active'),pool_pending_peak:peak(r,'hikaricp.connections.pending'),
    h5_waiting_peak:peak(r,'order_show.h5.write.admission.waiting'),backend_cpu_peak:peak(r,'process.cpu.usage'),
    reconciliation:r.reconciliation};
});
writeFileSync(`${root}/comparison.json`,JSON.stringify(reports,null,2));
console.log(JSON.stringify(reports.map(r=>({label:r.label,submit_p95:r.timings.submit?.p95_ms,burst_p95:r.timings.burst_submit?.p95_ms,
  increase_p95:r.timings.existing_increase?.p95_ms,draw:r.draw,filtered_draw:r.filtered_draw,
  pool_pending:r.pool_pending_peak,locks:r.db_lock_waits,lock_ms:r.db_lock_time_ms,errors:r.errors,consistent:r.consistent})),null,2));
