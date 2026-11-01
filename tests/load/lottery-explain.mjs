// Run after timed traffic, only on the guarded lottery fixture.
import assert from 'node:assert/strict';
import { project, base, guard, sql, save } from './lib.mjs';
assert.equal(project,'order-show-load-lottery');
assert.equal(base,'http://127.0.0.1:8680/api/v1');
guard();
const label=process.argv[2];assert(/^(after|weighted)-200(?:-online1000)?$/.test(label||''));
// Representative generated candidate SQL for SPECIAL + P0 + V0/V4, no attendee/winner exclusion.
const query=`WITH scoped_customers AS (
  SELECT c.id,c.activity_id,c.dealer_short_name,c.dealer_full_name,c.customer_type,c.region_code,c.branch_name,c.phone_masked
  FROM activity_customer c JOIN activity_data_binding wb
    ON wb.activity_id=c.activity_id AND wb.data_type='WHITELIST' AND wb.current_version_id=c.data_version_id
  WHERE c.activity_id=101 AND c.is_active=TRUE AND c.customer_type='SPECIAL'
), scoped_orders AS (
  SELECT STRAIGHT_JOIN o.id,o.activity_customer_id,o.total_amount,o.total_quantity,o.total_tons
  FROM scoped_customers c STRAIGHT_JOIN customer_order o
    ON o.activity_id=c.activity_id AND o.activity_customer_id=c.id WHERE o.status='SUBMITTED'
), matched_items AS (
  SELECT STRAIGHT_JOIN i.order_id,SUM(i.line_amount) amount,SUM(i.quantity) boxes,
    SUM(CASE WHEN i.ton_case_factor IS NOT NULL OR i.line_tons>0 THEN i.line_tons END) tons,
    SUM(CASE WHEN i.ton_case_factor IS NULL AND (i.line_tons IS NULL OR i.line_tons=0) THEN 1 ELSE 0 END) missing_tons
  FROM scoped_orders o STRAIGHT_JOIN order_item i ON i.order_id=o.id
  WHERE 1=1 AND NULLIF(TRIM(i.product_line),'')='P0' AND NULLIF(TRIM(i.variety_name),'') IN ('V0','V4') GROUP BY i.order_id
) SELECT c.id,c.dealer_short_name,c.dealer_full_name,c.customer_type,c.region_code,c.branch_name,c.phone_masked,
  o.id,m.amount,m.boxes,m.tons,COALESCE(m.missing_tons,0)
  FROM scoped_customers c JOIN scoped_orders o ON o.activity_customer_id=c.id
  JOIN matched_items m ON m.order_id=o.id ORDER BY c.id`;
save(`${label}-plan.json`,{query,explain:sql('EXPLAIN FORMAT=JSON '+query+';'),analyze:sql('SET SESSION max_execution_time=8000; EXPLAIN ANALYZE '+query+';')});
