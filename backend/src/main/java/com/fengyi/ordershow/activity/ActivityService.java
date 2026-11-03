package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.common.UtcTime;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.DepartmentAccessService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ActivityService {
  private final JdbcTemplate jdbc;
  private final Clock clock;
  private final ApplicationEventPublisher events;
  private final DepartmentAccessService departmentAccess;

  @org.springframework.beans.factory.annotation.Autowired
  public ActivityService(JdbcTemplate jdbc, ApplicationEventPublisher events, DepartmentAccessService departmentAccess) {
    this(jdbc, Clock.systemUTC(), events, departmentAccess);
  }

  ActivityService(JdbcTemplate jdbc, Clock clock) {
    this(jdbc, clock, ignored -> {}, null);
  }

  ActivityService(JdbcTemplate jdbc, Clock clock, ApplicationEventPublisher events) {
    this(jdbc, clock, events, null);
  }

  ActivityService(JdbcTemplate jdbc, Clock clock, ApplicationEventPublisher events,
      DepartmentAccessService departmentAccess) {
    this.jdbc = jdbc;
    this.clock = clock;
    this.events = events;
    this.departmentAccess = departmentAccess;
  }

  public ActivityView byCode(String code) {
    List<ActivityView> rows = jdbc.query("""
        SELECT a.*, d.department_name
        FROM activity a JOIN department d ON d.id = a.department_id
        WHERE a.activity_code = ? AND a.deletion_requested_at IS NULL
        """, this::map, code);
    if (rows.size() != 1) throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
    return withRegions(rows.getFirst());
  }

  public ActivityView byId(long id) {
    List<ActivityView> rows = jdbc.query("""
        SELECT a.*, d.department_name
        FROM activity a JOIN department d ON d.id = a.department_id
        WHERE a.id = ? AND a.deletion_requested_at IS NULL
        """, this::map, id);
    if (rows.size() != 1) throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
    return withRegions(rows.getFirst());
  }

  /** Internal order/catalog lookup: no UI regions or whitelist summaries on the request hot path. */
  public OrderingActivity orderingActivity(String code) {
    var rows = jdbc.query("SELECT id,ends_at FROM activity WHERE activity_code=? AND deletion_requested_at IS NULL",
        (rs, rowNum) -> new OrderingActivity(rs.getLong("id"),UtcTime.read(rs, "ends_at")),code);
    if (rows.size() != 1) throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
    return rows.getFirst();
  }

  public record OrderingActivity(long id, Instant endsAt) {}
  private record OrderingWindow(String status, Instant startsAt, Instant endsAt, Instant eventEndsAt) {}

  public ActivityView currentOrderable() {
    List<ActivityView> rows = jdbc.query("""
        SELECT a.*, d.department_name
        FROM activity a JOIN department d ON d.id = a.department_id
        WHERE a.deletion_requested_at IS NULL AND d.status = 'ACTIVE' AND a.published_at IS NOT NULL AND a.closed_at IS NULL
          AND a.status IN ('SCHEDULED', 'ACTIVE')
          AND a.starts_at <= UTC_TIMESTAMP(3) AND a.ends_at > UTC_TIMESTAMP(3)
        ORDER BY a.starts_at, a.id
        """, this::map);
    if (rows.isEmpty()) {
      throw DomainException.notFound("CURRENT_ACTIVITY_NOT_FOUND", "当前暂无可下单活动");
    }
    if (rows.size() > 1) {
      throw DomainException.conflict("CURRENT_ACTIVITY_CONFLICT", "当前存在多个部门活动，请使用对应活动编号的 H5 专属链接");
    }
    return withRegions(rows.getFirst());
  }

  public List<ActivityView> list() {
    return jdbc.query("""
        SELECT a.*, d.department_name
        FROM activity a JOIN department d ON d.id = a.department_id
        WHERE a.deletion_requested_at IS NULL ORDER BY a.created_at DESC
        """, this::map)
        .stream().map(this::withRegions).toList();
  }

  /** The admin switcher needs no customer, region, catalog or dashboard queries. */
  public List<ActivitySummary> listSummaries(AdminPrincipal admin) {
    if (!admin.isSuperAdmin() && admin.departmentId() == null) return List.of();
    String sql = """
        SELECT a.id,a.department_id,d.department_name,a.activity_code,a.name,a.status,
          a.starts_at,a.ends_at,a.event_ends_at
        FROM activity a JOIN department d ON d.id=a.department_id
        WHERE a.deletion_requested_at IS NULL
        """;
    Object[] args = admin.isSuperAdmin() ? new Object[] {} : new Object[] { admin.departmentId() };
    if (!admin.isSuperAdmin()) sql += " AND a.department_id=?";
    sql += " ORDER BY a.created_at DESC,a.id DESC";
    Instant at = now();
    return jdbc.query(sql, (rs, row) -> {
      Instant starts = UtcTime.read(rs, "starts_at"), ends = UtcTime.read(rs, "ends_at");
      Instant eventEnds = UtcTime.read(rs, "event_ends_at");
      return new ActivitySummary(rs.getLong("id"),rs.getLong("department_id"),rs.getString("department_name"),
          rs.getString("activity_code"),rs.getString("name"),
          effectiveStatus(rs.getString("status"),starts,ends,eventEnds,at),starts,ends,eventEnds);
    }, args);
  }

  public record ActivitySummary(long id,long departmentId,String departmentName,String code,String name,
                                String status,Instant startsAt,Instant endsAt,Instant eventEndsAt) {}

  public List<ActivityView> list(AdminPrincipal admin) {
    if (admin == null || admin.isSuperAdmin()) return list();
    if (admin.departmentId() == null) return List.of();
    return jdbc.query("""
        SELECT a.*, d.department_name
        FROM activity a JOIN department d ON d.id = a.department_id
        WHERE a.deletion_requested_at IS NULL AND a.department_id = ?
        ORDER BY a.created_at DESC
        """, this::map, admin.departmentId()).stream().map(this::withRegions).toList();
  }

  @Transactional
  public ActivityView create(ActivityWrite request, AdminPrincipal admin) {
    validateTime(request.startsAt(), request.endsAt(), request.eventEndsAt());
    requireFutureStart(request.startsAt());
    admin.requireManager();
    long departmentId = departmentAccess.requireDepartmentForCreate(admin, request.departmentId());
    String temporaryCode = "PENDING-" + UUID.randomUUID();
    jdbc.update("""
        INSERT INTO activity(department_id, activity_code, name, description, status, timezone, starts_at, ends_at, event_ends_at,
                             customer_scope, company_ranking_top_n, branch_ranking_top_n, ton_display_scale,
                             created_by, updated_by)
        VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, departmentId, temporaryCode, request.name(), request.description(), request.timezone(), UtcTime.database(request.startsAt()),
        UtcTime.database(request.endsAt()), UtcTime.database(request.eventEndsAt()), request.customerScope(), request.companyRankingTopN(), request.branchRankingTopN(),
        request.tonDisplayScale(), admin.id(), admin.id());
    Long id = jdbc.queryForObject("SELECT id FROM activity WHERE activity_code = ?", Long.class, temporaryCode);
    String activityNo = generateActivityNo(id, now(), request.timezone());
    int numbered = jdbc.update("UPDATE activity SET activity_code = ? WHERE id = ? AND activity_code = ?", activityNo, id, temporaryCode);
    if (numbered != 1) throw new IllegalStateException("活动编号生成失败");
    return byId(id);
  }

  @Transactional
  public ActivityView update(long id, int expectedVersion, ActivityWrite request, AdminPrincipal admin) {
    admin.requireManager();
    departmentAccess.requireActivityAccess(admin, id);
    validateTime(request.startsAt(), request.endsAt(), request.eventEndsAt());
    ActivityView current = byId(id);
    String effective = current.status();
    if ("FINISHED".equals(effective) || "ARCHIVED".equals(effective)) {
      throw DomainException.conflict("ACTIVITY_READ_ONLY", "整场活动结束后不能修改配置");
    }
    if ("DRAFT".equals(effective) || "SCHEDULED".equals(effective)) {
      requireFutureStart(request.startsAt());
    }
    if ("SCHEDULED".equals(effective)) {
      requirePublishedDataUnchanged(current, request);
    }
    if ("ACTIVE".equals(effective)) {
      if (!current.startsAt().truncatedTo(ChronoUnit.MINUTES).equals(request.startsAt().truncatedTo(ChronoUnit.MINUTES))) {
        throw DomainException.conflict("ACTIVITY_START_READ_ONLY", "活动开始后不能修改订货开始时间");
      }
      requireFutureEnd(request.endsAt());
      requirePublishedDataUnchanged(current, request);
    }
    if ("CLOSED".equals(effective)) {
      requireOnlyEventEndChanged(current, request);
      if (current.eventEndsAt() != null && request.eventEndsAt().truncatedTo(ChronoUnit.MINUTES).isBefore(current.eventEndsAt().truncatedTo(ChronoUnit.MINUTES))) {
        throw DomainException.conflict("ACTIVITY_EVENT_END_CAN_ONLY_EXTEND", "订货截止后只能延长整场活动结束时间");
      }
      if (!request.eventEndsAt().isAfter(now())) {
        throw DomainException.badRequest("ACTIVITY_EVENT_END_NOT_FUTURE", "整场活动结束时间必须晚于当前时间");
      }
    }
    Instant startsAtToSave = "ACTIVE".equals(effective) ? current.startsAt() : request.startsAt();
    Instant endsAtToSave = "ACTIVE".equals(effective)
        && request.endsAt().truncatedTo(ChronoUnit.MINUTES).equals(current.endsAt().truncatedTo(ChronoUnit.MINUTES))
        ? current.endsAt() : request.endsAt();
    Instant eventEndsAtToSave = request.eventEndsAt();
    validateTime(startsAtToSave, endsAtToSave, eventEndsAtToSave);
    if ("SCHEDULED".equals(effective) || "ACTIVE".equals(effective) || "CLOSED".equals(effective)) {
      lockDepartmentForScheduleCheck(current.departmentId());
      requireNoPublishedOverlap(id, current.departmentId(), startsAtToSave, eventEndsAtToSave == null ? endsAtToSave : eventEndsAtToSave);
    }
    int changed = jdbc.update("""
        UPDATE activity SET name = ?, description = ?, timezone = ?, starts_at = ?, ends_at = ?, event_ends_at = ?, customer_scope = ?,
          company_ranking_top_n = ?, branch_ranking_top_n = ?, ton_display_scale = ?, updated_by = ?, version = version + 1
        WHERE id = ? AND version = ?
        """, request.name(), request.description(), request.timezone(), UtcTime.database(startsAtToSave),
        UtcTime.database(endsAtToSave), UtcTime.database(request.eventEndsAt()), request.customerScope(), request.companyRankingTopN(), request.branchRankingTopN(),
        request.tonDisplayScale(), admin.id(), id, expectedVersion);
    if (changed != 1) throw DomainException.conflict("ACTIVITY_VERSION_CONFLICT", "活动配置已被其他页面修改，请刷新后重试");
    ActivityInfoChanges.record(jdbc, id);
    return byId(id);
  }

  @Transactional
  public ActivityView publish(long id, int expectedVersion, AdminPrincipal admin) {
    admin.requireManager();
    departmentAccess.requireActivityAccess(admin, id);
    ActivityView current = byId(id);
    if (!"DRAFT".equals(current.configuredStatus())) {
      throw DomainException.conflict("ACTIVITY_PUBLISH_INVALID", "只有草稿活动可以发布");
    }
    requireFutureStart(current.startsAt());
    requirePublishReady(id);
    lockDepartmentForScheduleCheck(current.departmentId());
    requireNoPublishedOverlap(id, current.departmentId(), current.startsAt(), activityEnd(current.endsAt(), current.eventEndsAt()));
    int changed = jdbc.update("""
        UPDATE activity SET status = 'SCHEDULED', published_at = UTC_TIMESTAMP(3), version = version + 1, updated_by = ?
        WHERE id = ? AND version = ? AND status = 'DRAFT'
        """, admin.id(), id, expectedVersion);
    requireChanged(changed);
    outbox(id, "ACTIVITY_PUBLISHED");
    return byId(id);
  }

  @Transactional
  public ActivityView withdrawPublication(long id, int expectedVersion, AdminPrincipal admin) {
    admin.requireManager();
    departmentAccess.requireActivityAccess(admin, id);
    ActivityView current = byId(id);
    if (!"SCHEDULED".equals(current.configuredStatus()) || !now().isBefore(current.startsAt())) {
      throw DomainException.conflict("ACTIVITY_WITHDRAW_INVALID", "只有尚未开始的待开始活动可以撤回发布");
    }
    int changed = jdbc.update("""
        UPDATE activity SET status = 'DRAFT', published_at = NULL, version = version + 1, updated_by = ?
        WHERE id = ? AND version = ? AND status = 'SCHEDULED'
        """, admin.id(), id, expectedVersion);
    requireChanged(changed);
    outbox(id, "ACTIVITY_PUBLICATION_WITHDRAWN");
    return byId(id);
  }

  @Transactional
  public ActivityView closeNow(long id, int expectedVersion, AdminPrincipal admin) {
    admin.requireManager();
    departmentAccess.requireActivityAccess(admin, id);
    ActivityView current = byId(id);
    if (!"ACTIVE".equals(current.status())) {
      throw DomainException.conflict("ACTIVITY_CLOSE_INVALID", "只有进行中的活动可以立即截止");
    }
    int changed = jdbc.update("""
        UPDATE activity SET status = 'CLOSED', actual_started_at = COALESCE(actual_started_at, starts_at),
          closed_at = UTC_TIMESTAMP(3), version = version + 1, updated_by = ?
        WHERE id = ? AND version = ? AND status IN ('SCHEDULED', 'ACTIVE')
        """, admin.id(), id, expectedVersion);
    requireChanged(changed);
    outbox(id, "ACTIVITY_CLOSED");
    return byId(id);
  }

  @Transactional
  public ActivityView finishNow(long id, int expectedVersion, AdminPrincipal admin) {
    admin.requireManager();
    departmentAccess.requireActivityAccess(admin, id);
    ActivityView current = byId(id);
    if (!"CLOSED".equals(current.status())) {
      throw DomainException.conflict("ACTIVITY_FINISH_INVALID", "只有订货已截止的活动可以结束整场活动");
    }
    int changed = jdbc.update("""
        UPDATE activity SET status = 'FINISHED', finished_at = UTC_TIMESTAMP(3), version = version + 1, updated_by = ?
        WHERE id = ? AND version = ? AND status IN ('ACTIVE', 'CLOSED')
        """, admin.id(), id, expectedVersion);
    requireChanged(changed);
    revokeH5Sessions(id);
    outbox(id, "ACTIVITY_FINISHED");
    events.publishEvent(new ActivityFinishedEvent(id));
    return byId(id);
  }

  public void requireWritable(long activityId) {
    var rows = jdbc.query("SELECT status,starts_at,ends_at,event_ends_at FROM activity WHERE id=? AND deletion_requested_at IS NULL",
        (rs, rowNum) -> new OrderingWindow(rs.getString("status"),UtcTime.read(rs, "starts_at"),
            UtcTime.read(rs, "ends_at"),UtcTime.read(rs, "event_ends_at")),activityId);
    if (rows.size() != 1) throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
    OrderingWindow activity = rows.getFirst();
    Instant now = now();
    if (!"ACTIVE".equals(effectiveStatus(activity.status(),activity.startsAt(),activity.endsAt(),activity.eventEndsAt(),now)) || !now.isBefore(activity.endsAt())) {
      throw DomainException.conflict("ACTIVITY_NOT_WRITABLE", "活动当前不允许提交或修改订单");
    }
  }

  @Transactional
  public void synchronizeTimedActivities() {
    List<Long> starting = jdbc.queryForList("""
        SELECT id FROM activity WHERE deletion_requested_at IS NULL AND status = 'SCHEDULED'
          AND starts_at <= UTC_TIMESTAMP(3) AND ends_at > UTC_TIMESTAMP(3)
        """, Long.class);
    for (Long id : starting) {
      int changed = jdbc.update("""
          UPDATE activity SET status = 'ACTIVE', actual_started_at = COALESCE(actual_started_at, UTC_TIMESTAMP(3)), version = version + 1
          WHERE id = ? AND deletion_requested_at IS NULL AND status = 'SCHEDULED' AND starts_at <= UTC_TIMESTAMP(3) AND ends_at > UTC_TIMESTAMP(3)
          """, id);
      if (changed == 1) outbox(id, "ACTIVITY_STARTED");
    }
    List<Long> closing = jdbc.queryForList("""
        SELECT id FROM activity WHERE deletion_requested_at IS NULL AND status IN ('SCHEDULED', 'ACTIVE') AND ends_at <= UTC_TIMESTAMP(3)
        """, Long.class);
    for (Long id : closing) {
      int changed = jdbc.update("""
          UPDATE activity SET status = 'CLOSED', closed_at = COALESCE(closed_at, UTC_TIMESTAMP(3)), version = version + 1
          WHERE id = ? AND deletion_requested_at IS NULL AND status IN ('SCHEDULED', 'ACTIVE') AND ends_at <= UTC_TIMESTAMP(3)
          """, id);
      if (changed == 1) outbox(id, "ACTIVITY_CLOSED");
    }
    List<Long> finishing = jdbc.queryForList("""
        SELECT id FROM activity WHERE deletion_requested_at IS NULL AND status = 'CLOSED' AND event_ends_at IS NOT NULL
          AND event_ends_at <= UTC_TIMESTAMP(3)
        """, Long.class);
    for (Long id : finishing) {
      int changed = jdbc.update("""
          UPDATE activity SET status = 'FINISHED', finished_at = COALESCE(finished_at, UTC_TIMESTAMP(3)), version = version + 1
          WHERE id = ? AND deletion_requested_at IS NULL AND status = 'CLOSED' AND event_ends_at <= UTC_TIMESTAMP(3)
          """, id);
      if (changed == 1) {
        revokeH5Sessions(id);
        outbox(id, "ACTIVITY_FINISHED");
        events.publishEvent(new ActivityFinishedEvent(id));
      }
    }
  }

  private void revokeH5Sessions(long activityId) {
    jdbc.update("""
        UPDATE h5_session SET revoked_at = UTC_TIMESTAMP(3)
        WHERE activity_id = ? AND revoked_at IS NULL
        """, activityId);
  }

  private ActivityView withRegions(ActivityView value) {
    List<RegionView> regions = jdbc.query("""
        SELECT r.region_code, r.region_name, MIN(r.sort_no) sort_no
        FROM activity_customer c
        JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST'
          AND b.current_version_id = c.data_version_id
        JOIN activity_region r ON r.activity_id = c.activity_id AND r.region_code = c.region_code
        WHERE c.activity_id = ? AND c.is_active = TRUE AND c.customer_type = 'GENERAL'
          AND c.region_code IS NOT NULL AND TRIM(c.region_code) <> ''
        GROUP BY r.region_code, r.region_name
        ORDER BY sort_no, r.region_name
        """, (rs, rowNum) -> new RegionView(rs.getString(1), rs.getString(2), rs.getInt(3)), value.id());
    Boolean hasUnassigned = jdbc.queryForObject("""
        SELECT COUNT(*) > 0
        FROM activity_customer c
        JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST'
          AND b.current_version_id = c.data_version_id
        WHERE c.activity_id = ? AND c.is_active = TRUE AND c.customer_type = 'GENERAL'
          AND (c.region_code IS NULL OR TRIM(c.region_code) = '')
        """, Boolean.class, value.id());
    List<String> whitelistTypes = jdbc.queryForList("""
        SELECT DISTINCT c.customer_type
        FROM activity_customer c
        JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST'
          AND b.current_version_id = c.data_version_id
        WHERE c.activity_id = ? AND c.is_active = TRUE
        ORDER BY c.customer_type
        """, String.class, value.id());
    List<String> availableCustomerTypes = whitelistTypes.stream().filter(type -> List.of("GENERAL", "SPECIAL").contains(type)).toList();
    String whitelistCustomerTypeMode = whitelistTypes.contains("ALL") ? "UNSPECIFIED" : "TYPED";
    return new ActivityView(value.id(), value.departmentId(), value.departmentName(), value.code(), value.name(), value.description(), effectiveStatus(value),
        value.configuredStatus(), value.timezone(), value.startsAt(), value.endsAt(), value.eventEndsAt(), value.customerScope(),
        value.companyRankingTopN(), value.branchRankingTopN(), value.tonDisplayScale(), value.version(), regions,
        Boolean.TRUE.equals(hasUnassigned), whitelistCustomerTypeMode, availableCustomerTypes,
        value.publishedAt(), value.actualStartedAt(), value.closedAt(), value.finishedAt(), value.liveRoomUrl(),
        value.h5BackgroundUrl(), value.desktopBackgroundUrl());
  }

  private String effectiveStatus(ActivityView value) {
    return effectiveStatus(value.configuredStatus(), value.startsAt(), value.endsAt(), value.eventEndsAt(), now());
  }

  static String effectiveStatus(String configuredStatus, Instant startsAt, Instant endsAt, Instant now) {
    return effectiveStatus(configuredStatus, startsAt, endsAt, null, now);
  }

  static String effectiveStatus(String configuredStatus, Instant startsAt, Instant endsAt, Instant eventEndsAt, Instant now) {
    if ("ARCHIVED".equals(configuredStatus) || "FINISHED".equals(configuredStatus)) return configuredStatus;
    if ("DRAFT".equals(configuredStatus)) return "DRAFT";
    if (eventEndsAt != null && !now.isBefore(eventEndsAt)) return "FINISHED";
    if ("CLOSED".equals(configuredStatus)) return "CLOSED";
    if (!now.isBefore(endsAt)) return "CLOSED";
    if (("SCHEDULED".equals(configuredStatus) || "ACTIVE".equals(configuredStatus)) && !now.isBefore(startsAt)) return "ACTIVE";
    return configuredStatus;
  }

  static boolean timesOverlap(Instant firstStart, Instant firstEnd, Instant secondStart, Instant secondEnd) {
    return firstStart.isBefore(secondEnd) && firstEnd.isAfter(secondStart);
  }

  private ActivityView map(ResultSet rs, int rowNum) throws SQLException {
    String configured = rs.getString("status");
    return new ActivityView(rs.getLong("id"), rs.getLong("department_id"), rs.getString("department_name"),
        rs.getString("activity_code"), rs.getString("name"),
        rs.getString("description"), configured, configured, rs.getString("timezone"),
        UtcTime.read(rs, "starts_at"), UtcTime.read(rs, "ends_at"), UtcTime.read(rs, "event_ends_at"),
        rs.getString("customer_scope"), rs.getInt("company_ranking_top_n"),
        rs.getInt("branch_ranking_top_n"), rs.getInt("ton_display_scale"), rs.getInt("version"), List.of(), false, "TYPED", List.of(),
        UtcTime.read(rs, "published_at"), UtcTime.read(rs, "actual_started_at"), UtcTime.read(rs, "closed_at"),
        UtcTime.read(rs, "finished_at"), rs.getString("live_room_url"),
        backgroundUrl(rs, "h5_background_file_id"), backgroundUrl(rs, "desktop_background_file_id"));
  }

  private static String backgroundUrl(ResultSet rs, String column) throws SQLException {
    long id = rs.getLong(column);
    return rs.wasNull() ? null : "/api/v1/public/files/" + id;
  }

  private static void validateTime(Instant startsAt, Instant endsAt, Instant eventEndsAt) {
    if (startsAt == null || endsAt == null || !startsAt.isBefore(endsAt)) {
      throw DomainException.badRequest("ACTIVITY_TIME_INVALID", "活动开始时间必须早于截止时间");
    }
    if (eventEndsAt == null || !eventEndsAt.isAfter(endsAt)) {
      throw DomainException.badRequest("ACTIVITY_EVENT_TIME_INVALID", "整场活动结束时间必须晚于订货截止时间");
    }
  }

  private void requireFutureStart(Instant startsAt) {
    if (!startsAt.isAfter(now())) {
      throw DomainException.badRequest("ACTIVITY_START_NOT_FUTURE", "订货开始时间必须晚于当前时间");
    }
  }

  private void requireFutureEnd(Instant endsAt) {
    if (endsAt == null || !endsAt.isAfter(now())) {
      throw DomainException.badRequest("ACTIVITY_END_NOT_FUTURE", "订货截止时间必须晚于当前时间");
    }
  }

  @Transactional(isolation = org.springframework.transaction.annotation.Isolation.READ_COMMITTED)
  public ActivityView reopen(long id, int expectedVersion, Instant endsAt, Instant eventEndsAt,
      String reason, String traceId, AdminPrincipal admin) {
    admin.requireManager();
    departmentAccess.requireActivityAccess(admin, id);
    if (reason == null || reason.isBlank() || reason.trim().length() > 500) {
      throw DomainException.badRequest("ACTIVITY_REOPEN_REASON_INVALID", "请填写重新开放原因（最多 500 字）");
    }
    lockDepartmentForScheduleCheck(byId(id).departmentId());
    jdbc.queryForList("SELECT id FROM activity WHERE id = ? FOR UPDATE", Long.class, id);
    ActivityView current = byId(id);
    if (!List.of("CLOSED", "FINISHED").contains(current.status())) {
      throw DomainException.conflict("ACTIVITY_REOPEN_INVALID", "只有订货已截止或整场活动已结束时可以重新开放订货");
    }
    if (current.version() != expectedVersion) requireChanged(0);
    requireFutureEnd(endsAt);
    validateTime(current.startsAt(), endsAt, eventEndsAt);
    requireNoPublishedOverlap(id, current.departmentId(), current.startsAt(), eventEndsAt);
    int changed = jdbc.update("""
        UPDATE activity SET status = 'ACTIVE', ends_at = ?, event_ends_at = ?,
          closed_at = NULL, finished_at = NULL, version = version + 1, updated_by = ?
        WHERE id = ? AND version = ? AND deletion_requested_at IS NULL
        """, UtcTime.database(endsAt), UtcTime.database(eventEndsAt), admin.id(), id, expectedVersion);
    requireChanged(changed);
    jdbc.update("DELETE FROM activity_dashboard_snapshot WHERE activity_id = ?", id);
    jdbc.update("DELETE FROM activity_ranking_snapshot WHERE activity_id = ?", id);
    jdbc.update("""
        INSERT INTO audit_log(activity_id, actor_type, admin_user_id, action_code, object_type, object_id,
          reason, before_json, after_json, result, trace_id, occurred_at, actor_identity_snapshot, actor_role_snapshot)
        VALUES (?, 'ADMIN', ?, 'ACTIVITY_REOPEN', 'ACTIVITY', ?, ?,
          JSON_OBJECT('status', ?, 'endsAt', ?, 'eventEndsAt', ?, 'closedAt', ?, 'finishedAt', ?),
          JSON_OBJECT('status', 'ACTIVE', 'endsAt', ?, 'eventEndsAt', ?),
          'SUCCESS', ?, UTC_TIMESTAMP(3), ?, ?)
        """, id, admin.id(), String.valueOf(id), reason.trim(), current.status(), current.endsAt().toString(),
        current.eventEndsAt() == null ? null : current.eventEndsAt().toString(),
        current.closedAt() == null ? null : current.closedAt().toString(),
        current.finishedAt() == null ? null : current.finishedAt().toString(), endsAt.toString(), eventEndsAt.toString(),
        traceId, admin.displayName() + "（" + admin.username() + "）", admin.roleCode());
    outbox(id, "ACTIVITY_REOPENED");
    return byId(id);
  }

  private void requirePublishReady(long activityId) {
    Integer bindings = jdbc.queryForObject("""
        SELECT COUNT(DISTINCT data_type) FROM activity_data_binding
        WHERE activity_id = ? AND data_type IN ('PRODUCT', 'WHITELIST')
        """, Integer.class, activityId);
    if (bindings == null || bindings < 2) {
      throw DomainException.conflict("ACTIVITY_DATA_INCOMPLETE", "发布活动前必须发布商品和白名单");
    }
    List<BlockingImport> runningImports = jdbc.query("""
        SELECT t.import_type, t.id, t.status, f.original_filename
        FROM import_task t
        JOIN stored_file f ON f.id = t.source_file_id
        JOIN activity_data_binding b ON b.activity_id = t.activity_id AND b.data_type = t.import_type
        JOIN import_publish_version v ON v.id = b.current_version_id
        WHERE t.activity_id = ? AND t.import_type IN ('PRODUCT', 'WHITELIST')
          AND t.id > v.source_import_task_id
          AND t.status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
        ORDER BY t.id DESC
        """, (rs, rowNum) -> new BlockingImport(rs.getString("import_type"), rs.getLong("id"),
        rs.getString("status"), rs.getString("original_filename")), activityId);
    if (!runningImports.isEmpty()) {
      String detail = runningImports.stream().map(task ->
          ("PRODUCT".equals(task.importType()) ? "商品" : "白名单") + "“" + task.filename() + "”待确认")
          .distinct().collect(java.util.stream.Collectors.joining("；"));
      throw DomainException.conflict("ACTIVITY_IMPORT_IN_PROGRESS", detail + "，请确认或取消后再发布活动");
    }
  }

  private void requireNoPublishedOverlap(long activityId, long departmentId, Instant startsAt, Instant endsAt) {
    List<PublishedActivity> conflicts = jdbc.query("""
        SELECT activity_code, name, starts_at, COALESCE(event_ends_at, ends_at) FROM activity
        WHERE id <> ? AND department_id = ? AND deletion_requested_at IS NULL AND published_at IS NOT NULL
          AND status IN ('SCHEDULED', 'ACTIVE', 'CLOSED')
          AND starts_at < ? AND COALESCE(event_ends_at, ends_at) > ?
          AND COALESCE(event_ends_at, ends_at) > UTC_TIMESTAMP(3)
        ORDER BY starts_at, id
        """, (rs, rowNum) -> new PublishedActivity(rs.getString("activity_code"), rs.getString("name"),
            UtcTime.read(rs, 3), UtcTime.read(rs, 4)),
        activityId, departmentId, UtcTime.database(endsAt), UtcTime.database(startsAt));
    if (!conflicts.isEmpty()) {
      PublishedActivity conflict = conflicts.getFirst();
      throw DomainException.conflict("DEPARTMENT_ACTIVITY_TIME_CONFLICT",
          "当前部门活动时间与“" + conflict.name() + "”（" + conflict.code() + "，" + conflict.startsAt() + " 至 "
              + conflict.endsAt() + "）重叠，请调整时间或先结束已有活动");
    }
  }

  private void lockDepartmentForScheduleCheck(long departmentId) {
    List<Long> locked = jdbc.queryForList("SELECT id FROM department WHERE id = ? AND status = 'ACTIVE' FOR UPDATE",
        Long.class, departmentId);
    if (locked.size() != 1) throw DomainException.badRequest("DEPARTMENT_INVALID", "部门不存在或已停用");
  }

  private static Instant activityEnd(Instant endsAt, Instant eventEndsAt) {
    return eventEndsAt == null ? endsAt : eventEndsAt;
  }

  private record BlockingImport(String importType, long id, String status, String filename) {}
  private record PublishedActivity(String code, String name, Instant startsAt, Instant endsAt) {}

  private static void requirePublishedDataUnchanged(ActivityView current, ActivityWrite request) {
    if (!current.timezone().equals(request.timezone()) || !current.customerScope().equals(request.customerScope())) {
      throw DomainException.conflict("ACTIVITY_PUBLISHED_CONFIG_LOCKED", "活动发布后如需修改客户范围，请先撤回发布");
    }
  }

  private static void requireOnlyEventEndChanged(ActivityView current, ActivityWrite request) {
    boolean unchanged = current.name().equals(request.name())
        && java.util.Objects.equals(current.description(), request.description())
        && current.timezone().equals(request.timezone())
        && current.startsAt().truncatedTo(ChronoUnit.MINUTES).equals(request.startsAt().truncatedTo(ChronoUnit.MINUTES))
        && current.endsAt().truncatedTo(ChronoUnit.MINUTES).equals(request.endsAt().truncatedTo(ChronoUnit.MINUTES))
        && current.customerScope().equals(request.customerScope())
        && current.companyRankingTopN() == request.companyRankingTopN()
        && current.branchRankingTopN() == request.branchRankingTopN()
        && current.tonDisplayScale() == request.tonDisplayScale();
    if (!unchanged) {
      throw DomainException.conflict("ACTIVITY_CLOSED_CONFIG_LOCKED", "订货截止后只能延长整场活动结束时间");
    }
    requirePublishedDataUnchanged(current, request);
  }

  private void requireChanged(int changed) {
    if (changed != 1) throw DomainException.conflict("ACTIVITY_VERSION_CONFLICT", "活动状态已变化，请刷新后重试");
  }

  private void outbox(long activityId, String eventType) {
    jdbc.update("""
        INSERT INTO domain_event_outbox(activity_id, aggregate_type, aggregate_id, event_type, payload_json, available_at)
        VALUES (?, 'ACTIVITY', ?, ?, '{}', UTC_TIMESTAMP(3))
        """, activityId, String.valueOf(activityId), eventType);
    ActivityInfoChanges.record(jdbc, activityId);
  }

  private Instant now() { return clock.instant(); }
  static String generateActivityNo(long id, Instant createdAt, String timezone) {
    ZoneId zone;
    try { zone = ZoneId.of(timezone); } catch (Exception ignored) { zone = ZoneId.of("Asia/Shanghai"); }
    String date = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(zone).format(createdAt);
    return "HD" + date + String.format("%03d", id);
  }

  public record RegionView(String code, String name, int sortNo) {}
  public record RegionWrite(String code, String name, int sortNo) {}
  public record ActivityWrite(String code, String name, String description, String timezone, Instant startsAt,
                              Instant endsAt, Instant eventEndsAt, String customerScope, int companyRankingTopN,
                              int branchRankingTopN, int tonDisplayScale, List<RegionWrite> regions, Long departmentId) {}
  public record ActivityView(long id, long departmentId, String departmentName, String code, String name, String description, String status,
                             String configuredStatus, String timezone, Instant startsAt, Instant endsAt,
                             Instant eventEndsAt, String customerScope, int companyRankingTopN, int branchRankingTopN,
                              int tonDisplayScale, int version, List<RegionView> regions, boolean hasUnassignedGeneralCustomers,
                              String whitelistCustomerTypeMode, List<String> availableCustomerTypes,
                             Instant publishedAt,
                             Instant actualStartedAt, Instant closedAt, Instant finishedAt, String liveRoomUrl,
                             String h5BackgroundUrl, String desktopBackgroundUrl) {}

  @Transactional
  public ActivityView updateLiveRoom(long id, int expectedVersion, String url, AdminPrincipal admin) {
    admin.requireManager();
    departmentAccess.requireActivityAccess(admin, id);
    String normalized = validateLiveRoomUrl(url);
    int changed = jdbc.update("""
        UPDATE activity SET live_room_url = ?, updated_by = ?, version = version + 1
        WHERE id = ? AND version = ? AND deletion_requested_at IS NULL
        """, normalized, admin.id(), id, expectedVersion);
    requireChanged(changed);
    ActivityInfoChanges.record(jdbc, id);
    return byId(id);
  }

  static String validateLiveRoomUrl(String value) {
    if (value == null || value.isBlank()) return null;
    String url = value.trim();
    try {
      java.net.URI uri = new java.net.URI(url);
      if (url.length() > 2048 || !"https".equalsIgnoreCase(uri.getScheme())
          || uri.getHost() == null || uri.getUserInfo() != null
          || uri.getPort() > 65535 || url.contains("\\")) throw new IllegalArgumentException();
      return url;
    } catch (Exception error) {
      throw DomainException.badRequest("LIVE_ROOM_URL_INVALID", "请填写有效的 HTTPS 直播间链接（最多 2048 字符）");
    }
  }
}
