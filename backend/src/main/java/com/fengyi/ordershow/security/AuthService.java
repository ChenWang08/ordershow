package com.fengyi.ordershow.security;

import com.fengyi.ordershow.common.UtcTime;

import com.fengyi.ordershow.activity.ActivityFinishedEvent;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.config.OrderShowProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.event.TransactionalEventListener;

@Service
public class AuthService {
  public static final String ADMIN_REQUEST_ATTRIBUTE = "orderShowAdminPrincipal";
  public static final String H5_REQUEST_ATTRIBUTE = "orderShowH5Principal";
  private static final String ADMIN_CSRF_HASH_ATTRIBUTE = "orderShowAdminCsrfHash";
  private static final String H5_CSRF_HASH_ATTRIBUTE = "orderShowH5CsrfHash";
  private static final String ADMIN_COOKIE = "ORDER_SHOW_ADMIN_SESSION";
  private static final String H5_COOKIE = "ORDER_SHOW_H5_SESSION";
  private static final String ADMIN_CSRF_COOKIE = "ORDER_SHOW_ADMIN_CSRF";
  private static final String H5_CSRF_COOKIE = "ORDER_SHOW_H5_CSRF";
  private static final SecureRandom RANDOM = new SecureRandom();

  private static final int H5_SESSION_CACHE_MAX_ENTRIES = 50_000;

  private final JdbcTemplate jdbc;
  private final PasswordEncoder passwordEncoder;
  private final CryptoService crypto;
  private final OrderShowProperties properties;
  /**
   * Short-lived, per-instance cache of resolved H5 sessions keyed by token hash. Revocation, activity end,
   * department disable and whitelist republish take effect on this instance after at most the TTL.
   * A TTL of 0 disables the cache and restores a database lookup on every H5 request.
   */
  private final long h5SessionCacheTtlNanos;
  private final ConcurrentHashMap<String, CachedH5Session> h5Sessions = new ConcurrentHashMap<>();

