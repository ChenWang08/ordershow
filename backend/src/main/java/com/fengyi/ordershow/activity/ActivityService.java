package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ActivityService {
  private final JdbcTemplate jdbc;
  private final Clock clock;

  @org.springframework.beans.factory.annotation.Autowired
  public ActivityService(JdbcTemplate jdbc) {
    this(jdbc, Clock.systemUTC());
  }

  ActivityService(JdbcTemplate jdbc, Clock clock) {
    this.jdbc = jdbc;
    this.clock = clock;
  }

  public ActivityView byCode(String code) {
    List<ActivityView> rows = jdbc.query("SELECT * FROM activity WHERE activity_code = ? AND archived_at IS NULL", this::map, code);
    if (rows.size() != 1) throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
    return withRegions(rows.getFirst());
  }

  public ActivityView byId(long id) {
    List<ActivityView> rows = jdbc.query("SELECT * FROM activity WHERE id = ? AND archived_at IS NULL", this::map, id);
    if (rows.size() != 1) throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
    return withRegions(rows.getFirst());
  }

  public ActivityView currentOrderable() {
    List<ActivityView> rows = jdbc.query("""
        SELECT * FROM activity
        WHERE archived_at IS NULL AND published_at IS NOT NULL AND closed_at IS NULL
          AND status IN ('SCHEDULED', 'ACTIVE')
          AND starts_at <= UTC_TIMESTAMP(3) AND ends_at > UTC_TIMESTAMP(3)
        ORDER BY starts_at, id
        """, this::map);
    if (rows.isEmpty()) {
      throw DomainException.notFound("CURRENT_ACTIVITY_NOT_FOUND", "当前暂无可下单活动");
    }
    if (rows.size() > 1) {
      throw DomainException.conflict("CURRENT_ACTIVITY_CONFLICT", "活动时间配置冲突，请联系工作人员处理");
    }
    return withRegions(rows.getFirst());
  }

  public List<ActivityView> list() {
    return jdbc.query("SELECT * FROM activity WHERE archived_at IS NULL ORDER BY created_at DESC", this::map)
        .stream().map(this::withRegions).toList();
  }

  @Transactional
  public ActivityView create(ActivityWrite request, AdminPrincipal admin) {
    validateTime(request.startsAt(), request.endsAt());
    requireFutureStart(request.startsAt());
    String temporaryCode = "PENDING-" + UUID.randomUUID();
    jdbc.update("""
        INSERT INTO activity(activity_code, name, description, status, timezone, starts_at, ends_at,
                             customer_scope, company_ranking_top_n, branch_ranking_top_n, ton_display_scale,
                             created_by, updated_by)
        VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, temporaryCode, request.name(), request.description(), request.timezone(), Timestamp.from(request.startsAt()),
        Timestamp.from(request.endsAt()), request.customerScope(), request.companyRankingTopN(), request.branchRankingTopN(),
        request.tonDisplayScale(), admin.id(), admin.id());
    Long id = jdbc.queryForObject("SELECT id FROM activity WHERE activity_code = ?", Long.class, temporaryCode);
    String activityNo = generateActivityNo(id, now(), request.timezone());
    int numbered = jdbc.update("UPDATE activity SET activity_code = ? WHERE id = ? AND activity_code = ?", activityNo, id, temporaryCode);
    if (numbered != 1) throw new IllegalStateException("活动编号生成失败");
    replaceRegions(id, request.regions());
    return byId(id);
  }

  @Transactional
  public ActivityView update(long id, int expectedVersion, ActivityWrite request, AdminPrincipal admin) {
    validateTime(request.startsAt(), request.endsAt());
    ActivityView current = byId(id);
    String effective = current.status();
    if ("CLOSED".equals(effective) || "ARCHIVED".equals(effective)) {
      throw DomainException.conflict("ACTIVITY_READ_ONLY", "活动截止后不能修改配置");
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
      if (request.endsAt().truncatedTo(ChronoUnit.MINUTES).isBefore(current.endsAt().truncatedTo(ChronoUnit.MINUTES))) {
        throw DomainException.conflict("ACTIVITY_END_CAN_ONLY_EXTEND", "活动进行中只能延长订货截止时间；如需停止请使用立即截止订货");
      }
      requirePublishedDataUnchanged(current, request);
    }
    Instant startsAtToSave = "ACTIVE".equals(effective) ? current.startsAt() : request.startsAt();
    Instant endsAtToSave = "ACTIVE".equals(effective)
        && request.endsAt().truncatedTo(ChronoUnit.MINUTES).equals(current.endsAt().truncatedTo(ChronoUnit.MINUTES))
        ? current.endsAt() : request.endsAt();
    if ("SCHEDULED".equals(effective) || "ACTIVE".equals(effective)) {
      lockActivitiesForScheduleCheck();
      requireNoPublishedOverlap(id, startsAtToSave, endsAtToSave);
    }
    int changed = jdbc.update("""
        UPDATE activity SET name = ?, description = ?, timezone = ?, starts_at = ?, ends_at = ?, customer_scope = ?,
          company_ranking_top_n = ?, branch_ranking_top_n = ?, ton_display_scale = ?, updated_by = ?, version = version + 1
        WHERE id = ? AND version = ?
        """, request.name(), request.description(), request.timezone(), Timestamp.from(startsAtToSave),
        Timestamp.from(endsAtToSave), request.customerScope(), request.companyRankingTopN(), request.branchRankingTopN(),
        request.tonDisplayScale(), admin.id(), id, expectedVersion);
    if (changed != 1) throw DomainException.conflict("ACTIVITY_VERSION_CONFLICT", "活动配置已被其他页面修改，请刷新后重试");
    replaceRegions(id, request.regions());
    return byId(id);
  }

  @Transactional
  public ActivityView publish(long id, int expectedVersion, AdminPrincipal admin) {
    ActivityView current = byId(id);
    if (!"DRAFT".equals(current.configuredStatus())) {
      throw DomainException.conflict("ACTIVITY_PUBLISH_INVALID", "只有草稿活动可以发布");
    }
    requireFutureStart(current.startsAt());
    requirePublishReady(id);
    lockActivitiesForScheduleCheck();
    requireNoPublishedOverlap(id, current.startsAt(), current.endsAt());
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

  public void requireWritable(long activityId) {
    ActivityView activity = byId(activityId);
    Instant now = now();
    if (!"ACTIVE".equals(activity.status()) || !now.isBefore(activity.endsAt())) {
      throw DomainException.conflict("ACTIVITY_NOT_WRITABLE", "活动当前不允许提交或修改订单");
    }
  }

  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 30_000)
  void synchronizeTimedActivities() {
    List<Long> starting = jdbc.queryForList("""
        SELECT id FROM activity WHERE status = 'SCHEDULED'
          AND starts_at <= UTC_TIMESTAMP(3) AND ends_at > UTC_TIMESTAMP(3)
        """, Long.class);
    for (Long id : starting) {
      int changed = jdbc.update("""
          UPDATE activity SET status = 'ACTIVE', actual_started_at = COALESCE(actual_started_at, UTC_TIMESTAMP(3)), version = version + 1
          WHERE id = ? AND status = 'SCHEDULED' AND starts_at <= UTC_TIMESTAMP(3) AND ends_at > UTC_TIMESTAMP(3)
          """, id);
      if (changed == 1) outbox(id, "ACTIVITY_STARTED");
    }
    List<Long> closing = jdbc.queryForList("""
        SELECT id FROM activity WHERE status IN ('SCHEDULED', 'ACTIVE') AND ends_at <= UTC_TIMESTAMP(3)
        """, Long.class);
    for (Long id : closing) {
      int changed = jdbc.update("""
          UPDATE activity SET status = 'CLOSED', closed_at = COALESCE(closed_at, UTC_TIMESTAMP(3)), version = version + 1
          WHERE id = ? AND status IN ('SCHEDULED', 'ACTIVE') AND ends_at <= UTC_TIMESTAMP(3)
          """, id);
      if (changed == 1) outbox(id, "ACTIVITY_CLOSED");
    }
  }

  private ActivityView withRegions(ActivityView value) {
    List<RegionView> regions = jdbc.query("""
        SELECT region_code, region_name, sort_no FROM activity_region
        WHERE activity_id = ? AND is_active = TRUE ORDER BY sort_no, id
        """, (rs, rowNum) -> new RegionView(rs.getString(1), rs.getString(2), rs.getInt(3)), value.id());
    return new ActivityView(value.id(), value.code(), value.name(), value.description(), effectiveStatus(value),
        value.configuredStatus(), value.timezone(), value.startsAt(), value.endsAt(), value.customerScope(),
        value.companyRankingTopN(), value.branchRankingTopN(), value.tonDisplayScale(), value.version(), regions,
        value.publishedAt(), value.actualStartedAt(), value.closedAt());
  }

  private String effectiveStatus(ActivityView value) {
    return effectiveStatus(value.configuredStatus(), value.startsAt(), value.endsAt(), now());
  }

  static String effectiveStatus(String configuredStatus, Instant startsAt, Instant endsAt, Instant now) {
    if ("ARCHIVED".equals(configuredStatus) || "CLOSED".equals(configuredStatus)) return configuredStatus;
    if ("DRAFT".equals(configuredStatus)) return "DRAFT";
    if (!now.isBefore(endsAt)) return "CLOSED";
    if (("SCHEDULED".equals(configuredStatus) || "ACTIVE".equals(configuredStatus)) && !now.isBefore(startsAt)) return "ACTIVE";
    return configuredStatus;
  }

  static boolean timesOverlap(Instant firstStart, Instant firstEnd, Instant secondStart, Instant secondEnd) {
    return firstStart.isBefore(secondEnd) && firstEnd.isAfter(secondStart);
  }

  private void replaceRegions(long activityId, List<RegionWrite> regions) {
    jdbc.update("UPDATE activity_region SET is_active = FALSE WHERE activity_id = ?", activityId);
    if (regions == null) return;
    for (RegionWrite region : regions) {
      jdbc.update("""
          INSERT INTO activity_region(activity_id, region_code, region_name, sort_no, is_active)
          VALUES (?, ?, ?, ?, TRUE)
          ON DUPLICATE KEY UPDATE region_name = VALUES(region_name), sort_no = VALUES(sort_no), is_active = TRUE
          """, activityId, region.code(), region.name(), region.sortNo());
    }
  }

  private ActivityView map(ResultSet rs, int rowNum) throws SQLException {
    String configured = rs.getString("status");
    return new ActivityView(rs.getLong("id"), rs.getString("activity_code"), rs.getString("name"),
        rs.getString("description"), configured, configured, rs.getString("timezone"),
        rs.getTimestamp("starts_at").toInstant(), rs.getTimestamp("ends_at").toInstant(),
        rs.getString("customer_scope"), rs.getInt("company_ranking_top_n"),
        rs.getInt("branch_ranking_top_n"), rs.getInt("ton_display_scale"), rs.getInt("version"), List.of(),
        instant(rs.getTimestamp("published_at")), instant(rs.getTimestamp("actual_started_at")), instant(rs.getTimestamp("closed_at")));
  }

  private static void validateTime(Instant startsAt, Instant endsAt) {
    if (startsAt == null || endsAt == null || !startsAt.isBefore(endsAt)) {
      throw DomainException.badRequest("ACTIVITY_TIME_INVALID", "活动开始时间必须早于截止时间");
    }
  }

  private void requireFutureStart(Instant startsAt) {
    if (!startsAt.isAfter(now())) {
      throw DomainException.badRequest("ACTIVITY_START_NOT_FUTURE", "订货开始时间必须晚于当前时间");
    }
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

  private void requireNoPublishedOverlap(long activityId, Instant startsAt, Instant endsAt) {
    List<PublishedActivity> conflicts = jdbc.query("""
        SELECT activity_code, name FROM activity
        WHERE id <> ? AND archived_at IS NULL AND published_at IS NOT NULL AND closed_at IS NULL
          AND status IN ('SCHEDULED', 'ACTIVE') AND starts_at < ? AND ends_at > ?
        ORDER BY starts_at, id
        """, (rs, rowNum) -> new PublishedActivity(rs.getString("activity_code"), rs.getString("name")),
        activityId, Timestamp.from(endsAt), Timestamp.from(startsAt));
    if (!conflicts.isEmpty()) {
      PublishedActivity conflict = conflicts.getFirst();
      throw DomainException.conflict("ACTIVITY_TIME_CONFLICT",
          "活动时间与“" + conflict.name() + "”（" + conflict.code() + "）重叠，请调整后再发布");
    }
  }

  private void lockActivitiesForScheduleCheck() {
    jdbc.queryForList("SELECT id FROM activity WHERE archived_at IS NULL ORDER BY id FOR UPDATE", Long.class);
  }

  private record BlockingImport(String importType, long id, String status, String filename) {}
  private record PublishedActivity(String code, String name) {}

  private static void requirePublishedDataUnchanged(ActivityView current, ActivityWrite request) {
    List<RegionWrite> requestedRegions = request.regions() == null ? List.of() : request.regions();
    if (!current.timezone().equals(request.timezone()) || !current.customerScope().equals(request.customerScope())
        || !current.regions().equals(requestedRegions.stream().map(r -> new RegionView(r.code(), r.name(), r.sortNo())).toList())) {
      throw DomainException.conflict("ACTIVITY_PUBLISHED_CONFIG_LOCKED", "活动发布后如需修改客户范围或区域，请先撤回发布");
    }
  }

  private void requireChanged(int changed) {
    if (changed != 1) throw DomainException.conflict("ACTIVITY_VERSION_CONFLICT", "活动状态已变化，请刷新后重试");
  }

  private void outbox(long activityId, String eventType) {
    jdbc.update("""
        INSERT INTO domain_event_outbox(activity_id, aggregate_type, aggregate_id, event_type, payload_json, available_at)
        VALUES (?, 'ACTIVITY', ?, ?, '{}', UTC_TIMESTAMP(3))
        """, activityId, String.valueOf(activityId), eventType);
  }

  private Instant now() { return clock.instant(); }
  static String generateActivityNo(long id, Instant createdAt, String timezone) {
    ZoneId zone;
    try { zone = ZoneId.of(timezone); } catch (Exception ignored) { zone = ZoneId.of("Asia/Shanghai"); }
    String date = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(zone).format(createdAt);
    return "HD" + date + String.format("%03d", id);
  }
  private static Instant instant(Timestamp value) { return value == null ? null : value.toInstant(); }

  public record RegionView(String code, String name, int sortNo) {}
  public record RegionWrite(String code, String name, int sortNo) {}
  public record ActivityWrite(String code, String name, String description, String timezone, Instant startsAt,
                              Instant endsAt, String customerScope, int companyRankingTopN,
                              int branchRankingTopN, int tonDisplayScale, List<RegionWrite> regions) {}
  public record ActivityView(long id, String code, String name, String description, String status,
                             String configuredStatus, String timezone, Instant startsAt, Instant endsAt,
                             String customerScope, int companyRankingTopN, int branchRankingTopN,
                             int tonDisplayScale, int version, List<RegionView> regions, Instant publishedAt,
                             Instant actualStartedAt, Instant closedAt) {}
}
