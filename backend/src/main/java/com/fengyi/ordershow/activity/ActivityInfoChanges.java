package com.fengyi.ordershow.activity;

import org.springframework.jdbc.core.JdbcTemplate;

/** Called inside the business transaction, including changes to derived public whitelist fields. */
public final class ActivityInfoChanges {
  public static final String EVENT_TYPE = "ACTIVITY_INFO_CHANGED";

  private ActivityInfoChanges() {}

  public static void record(JdbcTemplate jdbc, long activityId) {
    jdbc.update("UPDATE activity SET public_info_version = public_info_version + 1 WHERE id = ?", activityId);
    jdbc.update("""
        INSERT INTO domain_event_outbox(activity_id, aggregate_type, aggregate_id, event_type, payload_json, available_at)
        SELECT id, 'ACTIVITY_INFO', CAST(id AS CHAR), 'ACTIVITY_INFO_CHANGED',
          JSON_OBJECT('publicInfoVersion', CAST(public_info_version AS CHAR)), UTC_TIMESTAMP(3)
        FROM activity WHERE id = ?
        """, activityId);
  }
}
