package com.fengyi.ordershow.security;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.config.OrderShowProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
  public static final String ADMIN_REQUEST_ATTRIBUTE = "orderShowAdminPrincipal";
  public static final String H5_REQUEST_ATTRIBUTE = "orderShowH5Principal";
  private static final String ADMIN_COOKIE = "ORDER_SHOW_ADMIN_SESSION";
  private static final String H5_COOKIE = "ORDER_SHOW_H5_SESSION";
  private static final String ADMIN_CSRF_COOKIE = "ORDER_SHOW_ADMIN_CSRF";
  private static final String H5_CSRF_COOKIE = "ORDER_SHOW_H5_CSRF";
  private static final SecureRandom RANDOM = new SecureRandom();

  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;
  private final CryptoService crypto;
  private final OrderShowProperties properties;

  public AuthService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder, CryptoService crypto,
                     OrderShowProperties properties) {
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
    this.crypto = crypto;
    this.properties = properties;
  }

  @Transactional
  public LoginResult login(String username, String password, HttpServletRequest request, HttpServletResponse response) {
    List<Map<String, Object>> users = jdbc.queryForList("""
        SELECT id, username, display_name, password_hash, must_change_password
        FROM admin_user WHERE username = ? AND status = 'ACTIVE'
        """, username.trim());
    if (users.size() != 1 || !passwordEncoder.matches(password, users.getFirst().get("password_hash").toString())) {
      throw DomainException.unauthorized("用户名或密码不正确");
    }
    Map<String, Object> user = users.getFirst();
    long id = ((Number) user.get("id")).longValue();
    String token = randomToken();
    String csrf = randomToken();
    Instant expires = Instant.now().plus(Duration.ofHours(properties.adminSessionHours()));
    jdbc.update("""
        INSERT INTO admin_session(admin_user_id, token_hash, csrf_token_hash, expires_at, last_seen_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), INET6_ATON(?), ?)
        """, id, crypto.sha256(token), crypto.sha256(csrf), Timestamp.from(expires), remoteIp(request), userAgent(request));
    jdbc.update("UPDATE admin_user SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?", id);
    addCookie(response, ADMIN_COOKIE, token, true, Duration.ofHours(properties.adminSessionHours()));
    addCookie(response, ADMIN_CSRF_COOKIE, csrf, false, Duration.ofHours(properties.adminSessionHours()));
    return new LoginResult(id, user.get("username").toString(), user.get("display_name").toString(),
        (Boolean) user.get("must_change_password"), csrf);
  }

  @Transactional
  public void logout(HttpServletRequest request, HttpServletResponse response) {
    String token = cookie(request, ADMIN_COOKIE);
    if (token != null) jdbc.update("UPDATE admin_session SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = 'LOGOUT' WHERE token_hash = ? AND revoked_at IS NULL", crypto.sha256(token));
    clearCookie(response, ADMIN_COOKIE, true);
    clearCookie(response, ADMIN_CSRF_COOKIE, false);
  }

  public AdminPrincipal requireAdmin(HttpServletRequest request) {
    Object existing = request.getAttribute(ADMIN_REQUEST_ATTRIBUTE);
    if (existing instanceof AdminPrincipal principal) return principal;
    String token = cookie(request, ADMIN_COOKIE);
    if (token == null) throw DomainException.unauthorized("请先登录管理后台");
    List<AdminPrincipal> rows = jdbc.query("""
        SELECT u.id, u.username, u.display_name, u.must_change_password
        FROM admin_session s JOIN admin_user u ON u.id = s.admin_user_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3) AND u.status = 'ACTIVE'
        """, (rs, rowNum) -> new AdminPrincipal(rs.getLong("id"), rs.getString("username"),
        rs.getString("display_name"), rs.getBoolean("must_change_password")), crypto.sha256(token));
    if (rows.size() != 1) throw DomainException.unauthorized("登录已失效，请重新登录");
    AdminPrincipal principal = rows.getFirst();
    request.setAttribute(ADMIN_REQUEST_ATTRIBUTE, principal);
    return principal;
  }

  public H5Principal requireH5(HttpServletRequest request) {
    Object existing = request.getAttribute(H5_REQUEST_ATTRIBUTE);
    if (existing instanceof H5Principal principal) return principal;
    String token = cookie(request, H5_COOKIE);
    if (token == null) throw DomainException.unauthorized("请先验证白名单手机号");
    List<H5Principal> rows = jdbc.query("""
        SELECT s.id session_id, s.activity_id, s.activity_customer_id, a.activity_code,
               c.customer_type, c.region_code, c.branch_name, c.dealer_short_name, c.dealer_full_name, c.phone_masked
        FROM h5_session s
        JOIN activity a ON a.id = s.activity_id
        JOIN activity_customer c ON c.id = s.activity_customer_id
        LEFT JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST'
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)
          AND c.is_active = TRUE AND (b.current_version_id IS NULL OR c.data_version_id = b.current_version_id)
        """, (rs, rowNum) -> new H5Principal(rs.getLong("session_id"), rs.getLong("activity_id"),
        rs.getLong("activity_customer_id"), rs.getString("activity_code"), rs.getString("customer_type"),
        rs.getString("region_code"), rs.getString("branch_name"), rs.getString("dealer_short_name"),
        rs.getString("dealer_full_name"), rs.getString("phone_masked")), crypto.sha256(token));
    if (rows.size() != 1) throw DomainException.unauthorized("身份验证已失效，请重新验证");
    H5Principal principal = rows.getFirst();
    request.setAttribute(H5_REQUEST_ATTRIBUTE, principal);
    return principal;
  }

  @Transactional
  public H5LoginResult verifyH5(String activityCode, String customerType, String regionCode, String phone,
                                HttpServletRequest request, HttpServletResponse response) {
    String normalized = CryptoService.normalizePhone(phone);
    if (!normalized.matches("1\\d{10}")) throw DomainException.badRequest("INVALID_PHONE", "请输入有效的 11 位手机号");
    List<H5Principal> customers = jdbc.query("""
        SELECT 0 session_id, c.activity_id, c.id activity_customer_id, a.activity_code,
               c.customer_type, c.region_code, c.branch_name, c.dealer_short_name, c.dealer_full_name, c.phone_masked
        FROM activity_customer c
        JOIN activity a ON a.id = c.activity_id
        LEFT JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST'
        WHERE a.activity_code = ? AND c.customer_type = ? AND c.phone_lookup_hash = ? AND c.is_active = TRUE
          AND (b.current_version_id IS NULL OR c.data_version_id = b.current_version_id)
          AND (? IS NULL OR ? = '' OR c.region_code = ?)
        """, (rs, rowNum) -> new H5Principal(0, rs.getLong("activity_id"), rs.getLong("activity_customer_id"),
        rs.getString("activity_code"), rs.getString("customer_type"), rs.getString("region_code"),
        rs.getString("branch_name"), rs.getString("dealer_short_name"), rs.getString("dealer_full_name"),
        rs.getString("phone_masked")), activityCode, customerType, crypto.lookupHash(normalized), regionCode, regionCode, regionCode);
    if (customers.size() != 1) throw DomainException.notFound("WHITELIST_IDENTITY_NOT_FOUND", "该手机号不在所选通道或大区的有效白名单中");
    H5Principal customer = customers.getFirst();
    String token = randomToken();
    String csrf = randomToken();
    Instant expires = Instant.now().plus(Duration.ofHours(properties.h5SessionHours()));
    jdbc.update("""
        INSERT INTO h5_session(activity_id, activity_customer_id, token_hash, csrf_token_hash, expires_at, last_seen_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), INET6_ATON(?), ?)
        """, customer.activityId(), customer.customerId(), crypto.sha256(token), crypto.sha256(csrf),
        Timestamp.from(expires), remoteIp(request), userAgent(request));
    addCookie(response, H5_COOKIE, token, true, Duration.ofHours(properties.h5SessionHours()));
    addCookie(response, H5_CSRF_COOKIE, csrf, false, Duration.ofHours(properties.h5SessionHours()));
    return new H5LoginResult(customer, csrf);
  }

  public void requireCsrf(HttpServletRequest request, boolean admin) {
    String csrf = request.getHeader("X-CSRF-Token");
    String csrfCookie = cookie(request, admin ? ADMIN_CSRF_COOKIE : H5_CSRF_COOKIE);
    String token = cookie(request, admin ? ADMIN_COOKIE : H5_COOKIE);
    if (csrf == null || csrfCookie == null || token == null || !MessageDigest.isEqual(csrf.getBytes(), csrfCookie.getBytes())) {
      throw DomainException.forbidden("CSRF_INVALID", "安全令牌无效，请刷新页面后重试");
    }
    String table = admin ? "admin_session" : "h5_session";
    Integer matches = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE token_hash = ? AND csrf_token_hash = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)",
        Integer.class, crypto.sha256(token), crypto.sha256(csrf));
    if (matches == null || matches != 1) throw DomainException.forbidden("CSRF_INVALID", "安全令牌无效，请重新登录");
  }

  public String csrfFromCookie(HttpServletRequest request) {
    return cookie(request, ADMIN_CSRF_COOKIE);
  }

  private void addCookie(HttpServletResponse response, String name, String value, boolean httpOnly, Duration maxAge) {
    ResponseCookie cookie = ResponseCookie.from(name, value).httpOnly(httpOnly).secure(properties.cookieSecure())
        .sameSite("Lax").path("/").maxAge(maxAge).build();
    response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
  }

  private void clearCookie(HttpServletResponse response, String name, boolean httpOnly) {
    addCookie(response, name, "", httpOnly, Duration.ZERO);
  }

  private static String cookie(HttpServletRequest request, String name) {
    if (request.getCookies() == null) return null;
    for (Cookie cookie : request.getCookies()) if (name.equals(cookie.getName())) return cookie.getValue();
    return null;
  }

  private static String randomToken() {
    byte[] bytes = new byte[32];
    RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private static String remoteIp(HttpServletRequest request) {
    String forwarded = request.getHeader("X-Forwarded-For");
    return forwarded == null ? request.getRemoteAddr() : forwarded.split(",")[0].trim();
  }

  private static String userAgent(HttpServletRequest request) {
    String value = request.getHeader("User-Agent");
    return value == null ? "" : value.substring(0, Math.min(value.length(), 500));
  }

  public record LoginResult(long id, String username, String displayName, boolean mustChangePassword, String csrfToken) {}
  public record H5LoginResult(H5Principal customer, String csrfToken) {}
}
