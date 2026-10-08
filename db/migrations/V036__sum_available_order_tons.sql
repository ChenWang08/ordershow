-- Use saved line values only; never reprice or read current catalog factors.
UPDATE order_item SET line_tons = 0, updated_at = updated_at WHERE line_tons IS NULL;
UPDATE order_version_item SET line_tons = 0 WHERE line_tons IS NULL;

UPDATE customer_order o LEFT JOIN (
  SELECT order_id, SUM(line_tons) tons FROM order_item GROUP BY order_id
) i ON i.order_id = o.id
SET o.total_tons = COALESCE(i.tons, 0), o.updated_at = o.updated_at;

UPDATE order_version v LEFT JOIN (
  SELECT order_version_id, SUM(line_tons) tons FROM order_version_item GROUP BY order_version_id
) i ON i.order_version_id = v.id
SET v.total_tons = COALESCE(i.tons, 0);

UPDATE order_change_request r SET requested_total_tons = (
  SELECT COALESCE(SUM(j.tons), 0)
  FROM JSON_TABLE(r.requested_items_json, '$[*]' COLUMNS(tons DECIMAL(18,6) PATH '$.lineTons' NULL ON EMPTY)) j
) WHERE request_type = 'MODIFY';

UPDATE order_change_request r SET original_order_json = JSON_SET(original_order_json, '$.totalTons', (
  SELECT COALESCE(SUM(j.tons), 0)
  FROM JSON_TABLE(r.original_order_json, '$.items[*]' COLUMNS(tons DECIMAL(18,6) PATH '$.lineTons' NULL ON EMPTY)) j
)) WHERE original_order_json IS NOT NULL;

-- Dashboard snapshots already sum available lines. Preserve the snapshots and
-- immutable idempotency response receipts; the UI displays legacy null as zero.
