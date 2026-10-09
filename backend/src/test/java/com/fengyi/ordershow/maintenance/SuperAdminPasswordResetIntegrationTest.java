package com.fengyi.ordershow.maintenance;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.config.OrderShowProperties;
import com.fengyi.ordershow.config.SecurityConfiguration;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.security.CryptoService;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;
import static org.junit.jupiter.api.Assertions.*;

/** Explicitly opted in; only the fixed disposable database and API are addressable. */
@EnabledIfEnvironmentVariable(named = "ORDER_SHOW_RESET_E2E", matches = "order-show-e2e")
class SuperAdminPasswordResetIntegrationTest {
  private static final String BASE = "http://host.docker.internal:8180/api/v1";
  private static final String OLD = "ResetTestOld123!";
  private static final String NEW = "ResetTestNew456!";
  private final ObjectMapper json = new ObjectMapper();
  private final DriverManagerDataSource source = new DriverManagerDataSource(
      "jdbc:mysql://host.docker.internal:33306/order_show_e2e?allowPublicKeyRetrieval=true&useSSL=false",
      "order_show_e2e", "e2e_mysql_only_not_for_business");
  private final JdbcTemplate jdbc = new JdbcTemplate(source);
  private final PasswordEncoder encoder = SecurityConfiguration.passwordEncoder();
  private final TransactionTemplate tx = new TransactionTemplate(new DataSourceTransactionManager(source));
  private final SuperAdminPasswordReset reset = new SuperAdminPasswordReset(jdbc, encoder, tx);
  private SuperAdminPasswordReset.Target target;

  @BeforeEach void setup() {
    assertEquals("order_show_e2e", jdbc.queryForObject("SELECT DATABASE()", String.class));
    tx.setTimeout(20);
    target = reset.inspect();
    assertEquals("e2e_admin", target.username());
    jdbc.update("UPDATE admin_user SET password_hash=?, status='ACTIVE', must_change_password=TRUE, lock_version=lock_version+1 WHERE id=?",
        encoder.encode(OLD), target.id());
    target = reset.inspect();
  }

  private HttpClient client() {
    return HttpClient.newBuilder().cookieHandler(new CookieManager(null, CookiePolicy.ACCEPT_ALL))
        .connectTimeout(Duration.ofSeconds(5)).build();
  }

  private HttpResponse<String> request(HttpClient client, String method, String path, Object body, String csrf) throws Exception {
    var builder = HttpRequest.newBuilder(URI.create(BASE + path)).timeout(Duration.ofSeconds(20));
    if (csrf != null) builder.header("X-CSRF-Token", csrf);
    if (body == null) builder.method(method, HttpRequest.BodyPublishers.noBody());
    else builder.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
    return client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
  }

  private HttpResponse<String> login(HttpClient client, String password) throws Exception {
    return request(client, "POST", "/admin/auth/login", Map.of("username", target.username(), "password", password), null);
  }

  @Test void revokesAllDeviceCredentialsAndKeepsFirstLoginAndSelfChangeFlows() throws Exception {
    HttpClient one = client(), two = client();
    var first = login(one, OLD);
    assertEquals(200, first.statusCode());
    assertTrue(json.readTree(first.body()).path("data").path("mustChangePassword").asBoolean());
    assertEquals(403, request(one, "POST", "/admin/activities", Map.of(), null).statusCode());
    assertEquals(200, login(two, OLD).statusCode());
    String originalHash = jdbc.queryForObject("SELECT password_hash FROM admin_user WHERE id=?", String.class, target.id());
    var result = reset.reset(target, NEW.toCharArray());
    assertTrue(result.revokedSessions() >= 2);
    assertEquals(401, request(one, "GET", "/admin/me", null, null).statusCode());
    assertEquals(401, request(two, "GET", "/admin/activities", null, null).statusCode());
    assertEquals(401, login(client(), OLD).statusCode());
    HttpClient fresh = client();
    var logged = login(fresh, NEW);
    assertEquals(200, logged.statusCode());
    assertFalse(json.readTree(logged.body()).path("data").path("mustChangePassword").asBoolean());
    assertEquals(200, request(fresh, "GET", "/admin/activities", null, null).statusCode());
    assertNotEquals(originalHash, jdbc.queryForObject("SELECT password_hash FROM admin_user WHERE id=?", String.class, target.id()));
    String audit = jdbc.queryForObject("SELECT CONCAT(actor_type, ':', action_code, ':', reason) FROM audit_log WHERE trace_id=?", String.class, result.traceId());
    assertEquals("SYSTEM:ADMIN_PASSWORD_SERVER_RESET:服务器维护重置", audit);
    String csrf = json.readTree(logged.body()).path("data").path("csrfToken").asText();
    assertEquals(200, request(fresh, "POST", "/admin/auth/change-password",
        Map.of("currentPassword", NEW, "newPassword", "ResetSelfChange789!"), csrf).statusCode());
    assertEquals(200, request(fresh, "GET", "/admin/me", null, null).statusCode());
    assertEquals(200, login(client(), "ResetSelfChange789!").statusCode());
  }

