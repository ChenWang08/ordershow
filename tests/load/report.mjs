import {readdirSync,readFileSync} from 'node:fs';
import {save} from './lib.mjs';
const rows=[];
for(const name of readdirSync('outputs/load')) {
 if(!/^(read|write|first|mixed|multi|dashboard|verify|peak-entry|peak-order)-\d+-\d+\.json$/.test(name)) continue;
 const x=JSON.parse(readFileSync(`outputs/load/${name}`,'utf8')); const m=x.metrics;
 const monitorName=name.replace('.json','-monitor.json');
 let monitor;try{monitor=JSON.parse(readFileSync(`outputs/load/${monitorName}`,'utf8'));}catch{/* Older/raw run. */}
 const peaks={};
 for(const s of monitor?.metrics || []) for(const value of s.values) {
  const measurement=value.value?.measurements?.find(v=>v.statistic==='VALUE');
  if(measurement) peaks[value.name]=Math.max(peaks[value.name] || 0,measurement.value);
 }
 rows.push({file:name,config:monitor?.config || null,passed:Object.values(m).every(v=>Object.values(v.thresholds || {}).every(t=>t.ok)),
 requests:m.http_reqs?.values.count,rps:m.http_reqs?.values.rate,error:m.http_req_failed?.values.rate,
 readP95:m.read_ms?.values['p(95)'],writeP95:m.write_ms?.values['p(95)'],
 readP99:m.read_ms?.values['p(99)'],writeP99:m.write_ms?.values['p(99)'],
 commits:m.order_commits?.values.count,commitsPerSecond:m.order_commits?.values.rate,
 dataErrors:m.data_errors?.values.rate,dropped:m.dropped_iterations?.values.count || 0,peaks});
}
save('summary.json',rows);
console.table(rows.map(({file,passed,requests,rps,error,readP95,writeP95,commitsPerSecond})=>({file,passed,requests,rps,error,readP95,writeP95,commitsPerSecond})));
