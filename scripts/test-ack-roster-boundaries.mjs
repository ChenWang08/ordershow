import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

assert(process.argv.includes('--ack-smoke'));
const compose=['compose','-p','order-show-ack-smoke','-f','deploy/verify/compose.yaml'];
function sql(statement) { return execFileSync('docker',[...compose,'exec','-T','-e','MYSQL_PWD=isolated_smoke_password','mysql','mysql','-uack_smoke','-N','ack_smoke','-e',statement],{encoding:'utf8'}).trim(); }
assert.equal(sql('SELECT DATABASE()'),'ack_smoke');
const fixture=JSON.parse(await readFile('outputs/roster-pagination/fixture.json','utf8'));
const bases=['http://127.0.0.1:18081/api/v1','http://127.0.0.1:18082/api/v1'];
async function call(session,method,path,body,expected=200,replica=0) {
  const multipart=body instanceof FormData;
  const response=await fetch(bases[replica]+path,{method,headers:{Cookie:session.cookie??'','X-CSRF-Token':session.csrf??'',...(multipart?{}:{'Content-Type':'application/json'})},body:body==null?undefined:multipart?body:JSON.stringify(body)});
  const data=await response.json(); assert.equal(response.status,expected,JSON.stringify(data));
  if(response.headers.getSetCookie().length) session.cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  return data;
}
async function login(username,password) { const session={}; session.csrf=(await call(session,'POST','/admin/auth/login',{username,password})).data.csrfToken; return session; }
const admin=await login('smoke_admin','SmokeChanged456!'), stamp=Date.now();
const memberName=`roster_member_${stamp}`;
await call(admin,'POST','/admin/members',{username:memberName,displayName:'ACK分页权限测试',password:'RosterTest123!',departmentId:1,permissions:['ATTENDANCE']});
const member=await login(memberName,'RosterTest123!');
const currentPath=`/admin/activities/${fixture.activityId}`;
await call(member,'GET',currentPath+'/attendees/page');
await call(member,'GET',currentPath+'/customers/page',undefined,403);
for(const suffix of ['deletion-preview','batch-delete']) await call(member,'POST',currentPath+'/customers/'+suffix,{rows:null},403);
const deptUser=`roster_dept_${stamp}`;
await call(admin,'POST','/admin/departments',{name:`ACK分页隔离部门${stamp}`,username:deptUser,password:'RosterTest123!'});
const other=await login(deptUser,'RosterTest123!');
for(const kind of ['customers','attendees']) {
  await call(other,'GET',`${currentPath}/${kind}/page`,undefined,404);
  for(const suffix of ['deletion-preview','batch-delete']) await call(other,'POST',`${currentPath}/${kind}/${suffix}`,{rows:null},404);
}
console.log('PASS: module permissions and cross-department isolation for pages, previews and batch deletion.');

const activity=(await call(admin,'POST','/admin/activities',{name:`ACK分页清空测试${stamp}`,departmentId:1,timezone:'Asia/Shanghai',customerScope:'ALL',startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+172800000).toISOString(),eventEndsAt:new Date(Date.now()+259200000).toISOString(),companyRankingTopN:90,branchRankingTopN:30,tonDisplayScale:3})).data;
assert(Number.isSafeInteger(activity.id));
const path=`/admin/activities/${activity.id}`;
for(const [kind,type] of [['whitelist','WHITELIST'],['attendance','ATTENDANCE']]) {
  const form=new FormData(); form.set('importType',type); form.set('file',new Blob([await readFile(`public/import-template-${kind}.xlsx`)]),`${kind}.xlsx`);
  const task=(await call(admin,'POST',path+'/imports',form,201)).data;
  assert.equal(task.errorCount,0); let body;
  if(type==='ATTENDANCE') {
    const match=(await call(admin,'GET',`${path}/imports/${task.id}/attendance-match-preview`)).data;
    body=new FormData(); body.set('attendanceWhitelistVersionId',String(match.whitelistVersionId));
  }
  await call(admin,'POST',`${path}/imports/${task.id}/confirm`,body,202);
  for(let i=0;i<60;i++) {
    const state=(await call(admin,'GET',`${path}/imports/${task.id}`)).data;
    if(state.status==='COMPLETED') break;
    assert(!['FAILED','CANCELLED'].includes(state.status),JSON.stringify(state)); assert(i<59); await delay(1000);
  }
}
const all={filters:{customerType:'',branch:'',status:'',matchStatus:'',keyword:''},rows:null};
for(const kind of ['customers','attendees']) {
  const initial=await call(admin,'GET',`${path}/${kind}/page`);
  if(kind==='attendees') {
    const preview=(await call(admin,'POST',`${path}/${kind}/deletion-preview`,all)).data;
    const row=initial.data[0], seconds=Date.parse(row.updatedAt)/1000;
    assert(Number.isFinite(seconds) && Number.isSafeInteger(row.id));
    sql(`SET time_zone='+00:00'; SET timestamp=${seconds}; UPDATE activity_attendee SET participant_name='same-timestamp-revision' WHERE activity_id=${activity.id} AND id=${row.id}`);
    const updated=await call(admin,'GET',`${path}/${kind}/page`);
    assert.equal(updated.data[0].updatedAt,row.updatedAt,'fixture must preserve the timestamp exactly');
    await call(admin,'POST',`${path}/${kind}/batch-delete`,{...all,snapshot:preview.snapshot},409,1);
    assert.equal(updated.summary.total,initial.summary.total);
  }
  const excludedId=initial.data[0].id;
  const excludedSelection={...all,excludedIds:[excludedId]};
  const excludedPreview=(await call(admin,'POST',`${path}/${kind}/deletion-preview`,excludedSelection)).data;
  assert.equal(excludedPreview.count,initial.summary.total-1);
  assert.equal((await call(admin,'POST',`${path}/${kind}/batch-delete`,{...excludedSelection,snapshot:excludedPreview.snapshot},200,1)).data,excludedPreview.count);
  const retained=await call(admin,'GET',`${path}/${kind}/page`);
  assert.equal(retained.summary.total,1); assert.equal(retained.data[0].id,excludedId);
  const before=(await call(admin,'POST',`${path}/${kind}/deletion-preview`,all)).data;
  assert(before.count>0);
  assert.equal((await call(admin,'POST',`${path}/${kind}/batch-delete`,{...all,snapshot:before.snapshot})).data,before.count);
  const after=await call(admin,'GET',`${path}/${kind}/page`);
  assert.equal(after.summary.total,0); assert.equal(after.summary.published,1); assert.equal(after.data.length,0);
  await call(admin,'POST',`${path}/${kind}/batch-delete`,{...all,snapshot:before.snapshot},409);
}
// Change only this test-created activity in the fixed disposable database.
sql(`UPDATE activity SET status='CLOSED' WHERE id=${activity.id}`);
for(const kind of ['customers','attendees']) {
  const denied=await call(admin,'POST',`${path}/${kind}/batch-delete`,{...all,snapshot:'old'},409);
  assert.equal(denied.code,'ACTIVITY_READ_ONLY');
}
console.log('PASS: same-timestamp edits conflict, cross-replica select-all exclusions, clear-all preserves published empty lists, duplicate confirmations conflict, closed activities reject deletion.');
