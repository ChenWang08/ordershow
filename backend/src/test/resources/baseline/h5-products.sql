
        SELECT p.*, (SELECT sf.object_key FROM product_image pi JOIN stored_file sf ON sf.id = pi.stored_file_id
          WHERE pi.activity_product_id = p.id AND pi.deleted_at IS NULL ORDER BY pi.is_primary DESC, pi.sort_no, pi.id LIMIT 1) image_key
          , (SELECT t.min_quantity FROM activity_product_price_tier t WHERE t.activity_product_id = p.id) price_tier_min_quantity
          , (SELECT t.case_price FROM activity_product_price_tier t WHERE t.activity_product_id = p.id) price_tier_case_price
          , (SELECT t.pricing_mode FROM activity_product_price_tier t WHERE t.activity_product_id = p.id) price_tier_pricing_mode
        FROM activity_product p JOIN activity_data_binding b ON b.current_version_id = p.data_version_id AND b.activity_id = p.activity_id AND b.data_type = 'PRODUCT'
        WHERE p.activity_id = ? AND (? = 'ALL' OR p.customer_type = ? OR p.customer_type = 'ALL') AND p.is_visible = TRUE AND p.is_orderable = TRUE
          AND (NOT EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id)
               OR EXISTS (SELECT 1 FROM activity_product_branch_scope s WHERE s.activity_product_id = p.id AND s.normalized_branch_name = ?))
