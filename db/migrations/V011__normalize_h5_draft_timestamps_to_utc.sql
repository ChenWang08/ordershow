-- V010 initially relied on CURRENT_TIMESTAMP while the MySQL container runs in Asia/Shanghai.
-- Correct only timestamps that are clearly in the future relative to UTC, so UTC-based installs are unchanged.
UPDATE h5_order_draft
SET created_at = DATE_SUB(created_at, INTERVAL 8 HOUR)
WHERE created_at > DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR);

UPDATE h5_order_draft
SET updated_at = DATE_SUB(updated_at, INTERVAL 8 HOUR)
WHERE updated_at > DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 HOUR);
