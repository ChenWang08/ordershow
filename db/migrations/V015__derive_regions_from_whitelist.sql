-- The active whitelist is now the only source of H5 region options.
-- Keep activity_region as an internal dictionary and canonicalize any remaining legacy names.
INSERT INTO activity_region(activity_id, region_code, region_name, sort_no, is_active)
SELECT orphan.activity_id,
       CONCAT('R_', UPPER(SUBSTRING(SHA2(orphan.region_name, 256), 1, 12))),
       orphan.region_name,
       1000 + ROW_NUMBER() OVER (PARTITION BY orphan.activity_id ORDER BY orphan.region_name) * 10,
       TRUE
FROM (
  SELECT DISTINCT c.activity_id, TRIM(c.region_code) AS region_name
  FROM activity_customer c
  WHERE c.customer_type = 'GENERAL'
    AND c.region_code IS NOT NULL
    AND TRIM(c.region_code) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM activity_region matched
      WHERE matched.activity_id = c.activity_id
        AND (matched.region_code = c.region_code OR matched.region_name = TRIM(c.region_code))
    )
) orphan
ON DUPLICATE KEY UPDATE is_active = TRUE;

UPDATE activity_customer c
JOIN activity_region r
  ON r.activity_id = c.activity_id
 AND r.region_name = TRIM(c.region_code)
SET c.region_code = r.region_code
WHERE c.customer_type = 'GENERAL'
  AND c.region_code IS NOT NULL
  AND c.region_code <> r.region_code;