  @Test void auditFailureRollsBackPasswordFlagAndSessionRevocation() throws Exception {
    HttpClient browser = client();
    assertEquals(200, login(browser, OLD).statusCode());
    String hash = jdbc.queryForObject("SELECT password_hash FROM admin_user WHERE id=?", String.class, target.id());
    JdbcTemplate failing = new JdbcTemplate(source) {
      @Override public int update(String sql, Object... args) {
        if (sql.contains("INSERT INTO audit_log")) throw new IllegalStateException("injected audit failure");
        return super.update(sql, args);
      }
    };
    var broken = new SuperAdminPasswordReset(failing, encoder, tx);
    assertThrows(IllegalStateException.class, () -> broken.reset(target, NEW.toCharArray()));
    assertEquals(hash, jdbc.queryForObject("SELECT password_hash FROM admin_user WHERE id=?", String.class, target.id()));
    assertTrue(jdbc.queryForObject("SELECT must_change_password FROM admin_user WHERE id=?", Boolean.class, target.id()));
    assertEquals(200, request(browser, "GET", "/admin/me", null, null).statusCode());
    assertEquals(401, login(client(), NEW).statusCode());
    reset.reset(reset.inspect(), NEW.toCharArray());
    assertEquals(401, request(browser, "GET", "/admin/me", null, null).statusCode());
  }

  @Test void oldPasswordLoginWaitingBehindResetCannotIssueAValidSession() throws Exception {
    HttpClient browser = client();
    CountDownLatch started = new CountDownLatch(1);
    CompletableFuture<Integer> result = tx.execute(status -> {
      jdbc.queryForObject("SELECT id FROM admin_user WHERE id=? FOR UPDATE", Long.class, target.id());
      var future = CompletableFuture.supplyAsync(() -> {
        started.countDown();
        try { return login(browser, OLD).statusCode(); } catch (Exception error) { throw new RuntimeException(error); }
      });
      try { assertTrue(started.await(5, TimeUnit.SECONDS)); } catch (InterruptedException error) { throw new RuntimeException(error); }
      reset.reset(target, NEW.toCharArray());
      assertFalse(future.isDone());
      return future;
    });
    assertEquals(401, result.get(20, TimeUnit.SECONDS));
    assertEquals(401, request(browser, "GET", "/admin/me", null, null).statusCode());
  }

