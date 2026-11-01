package com.fengyi.ordershow.activity;

import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ActivityInfoSnapshotService {
  private final JdbcTemplate jdbc;
  private final ActivityService activities;

  public ActivityInfoSnapshotService(JdbcTemplate jdbc, ActivityService activities) {
    this.jdbc = jdbc;
    this.activities = activities;
  }

  // All public fields and their synchronization version must describe one committed DB snapshot.
  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
  public Snapshot load(String activityCode) {
    var activity = activities.byCode(activityCode);
    Long version = jdbc.queryForObject("SELECT public_info_version FROM activity WHERE id = ?", Long.class, activity.id());
    return new Snapshot(activity.id(), String.valueOf(version), Instant.now(), activity);
  }

  @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
  public Snapshot load(long activityId) {
    var activity = activities.byId(activityId);
    Long version = jdbc.queryForObject("SELECT public_info_version FROM activity WHERE id = ?", Long.class, activityId);
    return new Snapshot(activityId, String.valueOf(version), Instant.now(), activity);
  }

  // Decimal strings preserve BIGINT precision in browsers. This is not an outbox replay cursor.
  public record Snapshot(long activityId, String version, Instant serverTime, ActivityService.ActivityView activity) {
    public long numericVersion() { return Long.parseLong(version); }
  }
}
