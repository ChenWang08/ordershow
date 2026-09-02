package com.fengyi.ordershow.security;

public record AdminPrincipal(long id, String username, String displayName, String roleCode,
                             Long departmentId, String departmentName, boolean mustChangePassword) {
  public boolean isSuperAdmin() { return "SUPER_ADMIN".equals(roleCode); }
}
