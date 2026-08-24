package com.fengyi.ordershow.activity;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ActivityService {
  private final JdbcTemplate jdbc;

  public ActivityService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
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

  public List<ActivityView> list() {
    return jdbc.query("SELECT * FROM activity WHERE archived_at IS NULL ORDER BY created_at DESC", this::map)
        .stream().map(this::withRegions).toList();
  }

  @Transactional
  public ActivityView create(ActivityWrite request, AdminPrincipal admin) {
    validateTime(request.startsAt(), request.endsAt());
    int duplicate = jdbc.queryForObject("SELECT COUNT(*) FROM activity WHERE activity_code = ?", Integer.class, request.code());
    if (duplicate > 0) throw DomainException.conflict("ACTIVITY_CODE_EXISTS", "活动编号已存在");
    jdbc.update("""
        INSERT INTO activity(activity_code, name, description, status, timezone, starts_at, ends_at,
                             customer_scope, company_ranking_top_n, branch_ranking_top_n, ton_display_scale,
                             created_by, updated_by)
        VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, request.code(), request.name(), request.description(), request.timezone(), Timestamp.from(request.startsAt()),
        Timestamp.from(request.endsAt()), request.customerScope(), request.companyRankingTopN(), request.branchRankingTopN(),
        request.tonDisplayScale(), admin.id(), admin.id());
    Long id = jdbc.queryForObject("SELECT id FROM activity WHERE activity_code = ?", Long.class, request.code());
    replaceRegions(id, request.regions());
    return byId(id);
  }

  @Transactional
  public ActivityView update(long id, int expectedVersion, ActivityWrite request, AdminPrincipal admin) {
    validateTime(request.startsAt(), request.endsAt());
    ActivityView current = byId(id);
    if ("CLOSED".equals(current.status()) || "ARCHIVED".equals(current.status())) {
      throw DomainException.conflict("ACTIVITY_READ_ONLY", "活动截止后不能修改配置");
    }
    int changed = jdbc.update("""
        UPDATE activity SET name = ?, description = ?, timezone = ?, starts_at = ?, ends_at = ?, customer_scope = ?,
          company_ranking_top_n = ?, branch_ranking_top_n = ?, ton_display_scale = ?, updated_by = ?, version = version + 1
        WHERE id = ? AND version = ?
        """, request.name(), request.description(), request.timezone(), Timestamp.from(request.startsAt()),
        Timestamp.from(request.endsAt()), request.customerScope(), request.companyRankingTopN(), request.branchRankingTopN(),
        request.tonDisplayScale(), admin.id(), id, expectedVersion);
    if (changed != 1) throw DomainException.conflict("ACTIVITY_VERSION_CONFLICT", "活动配置已被其他页面修改，请刷新后重试");
    replaceRegions(id, request.regions());
    return byId(id);
  }

  @Transactional
  public ActivityView transition(long id, int expectedVersion, String target, AdminPrincipal admin) {
    ActivityView current = byId(id);
    boolean valid = switch (current.status() + "->" + target) {
      case "DRAFT->SCHEDULED", "SCHEDULED->DRAFT", "SCHEDULED->ACTIVE", "DRAFT->ACTIVE", "ACTIVE->CLOSED" -> true;
      default -> false;
    };
    if (!valid) throw DomainException.conflict("ACTIVITY_TRANSITION_INVALID", "不能从当前状态切换到目标状态");
    if ("ACTIVE".equals(target)) {
      Integer bindings = jdbc.queryForObject("SELECT COUNT(*) FROM activity_data_binding WHERE activity_id = ? AND data_type IN ('PRODUCT','WHITELIST')", Integer.class, id);
      if (bindings == null || bindings < 2) throw DomainException.conflict("ACTIVITY_DATA_INCOMPLETE", "开始活动前必须发布商品和白名单");
    }
    int changed = jdbc.update("UPDATE activity SET status = ?, version = version + 1, updated_by = ? WHERE id = ? AND version = ?",
        target, admin.id(), id, expectedVersion);
    if (changed != 1) throw DomainException.conflict("ACTIVITY_VERSION_CONFLICT", "活动状态已变化，请刷新后重试");
    return byId(id);
  }

  public void requireWritable(long activityId) {
    ActivityView activity = byId(activityId);
    Instant now = Instant.now();
    if (!"ACTIVE".equals(activity.status()) || now.isBefore(activity.startsAt()) || !now.isBefore(activity.endsAt())) {
      throw DomainException.conflict("ACTIVITY_NOT_WRITABLE", "活动当前不允许提交或修改订单");
    }
  }

  @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 30_000)
  void closeExpiredActivities() {
    jdbc.update("UPDATE activity SET status = 'CLOSED', version = version + 1 WHERE status = 'ACTIVE' AND ends_at <= UTC_TIMESTAMP(3)");
  }

  private ActivityView withRegions(ActivityView value) {
    List<RegionView> regions = jdbc.query("""
        SELECT region_code, region_name, sort_no FROM activity_region
        WHERE activity_id = ? AND is_active = TRUE ORDER BY sort_no, id
        """, (rs, rowNum) -> new RegionView(rs.getString(1), rs.getString(2), rs.getInt(3)), value.id());
    return new ActivityView(value.id(), value.code(), value.name(), value.description(), effectiveStatus(value),
        value.configuredStatus(), value.timezone(), value.startsAt(), value.endsAt(), value.customerScope(),
        value.companyRankingTopN(), value.branchRankingTopN(), value.tonDisplayScale(), value.version(), regions);
  }

  private String effectiveStatus(ActivityView value) {
    Instant now = Instant.now();
    if ("ARCHIVED".equals(value.configuredStatus()) || "CLOSED".equals(value.configuredStatus())) return value.configuredStatus();
    if (!now.isBefore(value.endsAt())) return "CLOSED";
    if ("ACTIVE".equals(value.configuredStatus()) && !now.isBefore(value.startsAt())) return "ACTIVE";
    return value.configuredStatus();
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
        rs.getInt("branch_ranking_top_n"), rs.getInt("ton_display_scale"), rs.getInt("version"), List.of());
  }

  private static void validateTime(Instant startsAt, Instant endsAt) {
    if (startsAt == null || endsAt == null || !startsAt.isBefore(endsAt)) {
      throw DomainException.badRequest("ACTIVITY_TIME_INVALID", "活动开始时间必须早于截止时间");
    }
  }

  public record RegionView(String code, String name, int sortNo) {}
  public record RegionWrite(String code, String name, int sortNo) {}
  public record ActivityWrite(String code, String name, String description, String timezone, Instant startsAt,
                              Instant endsAt, String customerScope, int companyRankingTopN,
                              int branchRankingTopN, int tonDisplayScale, List<RegionWrite> regions) {}
  public record ActivityView(long id, String code, String name, String description, String status,
                             String configuredStatus, String timezone, Instant startsAt, Instant endsAt,
                             String customerScope, int companyRankingTopN, int branchRankingTopN,
                             int tonDisplayScale, int version, List<RegionView> regions) {}
}
