package com.fengyi.ordershow.config;

import com.fengyi.ordershow.common.UtcTime;

import com.fengyi.ordershow.customer.AttendanceMatchingService;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@org.springframework.core.annotation.Order(100)
public class BootstrapData implements ApplicationRunner {
  private static final Logger log = LoggerFactory.getLogger(BootstrapData.class);
  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;
  private final OrderShowProperties properties;
  private final AttendanceMatchingService attendanceMatching;

  public BootstrapData(JdbcTemplate jdbc, PasswordEncoder passwordEncoder, OrderShowProperties properties,
      AttendanceMatchingService attendanceMatching) {
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
    this.properties = properties;
    this.attendanceMatching = attendanceMatching;
  }

  @Override
  @Transactional
  public void run(ApplicationArguments args) {
    Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM admin_user", Integer.class);
    if (count != null && count == 0) {
      jdbc.update("""
          INSERT INTO admin_user(username, display_name, password_hash, role_code, department_id, status, must_change_password)
          VALUES (?, ?, ?, 'SUPER_ADMIN', NULL, 'ACTIVE', TRUE)
          """, properties.bootstrapAdminUsername(), properties.bootstrapAdminDisplayName(),
          passwordEncoder.encode(properties.bootstrapAdminPassword()));
      log.warn("Created bootstrap administrator '{}'; change the initial password immediately", properties.bootstrapAdminUsername());
    }
    Long adminId = jdbc.queryForObject("SELECT id FROM admin_user ORDER BY id LIMIT 1", Long.class);
    Integer activities = jdbc.queryForObject("SELECT COUNT(*) FROM activity", Integer.class);
    if (activities != null && activities == 0 && adminId != null) {
      Instant starts = Instant.now().plus(1, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
      Instant ends = starts.plus(14, ChronoUnit.DAYS);
      jdbc.update("""
          INSERT INTO activity(department_id, activity_code, name, description, status, timezone, starts_at, ends_at,
                               customer_scope, created_by, updated_by)
          VALUES (?, '2026-mid-autumn', '2026 年中秋订货会', '订购会本地开发活动', 'DRAFT', 'Asia/Shanghai', ?, ?, 'ALL', ?, ?)
          """, defaultDepartmentId(), UtcTime.database(starts), UtcTime.database(ends), adminId, adminId);
      Long activityId = jdbc.queryForObject("SELECT id FROM activity WHERE activity_code = '2026-mid-autumn'", Long.class);
      if (activityId != null) {
        jdbc.batchUpdate("INSERT INTO activity_region(activity_id, region_code, region_name, sort_no) VALUES (?, ?, ?, ?)",
            java.util.List.of(
                new Object[]{activityId, "EAST", "东区", 10},
                new Object[]{activityId, "SOUTH", "南区", 20},
                new Object[]{activityId, "NORTH", "北区", 30}
            ));
      }
    }
    jdbc.queryForList("""
        SELECT DISTINCT wb.activity_id, wb.current_version_id
        FROM activity_data_binding wb
        JOIN activity_data_binding ab ON ab.activity_id = wb.activity_id AND ab.data_type = 'ATTENDANCE'
        WHERE wb.data_type = 'WHITELIST'
        """).forEach(row -> attendanceMatching.reassociateCurrentAttendance(
            ((Number) row.get("activity_id")).longValue(), ((Number) row.get("current_version_id")).longValue()));
  }

  private Long defaultDepartmentId() {
    return jdbc.queryForObject("SELECT id FROM department WHERE department_code = 'DEFAULT'", Long.class);
  }
}
