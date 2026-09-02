package com.fengyi.ordershow.security;

import com.fengyi.ordershow.common.DomainException;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Centralizes department and activity scope checks for all administrator entry points. */
@Service
public class DepartmentAccessService {
  private final JdbcTemplate jdbc;

  public DepartmentAccessService(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public void requireSuperAdmin(AdminPrincipal admin) {
    if (admin == null || !admin.isSuperAdmin()) {
      throw DomainException.forbidden("SUPER_ADMIN_REQUIRED", "只有超级管理员可以执行此操作");
    }
  }

  public long requireDepartmentForCreate(AdminPrincipal admin, Long requestedDepartmentId) {
    if (admin.isSuperAdmin()) {
      long departmentId = requestedDepartmentId == null ? defaultDepartmentId() : requestedDepartmentId;
      requireActiveDepartment(departmentId);
      return departmentId;
    }
    if (admin.departmentId() == null) {
      throw DomainException.forbidden("ADMIN_DEPARTMENT_MISSING", "当前账号未绑定业务部门");
    }
    if (requestedDepartmentId != null && requestedDepartmentId.longValue() != admin.departmentId()) {
      throw DomainException.forbidden("DEPARTMENT_SCOPE_DENIED", "不能将活动创建到其他部门");
    }
    requireActiveDepartment(admin.departmentId());
    return admin.departmentId();
  }

  public void requireActivityAccess(AdminPrincipal admin, long activityId) {
    if (admin.isSuperAdmin()) return;
    if (admin.departmentId() == null) {
      throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
    }
    Integer matches = jdbc.queryForObject("""
        SELECT COUNT(*) FROM activity a
        JOIN department d ON d.id = a.department_id AND d.status = 'ACTIVE'
        WHERE a.id = ? AND a.archived_at IS NULL AND a.department_id = ?
        """, Integer.class, activityId, admin.departmentId());
    if (matches == null || matches != 1) {
      throw DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在");
    }
  }

  public void requireDepartmentAccess(AdminPrincipal admin, long departmentId) {
    if (admin.isSuperAdmin()) {
      requireActiveDepartment(departmentId);
      return;
    }
    if (admin.departmentId() == null || admin.departmentId() != departmentId) {
      throw DomainException.notFound("DEPARTMENT_NOT_FOUND", "部门不存在");
    }
    requireActiveDepartment(departmentId);
  }

  public long defaultDepartmentId() {
    Long id = jdbc.queryForObject("SELECT id FROM department WHERE department_code = 'DEFAULT'", Long.class);
    if (id == null) throw new IllegalStateException("Default department is missing");
    return id;
  }

  public void requireActiveDepartment(long departmentId) {
    Integer matches = jdbc.queryForObject("SELECT COUNT(*) FROM department WHERE id = ? AND status = 'ACTIVE'",
        Integer.class, departmentId);
    if (matches == null || matches != 1) {
      throw DomainException.badRequest("DEPARTMENT_INVALID", "部门不存在或已停用");
    }
  }

  public List<Long> visibleDepartmentIds(AdminPrincipal admin) {
    if (admin.isSuperAdmin()) return jdbc.queryForList("SELECT id FROM department WHERE status = 'ACTIVE' ORDER BY id", Long.class);
    return admin.departmentId() == null ? List.of() : List.of(admin.departmentId());
  }
}
