package com.fengyi.ordershow.order;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Bounded cleanup of snapshot records owned by H5 submission; other endpoints keep their own policy. */
@Component
public class H5IdempotencyCleanup {
  private final JdbcTemplate jdbc;
  public H5IdempotencyCleanup(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  @Scheduled(initialDelay = 60_000, fixedDelay = 3_600_000)
  public void clean() { cleanBatch(); }

  int cleanBatch() {
    return jdbc.update("""
        DELETE FROM api_idempotency
        WHERE actor_type='H5_CUSTOMER' AND endpoint_code='ORDER_SUBMIT' AND status='COMPLETED'
          AND JSON_EXTRACT(response_json,'$.format')=2 AND expires_at < UTC_TIMESTAMP(3)
          AND completed_at < DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY)
          AND activity_id IN (
            SELECT id FROM activity WHERE status IN ('CLOSED','FINISHED','ARCHIVED')
              AND COALESCE(event_ends_at,ends_at) < DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 30 DAY))
        ORDER BY expires_at,id LIMIT 500
        """);
  }
}
