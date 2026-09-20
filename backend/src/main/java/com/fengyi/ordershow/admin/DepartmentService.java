package com.fengyi.ordershow.admin;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.DepartmentAccessService;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DepartmentService {
  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;
  private final DepartmentAccessService access;

  public DepartmentService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder, DepartmentAccessService access) {
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
    this.access = access;
  }

  public List<DepartmentView> listDepartments(AdminPrincipal admin) {
    access.requireSuperAdmin(admin);
    return jdbc.query("""
        SELECT d.id, d.department_code, d.department_name, d.status,
               u.id account_id, u.username account_username, u.display_name account_display_name,
               u.status account_status, u.last_login_at,
               COUNT(DISTINCT a.id) activity_count
        FROM department d
        LEFT JOIN admin_user u ON u.department_id = d.id AND u.role_code = 'DEPARTMENT_ADMIN'
        LEFT JOIN activity a ON a.department_id = d.id AND a.archived_at IS NULL
        GROUP BY d.id, d.department_code, d.department_name, d.status,
                 u.id, u.username, u.display_name, u.status, u.last_login_at
        ORDER BY d.id
        """, this::mapDepartment);
  }

  @Transactional
  public DepartmentView createDepartmentWithAccount(AdminPrincipal admin, String name, String username,
                                                    String password) {
    access.requireSuperAdmin(admin);
    String normalizedName = normalizeName(name);
    String normalizedUsername = normalizeUsername(username);
    validatePassword(password);
    String baseCode = generateDepartmentCode(normalizedName);
    long departmentId = 0;
    for (int attempt = 0; attempt < 1000; attempt++) {
      String generatedCode = attempt == 0 ? baseCode : baseCode + "-" + (attempt + 1);
      try {
        jdbc.update("INSERT INTO department(department_code, department_name, status) VALUES (?, ?, 'ACTIVE')",
            generatedCode, normalizedName);
        departmentId = jdbc.queryForObject("SELECT id FROM department WHERE department_code = ?", Long.class, generatedCode);
        break;
      } catch (DuplicateKeyException exception) {
        // A generated code can collide with a previous department (or a concurrent request).
        // Keep the code immutable after the successful insert and retry with a deterministic suffix.
      }
    }
    if (departmentId == 0) {
      throw DomainException.conflict("DEPARTMENT_CODE_GENERATION_FAILED", "部门编码生成失败，请稍后重试");
    }
    try {
      insertDepartmentAccount(normalizedUsername, password, departmentId, normalizedName);
    } catch (DuplicateKeyException exception) {
      throw DomainException.conflict("ADMIN_USER_EXISTS", "登录用户名已存在");
    }
    return department(departmentId);
  }

  @Transactional
  public DepartmentView updateDepartment(AdminPrincipal admin, long departmentId, String name, String status) {
    access.requireSuperAdmin(admin);
    DepartmentView current = department(departmentId);
    // department_code is intentionally absent from this update path: it is the stable scope identifier.
    String nextName = name == null || name.isBlank() ? current.name() : normalizeName(name);
    String nextStatus = status == null || status.isBlank() ? current.status() : status.trim().toUpperCase(Locale.ROOT);
    if (!List.of("ACTIVE", "DISABLED").contains(nextStatus)) {
      throw DomainException.badRequest("DEPARTMENT_STATUS_INVALID", "部门状态无效");
    }
    if ("DEFAULT".equals(current.code()) && "DISABLED".equals(nextStatus)) {
      throw DomainException.badRequest("DEFAULT_DEPARTMENT_REQUIRED", "默认业务部门不能停用");
    }
    if ("DISABLED".equals(nextStatus) && !"DISABLED".equals(current.status())) {
      Integer running = jdbc.queryForObject("""
          SELECT COUNT(*) FROM activity
          WHERE department_id = ? AND archived_at IS NULL AND status IN ('SCHEDULED', 'ACTIVE', 'CLOSED')
          """, Integer.class, departmentId);
      if (running != null && running > 0) {
        throw DomainException.conflict("DEPARTMENT_HAS_RUNNING_ACTIVITY", "该部门仍有未结束活动，不能停用");
      }
    }
    jdbc.update("UPDATE department SET department_name = ?, status = ?, lock_version = lock_version + 1 WHERE id = ?",
        nextName, nextStatus, departmentId);
    // The department name is the account display name by policy; keep the two values synchronized.
    jdbc.update("UPDATE admin_user SET display_name = ?, lock_version = lock_version + 1 WHERE department_id = ? AND role_code = 'DEPARTMENT_ADMIN'",
        nextName, departmentId);
    if ("DISABLED".equals(nextStatus)) {
      jdbc.update("UPDATE admin_session s JOIN admin_user u ON u.id = s.admin_user_id SET s.revoked_at = UTC_TIMESTAMP(3), s.revoke_reason = 'DEPARTMENT_DISABLED' WHERE u.department_id = ? AND s.revoked_at IS NULL", departmentId);
    }
    return department(departmentId);
  }

  public List<AdminUserView> listUsers(AdminPrincipal admin) {
    access.requireSuperAdmin(admin);
    return jdbc.query("""
        SELECT u.id, u.username, u.display_name, u.role_code, u.department_id, d.department_name,
               u.status, u.must_change_password, u.last_login_at, u.lock_version
        FROM admin_user u LEFT JOIN department d ON d.id = u.department_id
        ORDER BY u.id
        """, this::mapUser);
  }

  @Transactional
  public AdminUserView createDepartmentUser(AdminPrincipal admin, String username, String password,
                                             long departmentId) {
    access.requireSuperAdmin(admin);
    access.requireActiveDepartment(departmentId);
    DepartmentView department = department(departmentId);
    if (department.accountId() != null) {
      throw DomainException.conflict("ADMIN_USER_EXISTS", "该部门已绑定账号");
    }
    String normalizedUsername = normalizeUsername(username);
    validatePassword(password);
    try {
      insertDepartmentAccount(normalizedUsername, password, departmentId, department.name());
    } catch (DuplicateKeyException exception) {
      throw DomainException.conflict("ADMIN_USER_EXISTS", "登录用户名已存在");
    }
    long id = jdbc.queryForObject("SELECT id FROM admin_user WHERE username = ?", Long.class, normalizedUsername);
    return user(id);
  }

  @Transactional
  public AdminUserView updateUser(AdminPrincipal admin, long userId, String status, String password) {
    access.requireSuperAdmin(admin);
    AdminUserView current = user(userId);
    if (current.id() == admin.id() && "DISABLED".equalsIgnoreCase(status)) {
      throw DomainException.badRequest("ADMIN_SELF_DISABLE", "不能停用当前登录账号");
    }
    String nextStatus = status == null || status.isBlank() ? current.status() : status.trim().toUpperCase(Locale.ROOT);
    if (!List.of("ACTIVE", "DISABLED").contains(nextStatus)) {
      throw DomainException.badRequest("ADMIN_STATUS_INVALID", "账号状态无效");
    }
    boolean reset = password != null && !password.isBlank();
    if (reset) validatePassword(password);
    String nextDisplayName = "DEPARTMENT_ADMIN".equals(current.roleCode()) && current.departmentName() != null
        ? current.departmentName() : current.displayName();
    if (reset) {
      boolean mustChange = "SUPER_ADMIN".equals(current.roleCode());
      jdbc.update("UPDATE admin_user SET display_name = ?, status = ?, password_hash = ?, must_change_password = ?, password_changed_at = CASE WHEN ? THEN NULL ELSE UTC_TIMESTAMP(3) END, lock_version = lock_version + 1 WHERE id = ?",
          nextDisplayName, nextStatus, passwordEncoder.encode(password), mustChange, mustChange, userId);
      jdbc.update("UPDATE admin_session SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'PASSWORD_RESET' WHERE admin_user_id = ? AND revoked_at IS NULL", userId);
    } else {
      jdbc.update("UPDATE admin_user SET display_name = ?, status = ?, lock_version = lock_version + 1 WHERE id = ?",
          nextDisplayName, nextStatus, userId);
    }
    if ("DISABLED".equals(nextStatus)) {
      jdbc.update("UPDATE admin_session SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'USER_DISABLED' WHERE admin_user_id = ? AND revoked_at IS NULL", userId);
    }
    return user(userId);
  }

  private void insertDepartmentAccount(String username, String password, long departmentId, String departmentName) {
    jdbc.update("""
        INSERT INTO admin_user(username, display_name, password_hash, role_code, department_id, status,
                               must_change_password, password_changed_at)
        VALUES (?, ?, ?, 'DEPARTMENT_ADMIN', ?, 'ACTIVE', FALSE, UTC_TIMESTAMP(3))
        """, username, departmentName, passwordEncoder.encode(password), departmentId);
  }

  private DepartmentView department(long id) {
    return jdbc.query("""
        SELECT d.id, d.department_code, d.department_name, d.status,
               u.id account_id, u.username account_username, u.display_name account_display_name,
               u.status account_status, u.last_login_at,
               COUNT(DISTINCT a.id) activity_count
        FROM department d
        LEFT JOIN admin_user u ON u.department_id = d.id AND u.role_code = 'DEPARTMENT_ADMIN'
        LEFT JOIN activity a ON a.department_id = d.id AND a.archived_at IS NULL
        WHERE d.id = ?
        GROUP BY d.id, d.department_code, d.department_name, d.status,
                 u.id, u.username, u.display_name, u.status, u.last_login_at
        """, this::mapDepartment, id).stream().findFirst()
        .orElseThrow(() -> DomainException.notFound("DEPARTMENT_NOT_FOUND", "部门不存在"));
  }

  private AdminUserView user(long id) {
    return jdbc.query("""
        SELECT u.id, u.username, u.display_name, u.role_code, u.department_id, d.department_name,
               u.status, u.must_change_password, u.last_login_at, u.lock_version
        FROM admin_user u LEFT JOIN department d ON d.id = u.department_id WHERE u.id = ?
        """, this::mapUser, id).stream().findFirst()
        .orElseThrow(() -> DomainException.notFound("ADMIN_USER_NOT_FOUND", "管理员账号不存在"));
  }

  private DepartmentView mapDepartment(ResultSet rs, int rowNum) throws SQLException {
    return new DepartmentView(rs.getLong("id"), rs.getString("department_code"), rs.getString("department_name"),
        rs.getString("status"), nullableLong(rs, "account_id"), rs.getString("account_username"),
        rs.getString("account_display_name"), rs.getString("account_status"),
        rs.getTimestamp("last_login_at") == null ? null : rs.getTimestamp("last_login_at").toInstant(),
        rs.getLong("activity_count"));
  }

  private AdminUserView mapUser(ResultSet rs, int rowNum) throws SQLException {
    return new AdminUserView(rs.getLong("id"), rs.getString("username"), rs.getString("display_name"),
        rs.getString("role_code"), nullableLong(rs, "department_id"), rs.getString("department_name"),
        rs.getString("status"), rs.getBoolean("must_change_password"),
        rs.getTimestamp("last_login_at") == null ? null : rs.getTimestamp("last_login_at").toInstant(),
        rs.getInt("lock_version"));
  }

  /**
   * MySQL may expose BIGINT UNSIGNED values as BigInteger. Convert through Number
   * instead of casting directly to Long so account/department IDs map reliably.
   */
  private static Long nullableLong(ResultSet rs, String column) throws SQLException {
    Object value = rs.getObject(column);
    if (value == null) return null;
    if (value instanceof Number number) return number.longValue();
    return Long.valueOf(value.toString());
  }

  static String generateDepartmentCode(String normalizedName) {
    String stem = normalizedName.replaceAll("[^A-Za-z0-9]+", "-")
        .replaceAll("^-+|-+$", "")
        .toUpperCase(Locale.ROOT);
    if (stem.isBlank()) stem = "DEPT";
    if (stem.length() > 40) stem = stem.substring(0, 40);
    return stem + "-" + String.format(Locale.ROOT, "%08X", fnv1a(normalizedName));
  }

  private static long fnv1a(String value) {
    long hash = 0x811C9DC5L;
    byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
    for (byte valueByte : bytes) {
      hash ^= valueByte & 0xFFL;
      hash = (hash * 0x01000193L) & 0xFFFFFFFFL;
    }
    return hash;
  }

  private static String normalizeUsername(String value) {
    if (value == null || !value.trim().matches("[A-Za-z0-9][A-Za-z0-9_.@-]{2,63}")) {
      throw DomainException.badRequest("ADMIN_USERNAME_INVALID", "用户名须为 3-64 位字母、数字或常用符号");
    }
    return value.trim();
  }

  private static String normalizeName(String value) {
    if (value == null || value.trim().isBlank() || value.trim().length() > 100) {
      throw DomainException.badRequest("NAME_INVALID", "名称不能为空且不能超过 100 个字符");
    }
    return value.trim();
  }

  private static void validatePassword(String value) {
    if (value == null || value.length() < 8 || value.length() > 100) {
      throw DomainException.badRequest("PASSWORD_INVALID", "登录密码长度须为 8-100 位");
    }
  }

  public record DepartmentView(long id, String code, String name, String status, Long accountId,
                               String accountUsername, String accountDisplayName, String accountStatus,
                               Instant lastLoginAt, long activityCount) {}

  public record AdminUserView(long id, String username, String displayName, String roleCode, Long departmentId,
                              String departmentName, String status, boolean mustChangePassword,
                              Instant lastLoginAt, int lockVersion) {}
}
