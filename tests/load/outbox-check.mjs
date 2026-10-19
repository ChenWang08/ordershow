import {sql,save} from './lib.mjs';
import assert from 'node:assert/strict';
const output=sql(`
SELECT status,COUNT(*) count,MIN(id) first_id,MAX(id) last_id FROM domain_event_outbox GROUP BY status;
SELECT COUNT(*) pending,COALESCE(MAX(TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP(3))),0) oldest_seconds FROM domain_event_outbox WHERE status='PENDING';
SELECT id,event_type,aggregate_id,status,created_at,published_at,TIMESTAMPDIFF(MICROSECOND,created_at,published_at)/1000000 delay_seconds FROM domain_event_outbox WHERE aggregate_id=(SELECT id FROM customer_order WHERE activity_customer_id=(SELECT id FROM activity_customer WHERE activity_id=101 ORDER BY id LIMIT 1 OFFSET 2401)) ORDER BY id DESC LIMIT 5;
`);
const negative=Number(sql("SELECT COUNT(*) FROM domain_event_outbox WHERE (status='PENDING' AND created_at>UTC_TIMESTAMP(3)) OR (published_at IS NOT NULL AND published_at<created_at);").trim());
assert.equal(negative,0,'Negative notification age/delay: check stored timezones before interpreting results');
const result={timestamp:new Date().toISOString(),output};save(`outbox-check-${Date.now()}.json`,result);console.log(output);
