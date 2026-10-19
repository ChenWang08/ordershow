import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

// Fixed disposable stack only; never accepts production URLs or credentials.
const compose = ['compose','-p','order-show-ack-smoke','-f','deploy/verify/compose.yaml'];
// The optional cloud-profile probe uses a separate Redis channel; never run it as a replica.
execFileSync('docker',[...compose,'--profile','cloud-check','stop','cloud-check','redis-cloud-check'],{stdio:'pipe'});
function sql(statement) {
  return execFileSync('docker', [...compose,'exec','-T','-e','MYSQL_PWD=isolated_smoke_password','mysql',
    'mysql','-uack_smoke','-N','ack_smoke','-e',statement], {encoding:'utf8'}).trim();
}
assert.equal(sql('SELECT DATABASE()'), 'ack_smoke');
assert.equal(sql('SELECT version FROM deployment_schema_history'), 'V039');
assert.equal(sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='flyway_schema_history'"), '0');
const bases=['http://127.0.0.1:18081/api/v1','http://127.0.0.1:18082/api/v1'];
let cookie='',csrf='';
async function call(replica, method, path, body, expected=200, extraHeaders={}) {
  const multipart = body instanceof FormData;
  const response=await fetch(bases[replica]+path,{method,headers:{Cookie:cookie,'X-CSRF-Token':csrf,...extraHeaders,...(multipart?{}:{'Content-Type':'application/json'})},body:body==null?undefined:multipart?body:JSON.stringify(body)});
  const result=await response.json();
  assert.equal(response.status,expected,JSON.stringify(result));
  if(response.headers.getSetCookie().length) cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  return result.data;
}
let login;
try { login=await call(0,'POST','/admin/auth/login',{username:'smoke_admin',password:'SmokeInitial123!'}); }
catch { login=await call(0,'POST','/admin/auth/login',{username:'smoke_admin',password:'SmokeChanged456!'}); }
csrf=login.csrfToken;
assert.equal((await call(1,'GET','/admin/me')).username,'smoke_admin');
if(login.mustChangePassword) await call(1,'POST','/admin/auth/change-password',{currentPassword:'SmokeInitial123!',newPassword:'SmokeChanged456!'});
assert.equal((await call(0,'GET','/admin/me')).mustChangePassword,false);
const activity=await call(0,'POST','/admin/activities',{
  name:'ACK replica verification',departmentId:1,timezone:'Asia/Shanghai',customerScope:'ALL',
  startsAt:new Date(Date.now()+3600000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),
  eventEndsAt:new Date(Date.now()+172800000).toISOString(),companyRankingTopN:20,branchRankingTopN:20,tonDisplayScale:3,
});
// MySQL defaults to +08:00 and replica B uses an Asia/Shanghai JVM.
// API instants and database default timestamps must still represent UTC.
assert.equal((await call(1,'GET',`/admin/activities/${activity.id}`)).startsAt,activity.startsAt);
assert.ok(activity.startsAt.endsWith('Z'));
assert.ok(Math.abs(Number(sql(`SELECT TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP(3)) FROM activity WHERE id=${Number(activity.id)}`))) < 60,'new default timestamp must use UTC');
console.log('PASS: UTC API round trip across replicas and UTC database default under +08:00 server.');
// New merged features must work through either replica and shared object storage.
const backgroundBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=','base64');
const backgroundForm=new FormData();
backgroundForm.set('file',new Blob([backgroundBytes],{type:'image/png'}),'smoke.png');
await call(0,'POST',`/admin/activities/${activity.id}/backgrounds/h5`,backgroundForm);
const backgroundId=sql(`SELECT h5_background_file_id FROM activity WHERE id=${Number(activity.id)}`);
const backgroundRead=await fetch(bases[1]+`/public/files/${backgroundId}`);
assert.equal(backgroundRead.status,200);
assert.deepEqual(Buffer.from(await backgroundRead.arrayBuffer()),backgroundBytes);
await call(1,'DELETE',`/admin/activities/${activity.id}/backgrounds/h5`);
assert.equal(sql(`SELECT COUNT(*) FROM activity WHERE id=${Number(activity.id)} AND h5_background_file_id IS NULL`),'1');
const form=new FormData();
form.set('importType','PRODUCT');
const bytes=await fs.readFile('public/import-template-products.xlsx');
form.set('file',new Blob([bytes]),'products.xlsx');
const task=await call(0,'POST',`/admin/activities/${activity.id}/imports`,form,201);
assert.equal((await call(1,'GET',`/admin/activities/${activity.id}/imports/${task.id}`)).id,task.id);
const fileId=sql(`SELECT source_file_id FROM import_task WHERE id=${Number(task.id)}`);
const downloaded=await fetch(bases[1]+`/public/files/${fileId}`,{headers:{Cookie:cookie}});
assert.equal(downloaded.status,200);
assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
assert.equal((await fetch(bases[1]+`/public/files/${fileId}`)).status,401);

// Two schedulers race to claim the same task; publication must happen exactly once.
await call(1,'POST',`/admin/activities/${activity.id}/imports/${task.id}/confirm`,new FormData(),202);
let completed=false;
for(let i=0;i<30;i++) {
  const state=await call(i%2,'GET',`/admin/activities/${activity.id}/imports/${task.id}`);
  if(state.status==='COMPLETED'){completed=true;break;}
  assert.notEqual(state.status,'FAILED',JSON.stringify(state));
  await delay(1000);
}
assert.ok(completed,'import published by one of the two workers');
assert.equal(sql(`SELECT COUNT(*) FROM import_publish_version WHERE source_import_task_id=${Number(task.id)}`),'1');

sql(`UPDATE activity SET status='CLOSED',starts_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 HOUR),ends_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR) WHERE id=${Number(activity.id)}`);
const beforeReopen=await call(0,'GET',`/admin/activities/${activity.id}`);
const reopenBody={endsAt:new Date(Date.now()+86400000).toISOString(),eventEndsAt:new Date(Date.now()+172800000).toISOString(),reason:'ACK isolated verification'};
const reopened=await call(1,'POST',`/admin/activities/${activity.id}/reopen`,reopenBody,200,{'If-Match':String(beforeReopen.version)});
assert.equal(reopened.status,'ACTIVE');
await call(0,'POST',`/admin/activities/${activity.id}/reopen`,reopenBody,409,{'If-Match':String(beforeReopen.version)});
assert.equal(sql(`SELECT COUNT(*) FROM domain_event_outbox WHERE activity_id=${Number(activity.id)} AND event_type='ACTIVITY_REOPENED'`),'1');
console.log('PASS: cross-replica activity background upload/read/reset and reopen/stale request protection.');
sql(`UPDATE activity SET status='ACTIVE',starts_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),ends_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY) WHERE id=${Number(activity.id)}`);
const aborts=bases.map(()=>new AbortController());
try {
  const streams=await Promise.all(bases.map((base,i)=>fetch(base+`/screen/activities/${activity.code}/events`,{signal:aborts[i].signal})));
  for(const response of streams) assert.equal(response.status,200);
  const readers=streams.map(r=>r.body.getReader());
  await Promise.all(readers.map(r=>r.read()));
  sql(`INSERT INTO domain_event_outbox(activity_id,aggregate_type,aggregate_id,event_type,payload_json,available_at) VALUES (${Number(activity.id)},'SMOKE','replica','ACK_REPLICA_PROBE','{}',UTC_TIMESTAMP(3))`);
  const observed=readers.map(async reader=>{
    let content='';
    while(!content.includes('ACK_REPLICA_PROBE')) {
      const {value,done}=await reader.read(); if(done) throw new Error('SSE ended before event');
      content+=new TextDecoder().decode(value);
    }
  });
  await Promise.race([Promise.all(observed),delay(10000).then(()=>{throw new Error('Cross-replica notification timeout');})]);
} finally {aborts.forEach(a=>a.abort());}

execFileSync('docker',[...compose,'restart','backend-b'],{stdio:'pipe'});
let ready=false;
for(let i=0;i<60;i++) {
  try { if((await fetch(bases[1]+'/actuator/health/readiness')).ok){ready=true;break;} }catch{}
  await delay(1000);
}
assert.ok(ready,'restarted replica ready');
assert.equal((await call(1,'GET','/admin/me')).username,'smoke_admin');
console.log('PASS: DBA SQL, disabled Flyway, cross-replica session/CSRF, MinIO upload/download/private-file protection, single import publication with two schedulers, Redis SSE fanout, replica restart/session survival.');
