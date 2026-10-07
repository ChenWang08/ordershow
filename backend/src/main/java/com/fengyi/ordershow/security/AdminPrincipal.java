package com.fengyi.ordershow.security;

public record AdminPrincipal(long id, String username, String displayName, String roleCode,
                             Long departmentId, String departmentName, boolean mustChangePassword,
                             java.util.Set<AdminPermission> permissions) {
  public AdminPrincipal {
    permissions = permissions == null ? java.util.Set.of() : java.util.Set.copyOf(permissions);
  }
  public AdminPrincipal(long id, String username, String displayName, String roleCode,
                        Long departmentId, String departmentName, boolean mustChangePassword) {
    this(id, username, displayName, roleCode, departmentId, departmentName, mustChangePassword, java.util.Set.of());
  }
  public boolean isSuperAdmin() { return "SUPER_ADMIN".equals(roleCode); }
  public boolean isMember() { return "DEPARTMENT_MEMBER".equals(roleCode); }
  public boolean isManager() { return isSuperAdmin() || "DEPARTMENT_ADMIN".equals(roleCode); }
  public boolean hasPermission(AdminPermission permission) { return isManager() || permissions.contains(permission); }
  public void requireManager() {
    if (!isManager()) throw com.fengyi.ordershow.common.DomainException.forbidden("MANAGER_REQUIRED", "此操作仅限管理员");
  }
  public void requirePermission(AdminPermission permission) {
    if (!hasPermission(permission)) throw com.fengyi.ordershow.common.DomainException.forbidden("MODULE_PERMISSION_REQUIRED", "功能权限已变更或未授权，请联系部门管理员");
  }
}
