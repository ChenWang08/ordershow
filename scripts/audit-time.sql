-- Read-only investigation. Run against an explicitly selected database.
-- An eight-hour difference is evidence to investigate, never an automatic correction rule.
SELECT DATABASE() AS database_name, @@global.time_zone AS global_zone,
       @@session.time_zone AS session_zone, NOW(3) AS session_now, UTC_TIMESTAMP(3) AS utc_now;

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE IN ('datetime','timestamp','date','time')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TIMESTAMPDIFF(SECOND,occurred_at,created_at) AS created_minus_occurred_seconds, COUNT(*) AS rows_count
FROM audit_log GROUP BY created_minus_occurred_seconds ORDER BY rows_count DESC LIMIT 20;

SELECT id,created_at,started_at,completed_at,updated_at
FROM import_task ORDER BY id DESC LIMIT 30;

SELECT id,requested_at,reviewed_at,created_at,status
FROM order_change_request ORDER BY id DESC LIMIT 30;

SELECT id,created_at,available_at,published_at,status
FROM domain_event_outbox ORDER BY id DESC LIMIT 30;

SELECT id,generated_at,JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.generatedAt')) AS payload_generated_at
FROM activity_dashboard_snapshot ORDER BY id DESC LIMIT 30;

SELECT id,created_at,drawn_at FROM lottery_draw_attempt ORDER BY id DESC LIMIT 30;
