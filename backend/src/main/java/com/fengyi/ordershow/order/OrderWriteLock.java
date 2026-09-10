package com.fengyi.ordershow.order;

import com.fengyi.ordershow.common.DomainException;
import org.springframework.jdbc.core.JdbcTemplate;

/** Caller must use a READ_COMMITTED transaction and recheck activity state after acquiring. */
final class OrderWriteLock {
  private OrderWriteLock() {}

  static void acquire(JdbcTemplate jdbc, long activityId, long customerId) {
    // Compatible across customers; price updates/close still require the activity's exclusive lock.
    if (jdbc.queryForList("SELECT id FROM activity WHERE id = ? FOR SHARE", Long.class, activityId).isEmpty()) {
      throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
    }
    // Exists before the first order, so concurrent first submits cannot race on a missing order row.
    if (jdbc.queryForList("SELECT id FROM activity_customer WHERE activity_id = ? AND id = ? AND is_active = TRUE FOR UPDATE",
        Long.class, activityId, customerId).isEmpty()) {
      throw DomainException.forbidden("H5_CUSTOMER_INVALID", "当前客户身份已失效");
    }
  }
}
