package com.fengyi.ordershow.audit;

import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.security.DepartmentAccessService;
import com.fengyi.ordershow.security.H5Principal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AuditService {
  public static final String IDEMPOTENT_REPLAY_ATTRIBUTE = "orderShowIdempotentReplay";
  public static final String REASON_REQUEST_ATTRIBUTE = "orderShowAuditReason";
  public static final String RECORDED_REQUEST_ATTRIBUTE = "orderShowAuditRecorded";
  private static final Logger log = LoggerFactory.getLogger(AuditService.class);
  private static final Pattern ACTIVITY_ID = Pattern.compile("/activities/(\\d+)");
  private static final Pattern LAST_ID = Pattern.compile("/(\\d+)(?:/[^/]*)?$");
  private final JdbcTemplate jdbc;
  private final DepartmentAccessService departmentAccess;
  private final AuditBatchWriter writer;

  public AuditService(JdbcTemplate jdbc, DepartmentAccessService departmentAccess, AuditBatchWriter writer) {
    this.jdbc = jdbc;
    this.departmentAccess = departmentAccess;
    this.writer = writer;
  }

  public void record(HttpServletRequest request, HttpServletResponse response, Exception exception) {
    if (Boolean.TRUE.equals(request.getAttribute(RECORDED_REQUEST_ATTRIBUTE)) && exception == null && response.getStatus() < 400) return;
    if (Boolean.TRUE.equals(request.getAttribute(IDEMPOTENT_REPLAY_ATTRIBUTE)) && exception == null && response.getStatus() < 400) return;
    if (isRead(request.getMethod())) return;
    try {
      AdminPrincipal admin = request.getAttribute(AuthService.ADMIN_REQUEST_ATTRIBUTE) instanceof AdminPrincipal value ? value : null;
      H5Principal customer = request.getAttribute(AuthService.H5_REQUEST_ATTRIBUTE) instanceof H5Principal value ? value : null;
      String actorType = admin != null ? "ADMIN" : customer != null ? "H5_CUSTOMER" : "SYSTEM";
        Long activityId = customer == null
                ? activityId(request.getRequestURI())
                : Long.valueOf(customer.activityId());
      String action = action(request.getMethod(), request.getRequestURI());
      String objectType = objectType(request.getRequestURI());
      String objectId = lastId(request.getRequestURI());
      String reason = request.getAttribute(REASON_REQUEST_ATTRIBUTE) instanceof String value ? value : null;
      boolean success = exception == null && response.getStatus() < 400;
      String ip = remoteIp(request);
      writer.write(new Object[]{activityId, actorType, admin == null ? null : admin.id(), action, objectType, objectId, truncate(reason, 500),
          success ? "SUCCESS" : "FAILURE", success ? null : "HTTP_" + response.getStatus(), TraceFilter.id(request), ip,
          truncate(request.getHeader("User-Agent"), 500), java.sql.Timestamp.from(Instant.now()),
          admin == null ? null : admin.displayName() + "（" + admin.username() + "）", admin == null ? null : admin.roleCode()});
    } catch (Exception auditFailure) {
      log.warn("Failed to persist audit event for {} {}", request.getMethod(), request.getRequestURI(), auditFailure);
    }
  }

  public PageResponse<AuditView> list(Long activityId, String actionCode, String objectType, int page, int size, String traceId) {
    return listScoped(activityId, actionCode, objectType, page, size, traceId, null);
  }

  public PageResponse<AuditView> listForAdmin(AdminPrincipal admin, Long activityId, String actionCode, String objectType,
                                               int page, int size, String traceId) {
    if (admin.isSuperAdmin()) return list(activityId, actionCode, objectType, page, size, traceId);
    admin.requireManager();
    if (activityId != null) departmentAccess.requireActivityAccess(admin, activityId);
    return listScoped(activityId, actionCode, objectType, page, size, traceId, admin.departmentId());
  }

  private PageResponse<AuditView> listScoped(Long activityId, String actionCode, String objectType, int page, int size,
                                              String traceId, Long departmentId) {
    int safePage = Math.max(1, page); int safeSize = Math.min(200, Math.max(1, size));
    String where = " WHERE (? IS NULL OR l.activity_id = ?) "
        + (departmentId == null ? "" : " AND EXISTS (SELECT 1 FROM activity scoped_a WHERE scoped_a.id = l.activity_id AND scoped_a.department_id = ?) ")
        + " AND (? IS NULL OR ? = '' OR l.action_code = ?) AND (? IS NULL OR ? = '' OR l.object_type = ?) ";
    Object[] args = departmentId == null
        ? new Object[]{activityId, activityId, actionCode, actionCode, actionCode, objectType, objectType, objectType}
        : new Object[]{activityId, activityId, departmentId, actionCode, actionCode, actionCode, objectType, objectType, objectType};
    Long total = jdbc.queryForObject("SELECT COUNT(*) FROM audit_log l" + where, Long.class, args);
    List<Object> paged = new ArrayList<>(Arrays.asList(args)); paged.add(safeSize); paged.add((safePage - 1) * safeSize);
    List<AuditView> rows = jdbc.query("""
        SELECT l.id, l.actor_type, COALESCE(l.actor_identity_snapshot, u.display_name), l.action_code, l.object_type, l.object_id, l.reason,
          l.result, l.error_code, l.trace_id, l.occurred_at
        FROM audit_log l LEFT JOIN admin_user u ON u.id = l.admin_user_id
        """ + where + " ORDER BY l.occurred_at DESC, l.id DESC LIMIT ? OFFSET ?", this::map, paged.toArray());
    return PageResponse.of(rows, safePage, safeSize, total == null ? 0 : total, traceId);
  }

  private AuditView map(ResultSet rs, int rowNum) throws SQLException {
    return new AuditView(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
        rs.getString(6), rs.getString(7), rs.getString(8), rs.getString(9), rs.getString(10), rs.getTimestamp(11).toInstant());
  }
  private static boolean isRead(String method) { return "GET".equals(method) || "HEAD".equals(method) || "OPTIONS".equals(method); }
  private static Long activityId(String uri) { Matcher matcher = ACTIVITY_ID.matcher(uri); return matcher.find() ? Long.valueOf(matcher.group(1)) : null; }
  private static String lastId(String uri) { Matcher matcher = LAST_ID.matcher(uri); return matcher.find() ? matcher.group(1) : null; }
  private static String objectType(String uri) {
    if (uri.contains("/members")) return "ADMIN_USER";
    if (uri.contains("/order-change-requests")) return "ORDER_CHANGE_REQUEST";
    if (uri.contains("/orders")) return "ORDER"; if (uri.contains("/products")) return "PRODUCT";
    if (uri.contains("/customers")) return "CUSTOMER"; if (uri.contains("/attendees")) return "ATTENDEE";
    if (uri.contains("/imports")) return "IMPORT"; if (uri.contains("/lottery")) return "LOTTERY";
    if (uri.contains("/admin/departments/") && uri.endsWith("/account")) return "ADMIN_USER";
    if (uri.contains("/admin/users")) return "ADMIN_USER";
    if (uri.contains("/admin/departments")) return "DEPARTMENT";
    if (uri.contains("/activities")) return "ACTIVITY"; return "SESSION";
  }
  private static String action(String method, String uri) {
    if (uri.endsWith("/reopen")) return "ACTIVITY_REOPEN";
    if (uri.endsWith("/finish")) return "ACTIVITY_FINISH";
    if (uri.endsWith("/admin/members")) return "MEMBER_CREATED";
    if (uri.contains("/admin/members/")) return "MEMBER_UPDATED";
    if (uri.contains("/order-change-requests/") && uri.endsWith("/approve")) return "ORDER_CHANGE_APPROVED";
    if (uri.contains("/order-change-requests/") && uri.endsWith("/reject")) return "ORDER_CHANGE_REJECTED";
    if (uri.endsWith("/admin/auth/login")) return "ADMIN_LOGIN";
    if (uri.endsWith("/admin/auth/change-password")) return "ADMIN_PASSWORD_CHANGED";
    if (uri.endsWith("/admin/auth/logout")) return "ADMIN_LOGOUT";
    if (uri.contains("/admin/departments/") && uri.endsWith("/account")) return "ADMIN_USER_CREATED";
    if (uri.endsWith("/admin/departments")) return "DEPARTMENT_CREATED";
    if (uri.contains("/admin/departments/")) return "DEPARTMENT_UPDATED";
    if (uri.endsWith("/admin/users")) return "ADMIN_USER_CREATED";
    if (uri.contains("/admin/users/")) return "ADMIN_USER_UPDATED";
    if (uri.endsWith("/orders") && "POST".equals(method)) return "ORDER_ADMIN_CREATED";
    if (uri.endsWith("/void") && uri.contains("/orders/")) return "ORDER_ADMIN_VOIDED";
    if (uri.matches(".*/orders/\\d+$") && "PUT".equals(method)) return "ORDER_ADMIN_ADJUSTED";
    String suffix = uri.contains("/withdraw") ? "WITHDRAW" : uri.contains("/confirm") ? "CONFIRM"
        : uri.contains("/publish") ? "PUBLISH" : uri.contains("/draw") ? "DRAW"
        : uri.contains("/close") ? "CLOSE"
        : uri.contains("/complete") ? "COMPLETE" : uri.contains("/reset") ? "RESET"
        : uri.contains("/transition") ? "TRANSITION" : method;
    return objectType(uri) + "_" + suffix;
  }
  private static String remoteIp(HttpServletRequest request) { String value = request.getHeader("X-Forwarded-For"); return value == null ? request.getRemoteAddr() : value.split(",")[0].trim(); }
  private static String truncate(String value, int max) { return value == null ? "" : value.substring(0, Math.min(max, value.length())); }

  public record AuditView(long id, String actorType, String actorName, String actionCode, String objectType,
                          String objectId, String reason, String result, String errorCode, String traceId, Instant occurredAt) {}
}