  public AuthService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder, CryptoService crypto,
                     OrderShowProperties properties) {
    this(jdbc, passwordEncoder, crypto, properties, 0);
  }

  @Autowired
  public AuthService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder, CryptoService crypto,
                     OrderShowProperties properties,
                     @Value("${H5_SESSION_CACHE_TTL_MS:2000}") long h5SessionCacheTtlMs) {
    if (h5SessionCacheTtlMs < 0) throw new IllegalArgumentException("H5_SESSION_CACHE_TTL_MS must not be negative");
    this.jdbc = jdbc;
    this.passwordEncoder = passwordEncoder;
    this.crypto = crypto;
    this.properties = properties;
    this.h5SessionCacheTtlNanos = TimeUnit.MILLISECONDS.toNanos(h5SessionCacheTtlMs);
  }

  @Transactional
  public LoginResult login(String username, String password, HttpServletRequest request, HttpServletResponse response) {
    List<Map<String, Object>> users = jdbc.queryForList("""
        SELECT u.id, u.username, u.display_name, u.password_hash, u.role_code, u.department_id,
               d.department_name,
               CASE WHEN u.role_code = 'SUPER_ADMIN' THEN u.must_change_password ELSE FALSE END AS must_change_password
        FROM admin_user u
        LEFT JOIN department d ON d.id = u.department_id
        WHERE u.username = ? AND u.status = 'ACTIVE'
          AND (u.role_code = 'SUPER_ADMIN' OR d.status = 'ACTIVE')
        FOR UPDATE
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
        """, id, crypto.sha256(token), crypto.sha256(csrf), UtcTime.database(expires), remoteIp(request), userAgent(request));
    jdbc.update("UPDATE admin_user SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?", id);
    addCookie(response, ADMIN_COOKIE, token, true, Duration.ofHours(properties.adminSessionHours()));
    addCookie(response, ADMIN_CSRF_COOKIE, csrf, false, Duration.ofHours(properties.adminSessionHours()));
    boolean mustChangePassword = booleanValue(user.get("must_change_password"));
    AdminPrincipal principal = new AdminPrincipal(id, user.get("username").toString(), user.get("display_name").toString(),
        user.get("role_code").toString(), nullableLong(user.get("department_id")),
        user.get("department_name") == null ? null : user.get("department_name").toString(),
        mustChangePassword, permissions(id));
    request.setAttribute(ADMIN_REQUEST_ATTRIBUTE, principal);
    return new LoginResult(id, user.get("username").toString(), user.get("display_name").toString(),
        user.get("role_code").toString(), nullableLong(user.get("department_id")),
        user.get("department_name") == null ? null : user.get("department_name").toString(),
        mustChangePassword, csrf, principal.permissions());
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
    byte[][] csrfHash = new byte[1][];
    List<AdminPrincipal> rows = jdbc.query("""
        SELECT u.id, u.username, u.display_name, u.role_code, u.department_id, d.department_name,
               CASE WHEN u.role_code = 'SUPER_ADMIN' THEN u.must_change_password ELSE FALSE END AS must_change_password,
               s.csrf_token_hash
        FROM admin_session s JOIN admin_user u ON u.id = s.admin_user_id
        LEFT JOIN department d ON d.id = u.department_id
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3) AND u.status = 'ACTIVE'
          AND (u.role_code = 'SUPER_ADMIN' OR d.status = 'ACTIVE')
        """, (rs, rowNum) -> {
          csrfHash[0] = rs.getBytes("csrf_token_hash");
          return new AdminPrincipal(rs.getLong("id"), rs.getString("username"),
              rs.getString("display_name"), rs.getString("role_code"),
              rs.getObject("department_id", Long.class), rs.getString("department_name"),
              rs.getBoolean("must_change_password"));
        }, crypto.sha256(token));
    if (rows.size() != 1) throw DomainException.unauthorized("登录已失效，请重新登录");
    AdminPrincipal row = rows.getFirst();
    AdminPrincipal principal = new AdminPrincipal(row.id(), row.username(), row.displayName(), row.roleCode(),
        row.departmentId(), row.departmentName(), row.mustChangePassword(), permissions(row.id()));
    request.setAttribute(ADMIN_REQUEST_ATTRIBUTE, principal);
    if (csrfHash[0] != null) request.setAttribute(ADMIN_CSRF_HASH_ATTRIBUTE, csrfHash[0]);
    return principal;
  }

  public java.util.Set<AdminPermission> permissions(long userId) {
    return java.util.Set.copyOf(jdbc.queryForList("SELECT permission_code FROM admin_user_permission WHERE admin_user_id = ?",
        String.class, userId).stream().map(AdminPermission::valueOf).toList());
  }

  public H5Principal requireH5(HttpServletRequest request) {
    Object existing = request.getAttribute(H5_REQUEST_ATTRIBUTE);
    if (existing instanceof H5Principal principal) return principal;
    String token = cookie(request, H5_COOKIE);
    if (token == null) throw DomainException.unauthorized("请先验证白名单手机号");
    byte[] tokenHash = crypto.sha256(token);
    String cacheKey = cacheKey(tokenHash);
    CachedH5Session cached = cachedH5Session(cacheKey);
    if (cached != null) {
      request.setAttribute(H5_REQUEST_ATTRIBUTE, cached.principal());
      request.setAttribute(H5_CSRF_HASH_ATTRIBUTE, cached.csrfHash());
      return cached.principal();
    }
    byte[][] csrfHash = new byte[1][];
    List<H5Principal> rows = jdbc.query("""
        SELECT s.id session_id, s.activity_id, s.activity_customer_id, a.activity_code,
               c.customer_type, c.region_code, c.branch_name, c.dealer_short_name, c.dealer_full_name, c.phone_masked,
               s.csrf_token_hash
        FROM h5_session s
        JOIN activity a ON a.id = s.activity_id
        JOIN department d ON d.id = a.department_id AND d.status = 'ACTIVE'
        JOIN activity_customer c ON c.id = s.activity_customer_id
        LEFT JOIN activity_data_binding b ON b.activity_id = c.activity_id AND b.data_type = 'WHITELIST'
        WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(3)
          AND a.status IN ('SCHEDULED', 'ACTIVE', 'CLOSED')
          AND (a.event_ends_at IS NULL OR a.event_ends_at > UTC_TIMESTAMP(3))
          AND c.is_active = TRUE AND (b.current_version_id IS NULL OR c.data_version_id = b.current_version_id)
        """, (rs, rowNum) -> {
          csrfHash[0] = rs.getBytes("csrf_token_hash");
          return new H5Principal(rs.getLong("session_id"), rs.getLong("activity_id"),
              rs.getLong("activity_customer_id"), rs.getString("activity_code"), rs.getString("customer_type"),
              rs.getString("region_code"), rs.getString("branch_name"), rs.getString("dealer_short_name"),
              rs.getString("dealer_full_name"), rs.getString("phone_masked"));
        }, tokenHash);
    if (rows.size() != 1) {
      h5Sessions.remove(cacheKey);
      throw DomainException.unauthorized("身份验证已失效，请重新验证");
    }
    H5Principal principal = rows.getFirst();
    request.setAttribute(H5_REQUEST_ATTRIBUTE, principal);
    if (csrfHash[0] != null) {
      request.setAttribute(H5_CSRF_HASH_ATTRIBUTE, csrfHash[0]);
      cacheH5Session(cacheKey, principal, csrfHash[0]);
    }
    return principal;
  }

  // Only called after identity validation, inside H5PhoneVerificationService's transaction.
  H5LoginResult createH5Session(H5Principal customer, HttpServletRequest request, HttpServletResponse response) {
    if (!TransactionSynchronizationManager.isActualTransactionActive()) {
      throw new IllegalStateException("H5 session creation requires a transaction");
    }
    String token = randomToken();
    String csrf = randomToken();
    Instant expires = Instant.now().plus(Duration.ofHours(properties.h5SessionHours()));
    byte[] tokenHash = crypto.sha256(token);
    byte[] csrfHash = crypto.sha256(csrf);
    GeneratedKeyHolder keys = new GeneratedKeyHolder();
    jdbc.update(connection -> {
      var statement = connection.prepareStatement("""
          INSERT INTO h5_session(activity_id, activity_customer_id, token_hash, csrf_token_hash, expires_at, last_seen_at, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), INET6_ATON(?), ?)
          """, Statement.RETURN_GENERATED_KEYS);
      int i = 0;
      statement.setLong(++i, customer.activityId());
      statement.setLong(++i, customer.customerId());
      statement.setBytes(++i, tokenHash);
      statement.setBytes(++i, csrfHash);
      statement.setObject(++i, UtcTime.database(expires));
      statement.setString(++i, remoteIp(request));
      statement.setString(++i, userAgent(request));
      return statement;
    }, keys);
    Number sessionId = keys.getKey();
    if (sessionId != null) {
      H5Principal session = new H5Principal(sessionId.longValue(), customer.activityId(), customer.customerId(),
          customer.activityCode(), customer.customerType(), customer.regionCode(), customer.branchName(),
          customer.dealerShortName(), customer.dealerFullName(), customer.phoneMasked());
      String cacheKey = cacheKey(tokenHash);
      // Only a committed session may be served from the cache.
      if (TransactionSynchronizationManager.isSynchronizationActive()) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
          @Override public void afterCommit() { cacheH5Session(cacheKey, session, csrfHash); }
        });
      } else {
        cacheH5Session(cacheKey, session, csrfHash);
      }
    }
    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
      @Override public void afterCommit() {
        addCookie(response, H5_COOKIE, token, true, Duration.ofHours(properties.h5SessionHours()));
        addCookie(response, H5_CSRF_COOKIE, csrf, false, Duration.ofHours(properties.h5SessionHours()));
      }
    });
    return new H5LoginResult(customer, csrf);
  }

  public void requireCsrf(HttpServletRequest request, boolean admin) {
    String csrf = request.getHeader("X-CSRF-Token");
    String csrfCookie = cookie(request, admin ? ADMIN_CSRF_COOKIE : H5_CSRF_COOKIE);
    String token = cookie(request, admin ? ADMIN_COOKIE : H5_COOKIE);
    if (csrf == null || csrfCookie == null || token == null || !MessageDigest.isEqual(csrf.getBytes(), csrfCookie.getBytes())) {
      throw DomainException.forbidden("CSRF_INVALID", "安全令牌无效，请刷新页面后重试");
    }
    // requireAdmin/requireH5 already validated this session in the same request; reuse its CSRF hash.
    Object resolved = request.getAttribute(admin ? ADMIN_CSRF_HASH_ATTRIBUTE : H5_CSRF_HASH_ATTRIBUTE);
    if (resolved instanceof byte[] expected) {
      if (!MessageDigest.isEqual(expected, crypto.sha256(csrf))) {
        throw DomainException.forbidden("CSRF_INVALID", "安全令牌无效，请重新登录");
      }
      return;
    }
    String table = admin ? "admin_session" : "h5_session";
    Integer matches = jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE token_hash = ? AND csrf_token_hash = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(3)",
        Integer.class, crypto.sha256(token), crypto.sha256(csrf));
    if (matches == null || matches != 1) throw DomainException.forbidden("CSRF_INVALID", "安全令牌无效，请重新登录");
  }

  @Transactional
  public void revokeOtherAdminSessions(HttpServletRequest request, long adminUserId, String reason) {
    String token = cookie(request, ADMIN_COOKIE);
    if (token == null) return;
    jdbc.update("""
        UPDATE admin_session SET revoked_at = UTC_TIMESTAMP(3), revoke_reason = ?
        WHERE admin_user_id = ? AND token_hash <> ? AND revoked_at IS NULL
        """, reason, adminUserId, crypto.sha256(token));
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

  /** Finishing an activity revokes its H5 sessions in the database; drop this instance's cached copies too. */
  @TransactionalEventListener(fallbackExecution = true)
  public void evictFinishedActivitySessions(ActivityFinishedEvent event) {
    h5Sessions.values().removeIf(entry -> entry.principal().activityId() == event.activityId());
  }

  int cachedH5SessionCount() { return h5Sessions.size(); }

  private CachedH5Session cachedH5Session(String key) {
    if (h5SessionCacheTtlNanos == 0) return null;
    CachedH5Session cached = h5Sessions.get(key);
    if (cached == null) return null;
    if (System.nanoTime() - cached.cachedAtNanos() >= h5SessionCacheTtlNanos) {
      h5Sessions.remove(key, cached);
      return null;
    }
    return cached;
  }

  private void cacheH5Session(String key, H5Principal principal, byte[] csrfHash) {
    if (h5SessionCacheTtlNanos == 0) return;
    if (h5Sessions.size() >= H5_SESSION_CACHE_MAX_ENTRIES) {
      long now = System.nanoTime();
      h5Sessions.values().removeIf(entry -> now - entry.cachedAtNanos() >= h5SessionCacheTtlNanos);
      // Still full means a burst of distinct sessions within one TTL; fall back to database lookups.
      if (h5Sessions.size() >= H5_SESSION_CACHE_MAX_ENTRIES) return;
    }
    h5Sessions.put(key, new CachedH5Session(principal, csrfHash.clone(), System.nanoTime()));
  }

  private static String cacheKey(byte[] tokenHash) {
    return HexFormat.of().formatHex(tokenHash);
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

  private static Long nullableLong(Object value) {
    return value == null ? null : ((Number) value).longValue();
  }

  private static boolean booleanValue(Object value) {
    if (value == null) return false;
    if (value instanceof Boolean booleanValue) return booleanValue;
    if (value instanceof Number number) return number.longValue() != 0;
    return Boolean.parseBoolean(value.toString());
  }

  public record LoginResult(long id, String username, String displayName, String roleCode,
                            Long departmentId, String departmentName, boolean mustChangePassword, String csrfToken, java.util.Set<AdminPermission> permissions) {}
  public record H5LoginResult(H5Principal customer, String csrfToken) {}
  private record CachedH5Session(H5Principal principal, byte[] csrfHash, long cachedAtNanos) {}
}
