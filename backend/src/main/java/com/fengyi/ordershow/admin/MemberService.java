package com.fengyi.ordershow.admin;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPermission;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.DepartmentAccessService;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MemberService {
  private static final String MEMBER_SELECT = """
      SELECT u.*, d.department_name,
        (SELECT GROUP_CONCAT(p.permission_code ORDER BY p.permission_code) FROM admin_user_permission p WHERE p.admin_user_id=u.id) permission_codes
      FROM admin_user u JOIN department d ON d.id=u.department_id
      WHERE u.role_code='DEPARTMENT_MEMBER'
      """;
  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwords;
  private final DepartmentAccessService access;

  public MemberService(JdbcTemplate jdbc, PasswordEncoder passwords, DepartmentAccessService access) {
    this.jdbc = jdbc; this.passwords = passwords; this.access = access;
  }

  public List<MemberView> list(AdminPrincipal admin, Long departmentId) {
    admin.requireManager();
    Long scope = admin.isSuperAdmin() ? departmentId : admin.departmentId();
    if (!admin.isSuperAdmin() && scope == null) throw DomainException.forbidden("DEPARTMENT_REQUIRED", "账号未绑定部门");
    return jdbc.query(MEMBER_SELECT + " AND (? IS NULL OR u.department_id=?) ORDER BY u.id DESC", this::mapMember, scope, scope);
  }

  @Transactional
  public MemberView create(AdminPrincipal admin, Long departmentId, String username, String displayName,
                           String password, Set<AdminPermission> permissions) {
    admin.requireManager();
    Long scope = admin.isSuperAdmin() ? departmentId : admin.departmentId();
    if (scope == null) throw DomainException.badRequest("DEPARTMENT_REQUIRED", "请选择所属部门");
    if (!admin.isSuperAdmin() && departmentId != null && !departmentId.equals(scope))
      throw DomainException.forbidden("DEPARTMENT_SCOPE_DENIED", "只能创建本部门成员");
    access.requireDepartmentAccess(admin, scope);
    if (username == null || !username.trim().matches("[A-Za-z0-9][A-Za-z0-9_.@-]{2,63}"))
      throw DomainException.badRequest("ADMIN_USERNAME_INVALID", "用户名须为 3-64 位字母、数字或常用符号");
    validateName(displayName); validatePassword(password);
    try {
      jdbc.update("""
          INSERT INTO admin_user(username,display_name,password_hash,role_code,department_id,status,must_change_password,password_changed_at)
          VALUES (?,?,?,'DEPARTMENT_MEMBER',?,'ACTIVE',FALSE,UTC_TIMESTAMP(3))
          """, username.trim(), displayName.trim(), passwords.encode(password), scope);
    } catch (DuplicateKeyException e) { throw DomainException.conflict("ADMIN_USER_EXISTS", "登录用户名已存在"); }
    long id = jdbc.queryForObject("SELECT id FROM admin_user WHERE username=?", Long.class, username.trim());
    savePermissions(id, permissions == null ? Set.of() : permissions);
    return get(admin, id);
  }

  @Transactional
  public MemberView update(AdminPrincipal admin, long id, int version, String displayName, String status,
                           String password, Set<AdminPermission> permissions) {
    MemberView current = get(admin, id);
    String name = displayName == null ? current.displayName() : displayName.trim();
    String nextStatus = status == null ? current.status() : status;
    validateName(name);
    if (!List.of("ACTIVE", "DISABLED").contains(nextStatus)) throw DomainException.badRequest("ADMIN_STATUS_INVALID", "账号状态无效");
    boolean reset = password != null;
    if (reset) validatePassword(password);
    int changed = jdbc.update("""
        UPDATE admin_user SET display_name=?,status=?,lock_version=lock_version+1
        WHERE id=? AND role_code='DEPARTMENT_MEMBER' AND lock_version=?
        """, name, nextStatus, id, version);
    if (changed != 1) throw DomainException.conflict("MEMBER_VERSION_CONFLICT", "成员信息已更新，请刷新后重试");
    if (permissions != null) savePermissions(id, permissions);
    if (reset) jdbc.update("UPDATE admin_user SET password_hash=?,password_changed_at=UTC_TIMESTAMP(3),must_change_password=FALSE WHERE id=?", passwords.encode(password), id);
    if (reset || "DISABLED".equals(nextStatus)) jdbc.update("UPDATE admin_session SET revoked_at=UTC_TIMESTAMP(3),revoke_reason=? WHERE admin_user_id=? AND revoked_at IS NULL",
        reset ? "PASSWORD_RESET" : "USER_DISABLED", id);
    return get(admin, id);
  }

  private MemberView get(AdminPrincipal admin, long id) {
    admin.requireManager();
    Long scope = admin.isSuperAdmin() ? null : admin.departmentId();
    if (!admin.isSuperAdmin() && scope == null) throw DomainException.forbidden("DEPARTMENT_REQUIRED", "账号未绑定部门");
    return jdbc.query(MEMBER_SELECT + " AND u.id=? AND (? IS NULL OR u.department_id=?)", this::mapMember, id, scope, scope)
        .stream().findFirst().orElseThrow(() -> DomainException.notFound("MEMBER_NOT_FOUND", "成员不存在"));
  }
  private MemberView mapMember(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
    String codes = rs.getString("permission_codes");
    Set<AdminPermission> granted = codes == null || codes.isBlank() ? Set.of()
        : Set.copyOf(java.util.Arrays.stream(codes.split(",")).map(AdminPermission::valueOf).toList());
    return new MemberView(rs.getLong("id"), rs.getString("username"), rs.getString("display_name"),
        rs.getLong("department_id"), rs.getString("department_name"), rs.getString("status"), rs.getInt("lock_version"),
        rs.getTimestamp("last_login_at") == null ? null : rs.getTimestamp("last_login_at").toInstant(), granted);
  }
  private void savePermissions(long id, Set<AdminPermission> permissions) {
    jdbc.update("DELETE FROM admin_user_permission WHERE admin_user_id=?", id);
    for (AdminPermission permission : permissions) {
      if (permission == null) throw DomainException.badRequest("PERMISSION_INVALID", "功能权限无效");
      jdbc.update("INSERT INTO admin_user_permission(admin_user_id,permission_code) VALUES (?,?)", id, permission.name());
    }
  }
  private static void validateName(String name) {
    if (name == null || name.isBlank() || name.trim().length() > 100) throw DomainException.badRequest("NAME_INVALID", "姓名不能为空且不能超过 100 个字符");
  }
  private static void validatePassword(String password) {
    if (password == null || password.length() < 8 || password.length() > 100) throw DomainException.badRequest("PASSWORD_INVALID", "登录密码长度须为 8-100 位");
  }
  public record MemberView(long id, String username, String displayName, long departmentId, String departmentName,
                           String status, int lockVersion, Instant lastLoginAt, Set<AdminPermission> permissions) {}
}
