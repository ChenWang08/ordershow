package com.fengyi.ordershow.order;

import java.time.LocalDateTime;
import org.springframework.jdbc.core.JdbcTemplate;

/** Caller holds the activity/customer write guard in a READ_COMMITTED transaction. */
final class OrderDraftWrites {
  private OrderDraftWrites() {}

  static void save(JdbcTemplate jdbc, long activityId, long customerId, int baseVersion,
                   String items, LocalDateTime expiresAt) {
    Long id = findId(jdbc, activityId, customerId);
    if (id == null) {
      // The existing customer row serializes first saves. Avoid the upsert's
      // exclusive duplicate-key locking on recently deleted unique-index records.
      jdbc.update("""
          INSERT INTO h5_order_draft(activity_id,activity_customer_id,base_order_version,items_json,expires_at,
            created_at,updated_at)
          VALUES (?,?,?,CAST(? AS JSON),?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
          """, activityId, customerId, baseVersion, items, expiresAt);
    } else {
      int changed = jdbc.update("""
          UPDATE h5_order_draft SET base_order_version=?,items_json=CAST(? AS JSON),expires_at=?,
            lock_version=lock_version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=?
          """, baseVersion, items, expiresAt, id);
      if (changed != 1) throw new IllegalStateException("Draft disappeared while holding customer guard");
    }
  }

  static boolean delete(JdbcTemplate jdbc, long activityId, long customerId) {
    Long id = findId(jdbc, activityId, customerId);
    return id != null && jdbc.update("DELETE FROM h5_order_draft WHERE id=?", id) > 0;
  }

  private static Long findId(JdbcTemplate jdbc, long activityId, long customerId) {
    // No FOR UPDATE on a missing secondary-index record: the customer guard
    // already serializes every business mutation of this customer's draft.
    var ids = jdbc.queryForList("SELECT id FROM h5_order_draft WHERE activity_id=? AND activity_customer_id=?",
        Long.class, activityId, customerId);
    return ids.isEmpty() ? null : ids.getFirst();
  }
}
