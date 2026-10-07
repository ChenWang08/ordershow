package com.fengyi.ordershow.security;

import com.fengyi.ordershow.common.DomainException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Fail closed for member routes. Department ownership is checked by the preceding interceptor. */
@Service
public class MemberPermissionService {
  private final JdbcTemplate jdbc;
  public MemberPermissionService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  public void requireAccess(AdminPrincipal admin, HttpServletRequest request) {
    if (admin.isManager()) return;
    String path = request.getRequestURI().substring(request.getContextPath().length());
    boolean read = List.of("GET", "HEAD").contains(request.getMethod());
    if (path.equals("/admin/me") && read || path.equals("/admin/auth/logout")) return;
    if (read && (path.equals("/admin/activities") || path.matches("/admin/activities/\\d+"))) return;
    var activity = Pattern.compile("^/admin/activities/(\\d+)/(.*)$").matcher(path);
    if (!activity.matches()) { admin.requireManager(); return; }
    long activityId = Long.parseLong(activity.group(1));
    String resource = activity.group(2);
    if (read && resource.equals("module-context")) {
      if (admin.permissions().isEmpty()) deny();
      return;
    }
    if (resource.equals("imports") || resource.startsWith("imports/")) {
      var task = Pattern.compile("^imports/(\\d+)(?:/.*)?$").matcher(resource);
      if (task.matches()) {
        List<String> types = jdbc.queryForList("SELECT import_type FROM import_task WHERE id=? AND activity_id=?", String.class,
            Long.parseLong(task.group(1)), activityId);
        if (types.isEmpty()) throw DomainException.notFound("IMPORT_TASK_NOT_FOUND", "导入任务不存在");
        admin.requirePermission(importPermission(types.getFirst()));
      } else if (resource.equals("imports") && read) {
        if (!admin.hasPermission(AdminPermission.PRODUCT) && !admin.hasPermission(AdminPermission.WHITELIST) && !admin.hasPermission(AdminPermission.ATTENDANCE)) deny();
        // The controller filters tasks by module before returning them.
      } else if (resource.equals("imports") && "POST".equals(request.getMethod())) {
        admin.requirePermission(importPermission(request.getParameter("importType")));
      } else deny();
      return;
    }
    String module = resource.split("/", 2)[0];
    AdminPermission permission = switch (module) {
      case "products", "product-dealer-scopes", "product-dealer-candidates", "product-image-reviews", "product-images" -> AdminPermission.PRODUCT;
      case "customers" -> AdminPermission.WHITELIST;
      case "attendees" -> AdminPermission.ATTENDANCE;
      case "orders", "order-change-requests" -> AdminPermission.ORDER;
      case "lottery" -> AdminPermission.LOTTERY;
      case "ranking" -> AdminPermission.OVERVIEW;
      default -> null;
    };
    if (permission == null) { deny(); return; }
    admin.requirePermission(permission);
  }

  public static AdminPermission importPermission(String type) {
    return switch (type == null ? "" : type) {
      case "PRODUCT", "PRODUCT_IMAGE" -> AdminPermission.PRODUCT;
      case "WHITELIST" -> AdminPermission.WHITELIST;
      case "ATTENDANCE" -> AdminPermission.ATTENDANCE;
      default -> throw DomainException.badRequest("IMPORT_TYPE_INVALID", "导入类型无效");
    };
  }
  private static void deny() { throw DomainException.forbidden("MODULE_PERMISSION_REQUIRED", "功能权限已变更或未授权，请联系部门管理员"); }
}
