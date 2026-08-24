package com.fengyi.ordershow.audit;

import com.fengyi.ordershow.common.PageResponse;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.AuthService;
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
  public static final String REASON_REQUEST_ATTRIBUTE = "orderShowAuditReason";
  private static final Logger log = LoggerFactory.getLogger(AuditService.class);
  private static final Pattern ACTIVITY_ID = Pattern.compile("/activities/(\\d+)");
  private static final Pattern LAST_ID = Pattern.compile("/(\\d+)(?:/[^/]*)?$");
  private final JdbcTemplate jdbc;

  public AuditService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  public void record(HttpServletRequest request, HttpServletResponse response, Exception exception) {
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
      jdbc.update("""
          INSERT INTO audit_log(activity_id, actor_type, admin_user_id, action_code, object_type, object_id, reason,
            result, error_code, trace_id, ip_address, user_agent, occurred_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, INET6_ATON(?), ?, UTC_TIMESTAMP(3))
          """, activityId, actorType, admin == null ? null : admin.id(), action, objectType, objectId, truncate(reason, 500),
          success ? "SUCCESS" : "FAILURE", success ? null : "HTTP_" + response.getStatus(), TraceFilter.id(request), ip,
          truncate(request.getHeader("User-Agent"), 500));
    } catch (Exception auditFailure) {
      log.warn("Failed to persist audit event for {} {}", request.getMethod(), request.getRequestURI(), auditFailure);
    }
  }

  public PageResponse<AuditView> list(Long activityId, String actionCode, String objectType, int page, int size, String traceId) {
    int safePage = Math.max(1, page); int safeSize = Math.min(200, Math.max(1, size));
    String where = " WHERE (? IS NULL OR l.activity_id = ?) AND (? IS NULL OR ? = '' OR l.action_code = ?) AND (? IS NULL OR ? = '' OR l.object_type = ?) ";
    Object[] args = {activityId, activityId, actionCode, actionCode, actionCode, objectType, objectType, objectType};
    Long total = jdbc.queryForObject("SELECT COUNT(*) FROM audit_log l" + where, Long.class, args);
    List<Object> paged = new ArrayList<>(Arrays.asList(args)); paged.add(safeSize); paged.add((safePage - 1) * safeSize);
    List<AuditView> rows = jdbc.query("""
        SELECT l.id, l.actor_type, u.display_name, l.action_code, l.object_type, l.object_id, l.reason,
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
    if (uri.contains("/orders")) return "ORDER"; if (uri.contains("/products")) return "PRODUCT";
    if (uri.contains("/customers")) return "CUSTOMER"; if (uri.contains("/attendees")) return "ATTENDEE";
    if (uri.contains("/imports")) return "IMPORT"; if (uri.contains("/lottery")) return "LOTTERY";
    if (uri.contains("/activities")) return "ACTIVITY"; return "SESSION";
  }
  private static String action(String method, String uri) {
    String suffix = uri.contains("/withdraw") ? "WITHDRAW" : uri.contains("/confirm") ? "CONFIRM"
        : uri.contains("/publish") ? "PUBLISH" : uri.contains("/draw") ? "DRAW"
        : uri.contains("/complete") ? "COMPLETE" : uri.contains("/reset") ? "RESET"
        : uri.contains("/transition") ? "TRANSITION" : method;
    return objectType(uri) + "_" + suffix;
  }
  private static String remoteIp(HttpServletRequest request) { String value = request.getHeader("X-Forwarded-For"); return value == null ? request.getRemoteAddr() : value.split(",")[0].trim(); }
  private static String truncate(String value, int max) { return value == null ? "" : value.substring(0, Math.min(max, value.length())); }

  public record AuditView(long id, String actorType, String actorName, String actionCode, String objectType,
                          String objectId, String reason, String result, String errorCode, String traceId, Instant occurredAt) {}
}
