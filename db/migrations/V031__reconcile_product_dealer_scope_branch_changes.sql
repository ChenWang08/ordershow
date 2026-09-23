CREATE TEMPORARY TABLE product_dealer_scope_cleanup (
  activity_product_id BIGINT UNSIGNED NOT NULL PRIMARY KEY
);

INSERT INTO product_dealer_scope_cleanup(activity_product_id)
SELECT DISTINCT n.id
FROM activity_product n
JOIN activity_data_binding b
  ON b.activity_id = n.activity_id AND b.data_type = 'PRODUCT'
JOIN import_publish_version current_version
  ON current_version.id = b.current_version_id
JOIN import_publish_version previous_version
  ON previous_version.activity_id = current_version.activity_id
  AND previous_version.data_type = 'PRODUCT'
  AND previous_version.version_no = (
    SELECT MAX(previous_candidate.version_no)
    FROM import_publish_version previous_candidate
    WHERE previous_candidate.activity_id = current_version.activity_id
      AND previous_candidate.data_type = 'PRODUCT'
      AND previous_candidate.version_no < current_version.version_no
  )
JOIN activity_product o
  ON o.activity_id = n.activity_id
  AND o.data_version_id = previous_version.id
  AND o.business_key = n.business_key
WHERE n.data_version_id = current_version.id
  AND (
    EXISTS (
      SELECT 1
      FROM activity_product_branch_scope old_scope
      LEFT JOIN activity_product_branch_scope new_scope
        ON new_scope.activity_product_id = n.id
        AND new_scope.normalized_branch_name = old_scope.normalized_branch_name
      WHERE old_scope.activity_product_id = o.id
        AND new_scope.id IS NULL
    )
    OR EXISTS (
      SELECT 1
      FROM activity_product_branch_scope new_scope
      LEFT JOIN activity_product_branch_scope old_scope
        ON old_scope.activity_product_id = o.id
        AND old_scope.normalized_branch_name = new_scope.normalized_branch_name
      WHERE new_scope.activity_product_id = n.id
        AND old_scope.id IS NULL
    )
  )
  AND EXISTS (
    SELECT 1 FROM activity_product_dealer_scope stale_scope
    WHERE stale_scope.activity_product_id = n.id
  );

DELETE member_scope
FROM activity_product_dealer_member member_scope
JOIN product_dealer_scope_cleanup cleanup
  ON cleanup.activity_product_id = member_scope.activity_product_id;

DELETE dealer_scope
FROM activity_product_dealer_scope dealer_scope
JOIN product_dealer_scope_cleanup cleanup
  ON cleanup.activity_product_id = dealer_scope.activity_product_id;

DROP TEMPORARY TABLE product_dealer_scope_cleanup;
