SELECT 0 session_id, c.activity_id, c.id activity_customer_id, a.activity_code,
               c.customer_type, c.region_code, c.branch_name, c.dealer_short_name, c.dealer_full_name, c.phone_masked
        FROM activity_customer c
        JOIN activity a ON a.id = c.activity_id
        JOIN department d ON d.id = a.department_id AND d.status = 'ACTIVE'
        LEFT JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST'
        WHERE a.activity_code = ? AND a.archived_at IS NULL
          AND (a.status = 'CLOSED' OR (a.status IN ('SCHEDULED', 'ACTIVE') AND a.starts_at <= UTC_TIMESTAMP(3)))
          AND (a.event_ends_at IS NULL OR a.event_ends_at > UTC_TIMESTAMP(3))
          AND c.customer_type = ? AND c.phone_lookup_hash = ? AND c.is_active = TRUE
          AND (b.current_version_id IS NULL OR c.data_version_id = b.current_version_id)
          AND (c.customer_type <> 'GENERAL' OR (
            (? IS NULL AND b.current_version_id = c.data_version_id AND NOT EXISTS (
              SELECT 1 FROM activity_customer other_type
              WHERE other_type.activity_id = c.activity_id
                AND other_type.data_version_id = b.current_version_id
                AND other_type.is_active = TRUE AND other_type.customer_type <> 'GENERAL'
            ))
            OR
            NOT EXISTS (
              SELECT 1 FROM activity_customer regionalized
              JOIN activity_data_binding regional_binding
                ON regional_binding.activity_id = regionalized.activity_id
               AND regional_binding.data_type = 'WHITELIST'
               AND regional_binding.current_version_id = regionalized.data_version_id
              WHERE regionalized.activity_id = c.activity_id AND regionalized.customer_type = 'GENERAL'
                AND regionalized.is_active = TRUE AND regionalized.region_code IS NOT NULL
                AND TRIM(regionalized.region_code) <> ''
            )
            OR (? = 'UNASSIGNED' AND (c.region_code IS NULL OR TRIM(c.region_code) = ''))
            OR (? IS NOT NULL AND ? <> '' AND ? <> 'UNASSIGNED' AND c.region_code = ?)
          ))