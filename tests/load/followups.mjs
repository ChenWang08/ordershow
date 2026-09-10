// Independent diagnostic suites after the mixed-load stage fails. Sequential to avoid contamination.
import {spawn} from 'node:child_process';
import {save,guard} from './lib.mjs';
guard();
const results=[];
async function run(script,args=[],extra={}) {
 const start=Date.now();
 const child=spawn(process.execPath,[`tests/load/${script}.mjs`,...args],{stdio:'inherit',windowsHide:true,env:{...process.env,...extra}});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 results.push({script,args,extra,code,elapsedMs:Date.now()-start});save('followups.json',results);
 return code===0;
}
if(!await run('verify')) throw Error('Correctness gate failed');
for(const [vus,offset] of [[5,1000],[50,1005],[100,1055]]) {
 if(!await run('run',['first',String(vus),'2m'],{OFFSET:String(offset)})) break;
}
// Same low concurrency, fresh users, varied payload lengths; these are small diagnostic samples.
for(const [items,offset] of [[1,1200],[50,1210]]) await run('run',['first','5','2m'],{OFFSET:String(offset),ITEMS:String(items)});
if(!await run('verify')) throw Error('Correctness gate failed');
await run('run',['dashboard','10','2m']);
await run('run',['multi','10','2m'],{OFFSET:'2000'});
if(!await run('verify')) throw Error('Correctness gate failed');
for(const [rate,vus,offset] of [[5,20,1500],[10,30,1800]]) {
 if(!await run('run',['mixed',String(vus),'3m'],{RATE:String(rate),OFFSET:String(offset)})) break;
}
if(!await run('verify')) throw Error('Correctness gate failed');
for(const n of [50,100]) await run('sse',[String(n)]);
for(const service of ['redis','backend']) if(!await run('recovery',[service])) throw Error('Recovery failed');
if(!await run('verify')) throw Error('Final correctness gate failed');
await run('diagnose');await run('report');
console.log('Independent diagnostics complete. Review failed thresholds in followups.json.');
process.exitCode=results.some(r=>r.code!==0)?1:0;
