// Extend only existing synthetic sessions/activity windows in the guarded load database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {guard,sql,save} from './lib.mjs';
guard();
const fixture=JSON.parse(readFileSync('outputs/load/fixture.json','utf8'));
assert(fixture.customers.length>=2500);
assert.deepEqual(fixture.activities.map(activity=>activity.code).sort(),['LOAD-1','LOAD-2']);
const before=sql(`SELECT COUNT(*),SUM(expires_at<=UTC_TIMESTAMP(3)),COUNT(DISTINCT activity_customer_id) FROM h5_session;
SELECT COUNT(*) FROM customer_order; SELECT COUNT(*) FROM order_version;`);
const ids=fixture.customers.map(customer=>customer.id);
assert(ids.every(Number.isSafeInteger));assert.equal(new Set(ids).size,ids.length);
let changed=0;
const activityBefore=sql("SELECT activity_code,status,ends_at,event_ends_at FROM activity WHERE activity_code IN ('LOAD-1','LOAD-2') ORDER BY activity_code;").trim().split('\n');
sql(`UPDATE activity SET status='ACTIVE',closed_at=NULL,ends_at=UTC_TIMESTAMP(3)+INTERVAL 2 DAY,
  event_ends_at=UTC_TIMESTAMP(3)+INTERVAL 3 DAY
  WHERE id IN (101,102) AND activity_code IN ('LOAD-1','LOAD-2');`);
for(let start=0;start<ids.length;start+=1000) {
  changed+=Number(sql(`UPDATE h5_session SET expires_at=UTC_TIMESTAMP(3)+INTERVAL 2 DAY
    WHERE revoked_at IS NULL AND activity_customer_id IN (${ids.slice(start,start+1000).join(',')}); SELECT ROW_COUNT();`).trim());
}
const after=sql(`SELECT COUNT(*),SUM(expires_at<=UTC_TIMESTAMP(3)),COUNT(DISTINCT activity_customer_id) FROM h5_session;
SELECT COUNT(*) FROM customer_order; SELECT COUNT(*) FROM order_version;`);
const beforeLines=before.trim().split('\n'),afterLines=after.trim().split('\n');
assert.equal(afterLines[0].split('\t')[0],beforeLines[0].split('\t')[0]);
assert.equal(Number(afterLines[0].split('\t')[1]),0);assert.deepEqual(afterLines.slice(1),beforeLines.slice(1));
const result={timestamp:new Date().toISOString(),fixtureCustomers:ids.length,extended:changed,before:beforeLines,after:afterLines,
  activityBefore,activityAfter:sql("SELECT activity_code,status,ends_at,event_ends_at FROM activity WHERE activity_code IN ('LOAD-1','LOAD-2') ORDER BY activity_code;").trim().split('\n'),
  scope:'Existing synthetic load sessions and LOAD-1/LOAD-2 windows only; tokens/orders/versions unchanged'};
save(`session-renewal-${Date.now()}.json`,result);console.log(result);
