// Add only fresh synthetic customers in the guarded load DB; never delete prior orders or cohorts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {guard,sql,save} from './lib.mjs';
guard();
const fixture=JSON.parse(readFileSync('outputs/load/fixture.json','utf8'));
const activity=fixture.activities.find(a=>a.code==='LOAD-1');assert.equal(activity?.id,101);
const used=new Set(sql('SELECT activity_customer_id FROM customer_order WHERE activity_id=101;').trim().split(/\s+/).map(Number));
const fresh=fixture.customers.filter(c=>c.activityId===101 && !used.has(c.id)).length;
const needed=Math.max(0,1020-fresh);assert(needed<=1020);
if(needed) {
  const first=Number(sql('SELECT GREATEST((SELECT COALESCE(MAX(id),0) FROM customer),(SELECT COALESCE(MAX(id),0) FROM activity_customer))+1;').trim());
  const [version,task]=sql("SELECT b.current_version_id,v.source_import_task_id FROM activity_data_binding b JOIN import_publish_version v ON v.id=b.current_version_id WHERE b.activity_id=101 AND b.data_type='WHITELIST';").trim().split('\t').map(Number);
  assert([first,version,task].every(Number.isSafeInteger));
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const phoneHash=value=>createHmac('sha256',Buffer.from(hash('load-only-hmac'),'hex')).update(value).digest('hex');
  const statements=['START TRANSACTION;'];const added=[];const stamp=Date.now();
  for(let n=0;n<needed;n++) {
    const id=first+n,phone=String(13900000000+id),token=randomBytes(24).toString('hex'),csrf=randomBytes(24).toString('hex');
    assert(/^1\d{10}$/.test(phone));
    statements.push(`INSERT INTO customer(id,customer_type,dealer_full_name,normalized_dealer_full_name) VALUES (${id},'SPECIAL','LOAD customer ${id}','loadcustomer${id}');`,
      `INSERT INTO activity_customer(id,activity_id,customer_id,customer_type,branch_name,normalized_branch_name,dealer_full_name,normalized_dealer_full_name,phone,phone_lookup_hash,phone_masked,source_import_task_id,data_version_id) VALUES (${id},101,${id},'SPECIAL','LOAD branch ${n%10}','loadbranch${n%10}','LOAD customer ${id}','loadcustomer${id}','${phone}',UNHEX('${phoneHash(phone)}'),'139****${phone.slice(-4)}',${task},${version});`,
      `INSERT INTO h5_session(activity_id,activity_customer_id,token_hash,csrf_token_hash,expires_at,last_seen_at) VALUES (101,${id},UNHEX('${hash(token)}'),UNHEX('${hash(csrf)}'),UTC_TIMESTAMP()+INTERVAL 2 DAY,UTC_TIMESTAMP());`);
    added.push({id,activityId:101,code:'LOAD-1',phone,csrf,cookie:`ORDER_SHOW_H5_SESSION=${token}; ORDER_SHOW_H5_CSRF=${csrf}`});
  }
  statements.push('COMMIT;');
  save(`fixture-before-extension-${stamp}.json`,fixture);
  save(`fixture-extension-${stamp}.json`,{customers:added});
  sql(statements.join('\n'));
  fixture.customers.push(...added);save('fixture.json',fixture);
}
console.log({freshBefore:fresh,added:needed,freshAfter:fresh+needed,previousOrdersPreserved:true});