  @Test void resetWaitsForAlreadyValidatedLoginAndRevokesItsNewlyInsertedSession() throws Exception {
    CountDownLatch validated = new CountDownLatch(1), release = new CountDownLatch(1);
    PasswordEncoder paused = new PasswordEncoder() {
      public String encode(CharSequence raw) { return encoder.encode(raw); }
      public boolean matches(CharSequence raw, String hash) {
        boolean valid = encoder.matches(raw, hash);
        validated.countDown();
        try { assertTrue(release.await(10, TimeUnit.SECONDS)); } catch (InterruptedException error) { throw new RuntimeException(error); }
        return valid;
      }
    };
    var properties = new OrderShowProperties("http://localhost:3100", false, 8, 12, "test", "test", "e2e_admin", OLD, "test", null);
    var auth = new AuthService(jdbc, paused, new CryptoService(properties), properties);
    var response = new MockHttpServletResponse();
    var login = CompletableFuture.runAsync(() -> tx.executeWithoutResult(status -> auth.login(target.username(), OLD, new MockHttpServletRequest(), response)));
    CompletableFuture<SuperAdminPasswordReset.Result> resetting = null;
    try {
      assertTrue(validated.await(10, TimeUnit.SECONDS));
      resetting = CompletableFuture.supplyAsync(() -> reset.reset(target, NEW.toCharArray()));
    } finally { release.countDown(); }
    login.get(20, TimeUnit.SECONDS);
    assertNotNull(resetting);
    resetting.get(20, TimeUnit.SECONDS);
    String token = response.getCookie("ORDER_SHOW_ADMIN_SESSION").getValue();
    var old = HttpRequest.newBuilder(URI.create(BASE + "/admin/me")).header("Cookie", "ORDER_SHOW_ADMIN_SESSION=" + token).GET().build();
    assertEquals(401, client().send(old, HttpResponse.BodyHandlers.ofString()).statusCode());
  }

  @Test void disabledAccountAndOtherRolesRemainUnchanged() throws Exception {
    Long department = jdbc.queryForObject("SELECT id FROM department ORDER BY id LIMIT 1", Long.class);
    String username = "reset_test_member_" + System.nanoTime();
    jdbc.update("INSERT INTO admin_user(username,display_name,password_hash,role_code,department_id,status,must_change_password) VALUES(?, ?, ?, 'DEPARTMENT_MEMBER', ?, 'ACTIVE', FALSE)",
        username, "test member", encoder.encode(OLD), department);
    HttpClient member = client();
    assertEquals(200, request(member, "POST", "/admin/auth/login", Map.of("username", username, "password", OLD), null).statusCode());
    jdbc.update("UPDATE admin_user SET status='DISABLED', lock_version=lock_version+1 WHERE id=?", target.id());
    var result = reset.reset(reset.inspect(), NEW.toCharArray());
    assertEquals("DISABLED", result.target().status());
    assertEquals(401, login(client(), NEW).statusCode());
    assertEquals(200, request(member, "GET", "/admin/me", null, null).statusCode());
  }

  @Test void staleConfirmationAndInvalidPasswordsMakeNoChanges() {
    String hash = jdbc.queryForObject("SELECT password_hash FROM admin_user WHERE id=?", String.class, target.id());
    for (String invalid : new String[]{"short", "        ", "x".repeat(101), "汉".repeat(25), OLD}) {
      assertThrows(IllegalArgumentException.class, () -> reset.reset(target, invalid.toCharArray()));
    }
    jdbc.update("UPDATE admin_user SET lock_version=lock_version+1 WHERE id=?", target.id());
    assertThrows(IllegalArgumentException.class, () -> reset.reset(target, NEW.toCharArray()));
    assertEquals(hash, jdbc.queryForObject("SELECT password_hash FROM admin_user WHERE id=?", String.class, target.id()));
  }

  @Test void missingOrMultipleSuperAdminsAreRejected() {
    tx.executeWithoutResult(status -> {
      jdbc.update("UPDATE admin_user SET role_code='DEPARTMENT_MEMBER', department_id=(SELECT id FROM department ORDER BY id LIMIT 1) WHERE id=?", target.id());
      assertThrows(IllegalArgumentException.class, reset::inspect);
      status.setRollbackOnly();
    });
    tx.executeWithoutResult(status -> {
      jdbc.update("INSERT INTO admin_user(username,display_name,password_hash,role_code,status,must_change_password) VALUES(?, 'test duplicate', ?, 'SUPER_ADMIN', 'ACTIVE', TRUE)",
          "duplicate_" + System.nanoTime(), encoder.encode(OLD));
      assertThrows(IllegalArgumentException.class, reset::inspect);
      assertThrows(IllegalArgumentException.class, () -> reset.reset(target, NEW.toCharArray()));
      status.setRollbackOnly();
    });
  }
}
