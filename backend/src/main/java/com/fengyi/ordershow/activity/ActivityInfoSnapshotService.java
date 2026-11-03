package com.fengyi.ordershow.activity;

import java.time.Instant;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.UtcTime;
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

  /** Indexed, single-row lookup: no regions, customers, department or order aggregation. */
  public Revision revision(String activityCode) {
    var rows = jdbc.query("""
        SELECT id,public_info_version,status,starts_at,ends_at,event_ends_at
        FROM activity WHERE activity_code=? AND deletion_requested_at IS NULL
        """, (rs, row) -> new Revision(rs.getLong("id"), rs.getLong("public_info_version"),
            rs.getString("status"), UtcTime.read(rs, "starts_at"), UtcTime.read(rs, "ends_at"),
            UtcTime.read(rs, "event_ends_at")), activityCode);
    if (rows.size() != 1) throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
    return rows.getFirst();
  }

  public record Revision(long activityId, long version, String configuredStatus, Instant startsAt,
      Instant endsAt, Instant eventEndsAt) {
    public String etag(Instant now) {
      return tag(activityId, version, ActivityService.effectiveStatus(configuredStatus, startsAt, endsAt, eventEndsAt, now));
    }
    static Revision from(Snapshot snapshot) {
      var value = snapshot.activity();
      return new Revision(snapshot.activityId(), snapshot.numericVersion(), value.configuredStatus(),
          value.startsAt(), value.endsAt(), value.eventEndsAt());
    }
  }

  static String tag(long id, long version, String status) {
    // Weak validator: the API envelope's request trace differs, the public representation does not.
    return "W/\"activity-" + id + "-" + version + "-" + status + "\"";
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
