import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import JSZip from 'jszip';

// Hard-coded disposable ACK stack. Never accepts a business URL or database.
assert(process.argv.includes('--ack-smoke'));
const compose=['compose','-p','order-show-ack-smoke','-f','deploy/verify/compose.yaml'];
const database=execFileSync('docker',[...compose,'exec','-T','-e','MYSQL_PWD=isolated_smoke_password','mysql','mysql','-uack_smoke','-N','ack_smoke','-e','SELECT DATABASE()'],{encoding:'utf8'}).trim();
assert.equal(database,'ack_smoke');
const bases=['http://127.0.0.1:18081/api/v1','http://127.0.0.1:18082/api/v1'];
async function call(replica, session, method, path, body, expected=200) {
  const multipart=body instanceof FormData;
  const response=await fetch(bases[replica]+path,{method,headers:{Cookie:session.cookie??'','X-CSRF-Token':session.csrf??'',...(multipart?{}:{'Content-Type':'application/json'})},body:body==null?undefined:multipart?body:JSON.stringify(body)});
  const result=await response.json();
  assert.equal(response.status,expected,`${method} ${path}: ${JSON.stringify(result)}`);
  if(response.headers.getSetCookie().length) session.cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  return result;
}
const admin={};
let login;
try { login=await call(0,admin,'POST','/admin/auth/login',{username:'smoke_admin',password:'SmokeInitial123!'}); }
catch { login=await call(0,admin,'POST','/admin/auth/login',{username:'smoke_admin',password:'SmokeChanged456!'}); }
admin.csrf=login.data.csrfToken;
if(login.data.mustChangePassword) await call(0,admin,'POST','/admin/auth/change-password',{currentPassword:'SmokeInitial123!',newPassword:'SmokeChanged456!'});
const activity=(await call(0,admin,'POST','/admin/activities',{name:`ACK roster pagination ${Date.now()}`,departmentId:1,timezone:'Asia/Shanghai',customerScope:'ALL',startsAt:new Date(Date.now()+86400000).toISOString(),endsAt:new Date(Date.now()+172800000).toISOString(),eventEndsAt:new Date(Date.now()+259200000).toISOString(),companyRankingTopN:90,branchRankingTopN:30,tonDisplayScale:3})).data;
assert(Number.isSafeInteger(activity.id));
const path=`/admin/activities/${activity.id}`;
const xml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
async function workbook(kind,count) {
  const zip=await JSZip.loadAsync(await readFile(`public/import-template-${kind}.xlsx`));
  let sheet=await zip.file('xl/worksheets/sheet1.xml').async('string');
  const header=sheet.match(/<row\b[^>]*r="1"[^>]*>[\s\S]*?<\/row>/)[0];
  let rows=header;
  for(let i=1;i<=count;i++) {
    const n=kind==='attendance' && i===5005 ? 5003 : i;
    const values=kind==='whitelist' ? [i%2?'综合客户':'特渠专业客户','华东',`ACK分公司${i%7}`,`客户${i}`,`ACK分页客户${i}有限公司`,`联系人${i}`,'138'+String(i).padStart(8,'0'),'确认人','13900000001']
      : [`ACK分公司${n%7}`,`参会人${i}`,i%2?'男':'女','137'+String(i).padStart(8,'0'),i===5006?'':n%2?'综合经销商':'特渠专业经销商',i===5006?'未关联测试客户':`ACK分页客户${n}有限公司`];
    rows+=`<row r="${i+1}">`+values.map((v,index)=>`<c r="${String.fromCharCode(65+index)}${i+1}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`).join('')+'</row>';
  }
  sheet=sheet.replace(/<sheetData>[\s\S]*?<\/sheetData>/,`<sheetData>${rows}</sheetData>`).replace(/<dimension[^>]*\/>/,`<dimension ref="A1:${kind==='whitelist'?'I':'F'}${count+1}"/>`);
  zip.file('xl/worksheets/sheet1.xml',sheet);
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
async function publish(type,bytes) {
  const form=new FormData(); form.set('importType',type); form.set('file',new Blob([bytes]),`roster-${type}.xlsx`);
  const task=(await call(0,admin,'POST',path+'/imports',form,201)).data;
  assert.equal(task.errorCount,0,JSON.stringify(task));
  let body;
  if(type==='ATTENDANCE') {
    const match=(await call(1,admin,'GET',`${path}/imports/${task.id}/attendance-match-preview`)).data;
    body=new FormData(); body.set('attendanceWhitelistVersionId',String(match.whitelistVersionId));
  }
  await call(1,admin,'POST',`${path}/imports/${task.id}/confirm`,body,202);
  for(let i=0;i<90;i++) {
    const current=(await call(i%2,admin,'GET',`${path}/imports/${task.id}`)).data;
    if(current.status==='COMPLETED') return;
    assert(!['FAILED','CANCELLED'].includes(current.status),JSON.stringify(current)); await delay(1000);
  }
  throw new Error('isolated import did not complete');
}
await publish('WHITELIST',await workbook('whitelist',5006));
await publish('ATTENDANCE',await workbook('attendance',5006));
const emptyFilters={customerType:'',branch:'',status:'',matchStatus:'',keyword:''};
const roster=(kind,query='',replica=0)=>call(replica,admin,'GET',`${path}/${kind}/page?${query}`);
for(const kind of ['customers','attendees']) {
  const first=await roster(kind,'page=1&size=50');
  assert.equal(first.data.length,50); assert.equal(first.page.totalElements,5006); assert.equal(first.page.totalPages,101);
  assert.equal(first.summary.total,5006); assert.equal(first.summary.published,1);
  const second=await roster(kind,'page=2&size=50',1);
  assert(!second.data.some(r=>first.data.some(f=>f.id===r.id)));
  assert.equal((await roster(kind,'page=101&size=50')).data.length,6);
  assert.equal((await roster(kind,'page=251&size=20')).data.length,6);
  assert.equal((await roster(kind,'page=51&size=100')).data.length,6);
  assert.equal((await roster(kind,'size=10000')).data.length,100);
  const noMatches=await roster(kind,'keyword=no-such-roster-customer');
  assert.equal(noMatches.data.length,0); assert.equal(noMatches.summary.total,5006);
}
assert.equal((await roster('customers','customerType=SPECIAL')).page.totalElements,2503);
assert.equal((await roster('customers','keyword='+encodeURIComponent('联系人5006'))).page.totalElements,1);
assert.equal((await roster('customers','keyword=13800005006')).data[0].dealerFullName,'ACK分页客户5006有限公司');
assert.equal((await roster('customers','status='+encodeURIComponent('待处理'))).page.totalElements,0);
const attendees=await roster('attendees','matchStatus=UNMATCHED');
assert.equal(attendees.page.totalElements,1); assert.equal(attendees.summary.linked,5005); assert.equal(attendees.summary.eligible,5004);
assert.equal(attendees.summary.blankType,1); assert.equal(attendees.branches.length,7);
const branch=await roster('attendees','branch='+encodeURIComponent('ACK分公司3')+'&customerType=GENERAL');
assert(branch.data.every(r=>r.branchName==='ACK分公司3' && r.participantType.includes('综合')));
console.log('PASS: 5006 rows per roster, page sizes, stable pages, full summaries, phone/name searches and global filter options.');

// Preview on A, change a selected row, then attempt deletion on B: no silent deletion.
let first=await roster('customers','page=1&size=50');
const all={filters:emptyFilters,rows:null};
const before=(await call(0,admin,'POST',path+'/customers/deletion-preview',all)).data;
const customer=first.data[0];
await call(1,admin,'PUT',`${path}/customers/${customer.id}`,{customerType:customer.customerType,branchName:customer.branchName,dealerShortName:customer.dealerShortName+'改',dealerFullName:customer.dealerFullName,phone:customer.phone,expectedVersion:customer.lockVersion});
await call(1,admin,'POST',path+'/customers/batch-delete',{...all,snapshot:before.snapshot},409);
await call(0,admin,'POST',path+'/customers/deletion-preview',{filters:emptyFilters,rows:[{id:customer.id,revision:first.revisions[customer.id]}]},409);
assert.equal((await roster('customers')).summary.total,5006);
first=await roster('customers','page=1&size=50'); const second=await roster('customers','page=2&size=50');
const selection={filters:emptyFilters,rows:[first,second].map(p=>({id:p.data[0].id,revision:p.revisions[p.data[0].id]}))};
const checked=(await call(0,admin,'POST',path+'/customers/deletion-preview',selection)).data;
assert.equal(checked.count,2);
assert.equal((await call(1,admin,'POST',path+'/customers/batch-delete',{...selection,snapshot:checked.snapshot})).data,2);
assert.equal((await roster('customers')).summary.total,5004);
const last=await roster('customers','page=101&size=50');
const lastSelection={filters:emptyFilters,rows:last.data.map(r=>({id:r.id,revision:last.revisions[r.id]}))};
const lastPreview=(await call(1,admin,'POST',path+'/customers/deletion-preview',lastSelection)).data;
await call(0,admin,'POST',path+'/customers/batch-delete',{...lastSelection,snapshot:lastPreview.snapshot});
assert.equal((await roster('customers','page=101&size=50')).page.number,100);
console.log('PASS: cross-replica snapshot conflicts, explicit stale versions, cross-page selection and deleted-last-page clamping.');

// Selected result sets remain scoped to the confirmed filters.
const filtered={filters:{...emptyFilters,branch:'ACK分公司3'},rows:null};
const filterPreview=(await call(0,admin,'POST',path+'/attendees/deletion-preview',filtered)).data;
const previous=(await roster('attendees')).summary.total;
assert.equal((await call(1,admin,'POST',path+'/attendees/batch-delete',{...filtered,snapshot:filterPreview.snapshot})).data,filterPreview.count);
assert.equal((await roster('attendees')).summary.total,previous-filterPreview.count);
assert.equal((await roster('attendees','branch='+encodeURIComponent('ACK分公司3'))).page.totalElements,0);
console.log('PASS: select-all filtered deletion only removes confirmed matches.');
await mkdir('outputs/roster-pagination',{recursive:true});
await writeFile('outputs/roster-pagination/fixture.json',JSON.stringify({activityId:activity.id,activityCode:activity.code,activityName:activity.name,customerCount:(await roster('customers')).summary.total,attendeeCount:(await roster('attendees')).summary.total},null,2));
console.log('PASS: isolated roster HTTP verification complete. Fixture saved for browser regression.');
