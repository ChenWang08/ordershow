SELECT DISTINCT c.customer_type
        FROM activity_customer c
        JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST'
          AND b.current_version_id = c.data_version_id
        JOIN activity a ON a.id = c.activity_id
        WHERE a.activity_code = ? AND c.is_active = TRUE