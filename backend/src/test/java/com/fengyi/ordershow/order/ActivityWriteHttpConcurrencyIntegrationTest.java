package com.fengyi.ordershow.order;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityAccessPolicy;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.activity.ActivityWriteConfiguration;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.common.GlobalExceptionHandler;
import com.fengyi.ordershow.dashboard.DashboardService;
import com.fengyi.ordershow.dashboard.DashboardSummaryStore;
import com.fengyi.ordershow.lottery.LotteryController;
import com.fengyi.ordershow.lottery.LotteryService;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.security.DepartmentAccessService;
import com.fengyi.ordershow.storage.StorageService;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.math.BigDecimal;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;
import org.aopalliance.intercept.MethodInterceptor;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.aop.Advisor;
import org.springframework.aop.support.AopUtils;
import org.springframework.aop.support.DefaultPointcutAdvisor;
import org.springframework.aop.support.StaticMethodMatcherPointcut;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.boot.web.servlet.context.AnnotationConfigServletWebServerApplicationContext;
import org.springframework.boot.web.servlet.server.ServletWebServerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.core.Ordered;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.servlet.DispatcherServlet;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/** Real loopback HTTP and production controllers/advisor/services against a fixed disposable MySQL.
 * Two independent Spring/Tomcat instances and connection pools; identity, H5 rate checks and activity
 * presentation use the existing synthetic fixture. No application scan, jobs or business containers. */
@EnabledIfEnvironmentVariable(named="ORDER_SHOW_REVIEW_TEST", matches="order-show-ack-smoke-lottery-review")
class ActivityWriteHttpConcurrencyIntegrationTest {
  private static final ObjectMapper JSON = OrderReviewConcurrencyIntegrationTest.JSON;
  private OrderReviewConcurrencyIntegrationTest fixture;
  private HttpNode first, second;
  private HttpClient client;

  @BeforeAll static void migrate() { OrderReviewConcurrencyIntegrationTest.migrate(); }

  @BeforeEach void startHttpInstances() throws Exception {
    fixture = new OrderReviewConcurrencyIntegrationTest();
    fixture.fixture();
    client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    first = new HttpNode(fixture);
    second = new HttpNode(fixture);
    // Initialize both dispatchers before observing concurrency; these reads don't take activity locks.
    for (var node : List.of(first, second)) {
      assertThat(request(node, "GET", adminPath("lottery/statistics"), null, "warmup", null).get(5, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
    }
  }

  @AfterEach void closeHttpInstances() {
    if (first != null) first.close();
    if (second != null) second.close();
    if (client != null) client.close();
  }

  @ParameterizedTest @ValueSource(strings={"lottery", "orders", "approve", "reject"})
  void fourHttpEntrypointsAllowAnotherCustomerToSubmit(String operation) throws Exception {
    Gate gate = first.hold("held");
    var held = operation(first, operation, "held", "held");
    try {
      gate.awaitEntered();
      var submitted = submit(second, 2, 1, "other-customer").get(2, TimeUnit.SECONDS);
      assertThat(submitted.statusCode()).as(submitted.body()).isEqualTo(200);
      assertThat(json(submitted).path("data").path("totalQuantity").asLong()).isEqualTo(11);
      assertThat(held.isDone()).isFalse();
      // The read result was computed before B's concurrent commit; a later preview sees the new order.
      gate.release.countDown();
      var response = held.get(5, TimeUnit.SECONDS);
      assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
      if (operation.equals("lottery")) {
        assertThat(json(response).path("data").path("totalCandidateOrderAmount").decimalValue()).isEqualByComparingTo("2000");
        var refreshed = operation(second, operation, "refresh", null).get(5, TimeUnit.SECONDS);
        assertThat(json(refreshed).path("data").path("totalCandidateOrderAmount").decimalValue()).isEqualByComparingTo("2100");
      } else if (operation.equals("orders")) {
        assertThat(json(response).path("data").path("totalAmount").decimalValue()).isEqualByComparingTo("500");
      } else {
        assertThat(json(response).path("data").path("status").asText()).isEqualTo(operation.equals("approve") ? "APPROVED" : "REJECTED");
      }
      assertThat(OrderReviewConcurrencyIntegrationTest.jdbc.queryForObject("SELECT dirty FROM order_dashboard_stat WHERE order_id=?", Boolean.class, fixture.base+2)).isFalse();
    } finally { gate.release.countDown(); held.get(5, TimeUnit.SECONDS); }
  }

  @ParameterizedTest @ValueSource(strings={"approve", "reject"})
  void sameCustomerStillWaitsAndVersionChecksRemain(String operation) throws Exception {
    Gate gate = first.hold("held");
    var held = operation(first, operation, "held", "held");
    try {
      gate.awaitEntered();
      var same = submit(second, 1, 1, "same-customer");
      assertThatThrownBy(() -> same.get(250, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
      gate.release.countDown();
      assertThat(held.get(5, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
      var response = same.get(5, TimeUnit.SECONDS);
      assertThat(response.statusCode()).as(response.body()).isEqualTo(operation.equals("approve") ? 409 : 200);
      if (operation.equals("approve")) assertThat(json(response).path("code").asText()).isEqualTo("ORDER_VERSION_CONFLICT");
      assertThat(OrderReviewConcurrencyIntegrationTest.jdbc.queryForObject("SELECT total_quantity FROM customer_order WHERE id=?", Long.class, fixture.base+1)).isEqualTo(operation.equals("approve") ? 5L : 11L);
    } finally { gate.release.countDown(); held.get(5, TimeUnit.SECONDS); }
  }

  @ParameterizedTest @ValueSource(strings={"price", "archive", "delete"})
  void reviewWaitsForExclusiveWriterAndChecksCommittedState(String change) throws Exception {
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    try (var executor = Executors.newSingleThreadExecutor()) {
      var writer = executor.submit(() -> OrderReviewConcurrencyIntegrationTest.tx.execute(status -> {
        fixture.repository.lockPricing(fixture.activity);
        if (change.equals("price")) OrderReviewConcurrencyIntegrationTest.jdbc.update("UPDATE activity_product SET case_price=200 WHERE id=?", fixture.base+11);
        else if (change.equals("archive")) OrderReviewConcurrencyIntegrationTest.jdbc.update("UPDATE activity SET status='ARCHIVED' WHERE id=?", fixture.activity);
        else OrderReviewConcurrencyIntegrationTest.jdbc.update("UPDATE activity SET deletion_requested_at=UTC_TIMESTAMP(3) WHERE id=?", fixture.activity);
        entered.countDown();
        await(release);
        return true;
      }));
      try {
        await(entered);
        var review = operation(second, "approve", "after-writer", null);
        assertThatThrownBy(() -> review.get(250, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
        release.countDown();
        assertThat(writer.get(5, TimeUnit.SECONDS)).isTrue();
        var response = review.get(5, TimeUnit.SECONDS);
        assertThat(response.statusCode()).as(response.body()).isEqualTo(change.equals("price") ? 200 : change.equals("archive") ? 409 : 404);
        if (!change.equals("price")) assertThat(json(response).path("code").asText()).isEqualTo(change.equals("archive") ? "ACTIVITY_ARCHIVED_READ_ONLY" : "ACTIVITY_NOT_FOUND");
        assertThat(OrderReviewConcurrencyIntegrationTest.jdbc.queryForObject("SELECT total_amount FROM customer_order WHERE id=?", BigDecimal.class, fixture.base+1)).isEqualByComparingTo("1000");
        assertThat(OrderReviewConcurrencyIntegrationTest.jdbc.queryForObject("SELECT status FROM order_change_request WHERE id=?", String.class, fixture.requestA)).isEqualTo(change.equals("price") ? "APPROVED" : "PENDING");
      } finally { release.countDown(); writer.get(5, TimeUnit.SECONDS); }
    }
  }

  @Test void repeatedHttpApprovalAcrossInstancesCreatesOneVersionAndOperation() throws Exception {
    var a = operation(first, "approve", "same-command", null);
    var b = operation(second, "approve", "same-command", null);
    for (var future : List.of(a, b)) {
      var response = future.get(5, TimeUnit.SECONDS);
      assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
      assertThat(json(response).path("data").path("status").asText()).isEqualTo("APPROVED");
    }
    assertThat(OrderReviewConcurrencyIntegrationTest.jdbc.queryForObject("SELECT current_version_no FROM customer_order WHERE id=?", Integer.class, fixture.base+1)).isEqualTo(2);
    assertThat(OrderReviewConcurrencyIntegrationTest.jdbc.queryForObject("SELECT COUNT(*) FROM order_operation WHERE order_id=? AND operation_type='H5_CHANGE_APPROVED'", Integer.class, fixture.base+1)).isEqualTo(1);
  }

  @ParameterizedTest @ValueSource(strings={"lottery", "orders", "approve", "reject"})
  void activityExclusiveWriterStillWaitsForSharedHttpTransaction(String operation) throws Exception {
    Gate gate = first.hold("held");
    var held = operation(first, operation, "held", "held");
    try (var executor = Executors.newSingleThreadExecutor()) {
      try {
        gate.awaitEntered();
        var started = new CountDownLatch(1);
        var exclusive = executor.submit(() -> {
          started.countDown();
          return OrderReviewConcurrencyIntegrationTest.tx.execute(status -> { fixture.repository.lockPricing(fixture.activity); return true; });
        });
        await(started);
        assertThatThrownBy(() -> exclusive.get(250, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
        gate.release.countDown();
        assertThat(held.get(5, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
        assertThat(exclusive.get(5, TimeUnit.SECONDS)).isTrue();
      } finally { gate.release.countDown(); held.get(5, TimeUnit.SECONDS); }
    }
  }

  @Test void formalDrawStillExcludesH5WritesAndPersistsItsSnapshot() throws Exception {
    var lottery = first.context.getBean(LotteryService.class);
    var round = new LotteryService.RoundWrite("synthetic round", "prize", 1, "VALID_ORDERS", "ALL", BigDecimal.ZERO,
        "AMOUNT", "EQUAL", 0, null, false, "FULL_NAME", null, BigDecimal.ZERO, null, List.of(), false, false);
    var rule = lottery.create(fixture.activity, new LotteryService.RuleWrite("HTTP draw fixture", List.of(round)), fixture.admin);
    rule = lottery.publish(fixture.activity, rule.id(), fixture.admin);
    Gate gate = first.hold("draw");
    var held = request(first, "POST", adminPath("lottery/rounds/"+rule.rounds().getFirst().id()+"/draw"), Map.of("expectedRevision", rule.revision()), "draw", "draw");
    try {
      gate.awaitEntered();
      var submitted = submit(second, 2, 1, "after-draw");
      assertThatThrownBy(() -> submitted.get(250, TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
      gate.release.countDown();
      var response = held.get(5, TimeUnit.SECONDS);
      assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
      assertThat(json(response).path("data").path("candidateCount").asInt()).isEqualTo(2);
      assertThat(submitted.get(5, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
      assertThat(OrderReviewConcurrencyIntegrationTest.jdbc.queryForObject("SELECT COUNT(*) FROM lottery_candidate_snapshot WHERE activity_id=?", Integer.class, fixture.activity)).isEqualTo(2);
      assertThat(OrderReviewConcurrencyIntegrationTest.jdbc.queryForObject("SELECT COUNT(*) FROM lottery_winner WHERE activity_id=? AND status='VALID'", Integer.class, fixture.activity)).isEqualTo(1);
    } finally { gate.release.countDown(); held.get(5, TimeUnit.SECONDS); }
  }

  @Test void httpFailureRollsBackAndReleasesLocksForRetry() throws Exception {
    Gate gate = first.hold("failure");
    gate.failAfter = true;
    gate.release.countDown();
    var failed = operation(first, "approve", "retry-after-failure", "failure").get(5, TimeUnit.SECONDS);
    assertThat(failed.statusCode()).isEqualTo(500);
    var jdbc = OrderReviewConcurrencyIntegrationTest.jdbc;
    assertThat(jdbc.queryForObject("SELECT total_quantity FROM customer_order WHERE id=?", Long.class, fixture.base+1)).isEqualTo(10);
    assertThat(jdbc.queryForObject("SELECT status FROM order_change_request WHERE id=?", String.class, fixture.requestA)).isEqualTo("PENDING");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM order_version WHERE order_id=?", Integer.class, fixture.base+1)).isEqualTo(1);
    for (String table : List.of("api_idempotency", "order_operation", "domain_event_outbox", "order_dashboard_stat")) {
      String scope = table.equals("order_operation") || table.equals("order_dashboard_stat") ? "order_id="+(fixture.base+1) : "activity_id="+fixture.activity;
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM "+table+" WHERE "+scope, Integer.class)).as(table).isZero();
    }
    var retry = operation(second, "approve", "retry-after-failure", null).get(5, TimeUnit.SECONDS);
    assertThat(retry.statusCode()).as(retry.body()).isEqualTo(200);
  }

  @ParameterizedTest @ValueSource(strings={"lottery", "orders", "approve", "reject"})
  void deletedAndUnreadyActivitiesStillRejectTheseHttpEntrypoints(String operation) throws Exception {
    var jdbc = OrderReviewConcurrencyIntegrationTest.jdbc;
    jdbc.update("UPDATE activity SET configuration_state='COPYING' WHERE id=?", fixture.activity);
    assertThat(operation(first, operation, "unready", null).get(5, TimeUnit.SECONDS).statusCode()).isEqualTo(404);
    jdbc.update("UPDATE activity SET configuration_state='READY',deletion_requested_at=UTC_TIMESTAMP(3) WHERE id=?", fixture.activity);
    assertThat(operation(first, operation, "deleted", null).get(5, TimeUnit.SECONDS).statusCode()).isEqualTo(404);
    assertThat(jdbc.queryForObject("SELECT status FROM order_change_request WHERE id=?", String.class, fixture.requestA)).isEqualTo("PENDING");
  }

  @Test void archivePreviewAndAuthenticationRulesRemain() throws Exception {
    var jdbc = OrderReviewConcurrencyIntegrationTest.jdbc;
    jdbc.update("UPDATE activity SET status='ARCHIVED' WHERE id=?", fixture.activity);
    // Existing lottery preview is allowed for archived activities; order trial and reviews reject it.
    assertThat(operation(first, "lottery", "archive-preview", null).get(5, TimeUnit.SECONDS).statusCode()).isEqualTo(200);
    for (String operation : List.of("orders", "approve", "reject")) {
      var response = operation(first, operation, "archived", null).get(5, TimeUnit.SECONDS);
      assertThat(response.statusCode()).as(response.body()).isEqualTo(409);
    }
    jdbc.update("UPDATE activity SET status='ACTIVE' WHERE id=?", fixture.activity);
    doThrow(new DomainException(org.springframework.http.HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "synthetic unauthenticated request"))
        .when(first.context.getBean(AuthService.class)).requireAdmin(any());
    for (String operation : List.of("lottery", "orders", "approve", "reject")) {
      assertThat(operation(first, operation, "unauthenticated", null).get(5, TimeUnit.SECONDS).statusCode()).isEqualTo(401);
    }
    assertThat(jdbc.queryForObject("SELECT status FROM order_change_request WHERE id=?", String.class, fixture.requestA)).isEqualTo("PENDING");
  }

  private CompletableFuture<HttpResponse<String>> operation(HttpNode node, String operation, String key, String pause) throws Exception {
    String path;
    Object body;
    if (operation.equals("lottery")) {
      path = adminPath("lottery/candidates/preview");
      body = new LotteryService.PreviewRequest(1, 1, "VALID_ORDERS", "ALL", BigDecimal.ZERO, "AMOUNT", "EQUAL", 0, false, BigDecimal.ZERO, null, List.of(), false, false);
    } else if (operation.equals("orders")) {
      path = adminPath("orders/preview");
      body = new OrderService.AdminPreviewRequest(fixture.base+1, List.of(new OrderService.SubmitItem(fixture.base+11, 5)));
    } else {
      path = adminPath("order-change-requests/"+fixture.requestA+"/"+operation);
      body = Map.of("reason", "synthetic HTTP review");
    }
    return request(node, "POST", path, body, key, pause);
  }

  private CompletableFuture<HttpResponse<String>> submit(HttpNode node, int customer, int version, String key) throws Exception {
    return request(node, "PUT", "/h5/activities/REVIEW-"+fixture.activity+"/order?includeHistory=false&testCustomer="+customer, fixture.submission(version), key, null);
  }

  private String adminPath(String suffix) { return "/admin/activities/"+fixture.activity+"/"+suffix; }
  private static JsonNode json(HttpResponse<String> response) throws Exception { return JSON.readTree(response.body()); }
  private CompletableFuture<HttpResponse<String>> request(HttpNode node, String method, String path, Object body, String key, String pause) throws Exception {
    var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+node.context.getWebServer().getPort()+"/api/v1"+path))
        .timeout(Duration.ofSeconds(12)).header("Content-Type", "application/json").header("Idempotency-Key", key);
    if (pause != null) builder.header("X-Test-Pause", pause);
    builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
    return client.sendAsync(builder.build(), HttpResponse.BodyHandlers.ofString());
  }

  private static void await(CountDownLatch latch) {
    try { assertThat(latch.await(8, TimeUnit.SECONDS)).as("HTTP transaction barrier").isTrue(); }
    catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); }
  }

  private static final class Gate {
    final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
    boolean failAfter;
    void awaitEntered() { await(entered); }
  }

  private static final class HttpNode implements AutoCloseable {
    final AnnotationConfigServletWebServerApplicationContext context = new AnnotationConfigServletWebServerApplicationContext();
    final Map<String, Gate> gates = new ConcurrentHashMap<>();
    HttpNode(OrderReviewConcurrencyIntegrationTest fixture) {
      context.registerBean(ActivityService.class, () -> fixture.activities);
      context.registerBean(AuthService.class, () -> {
        var auth = mock(AuthService.class);
        when(auth.requireAdmin(any())).thenReturn(fixture.admin);
        when(auth.requireH5(any())).thenAnswer(call -> {
          var request = (jakarta.servlet.http.HttpServletRequest) call.getArgument(0);
          return fixture.user(Integer.parseInt(request.getParameter("testCustomer")));
        });
        return auth;
      });
      context.registerBean("responseBarrier", Advisor.class, () -> {
        var pointcut = new StaticMethodMatcherPointcut() {
          @Override public boolean matches(java.lang.reflect.Method method, Class<?> type) { return type.isAnnotationPresent(RestController.class); }
        };
        var advisor = new DefaultPointcutAdvisor(pointcut, (MethodInterceptor) invocation -> {
          Object result = invocation.proceed();
          if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            String key = attributes.getRequest().getHeader("X-Test-Pause");
            Gate gate = key == null ? null : gates.get(key);
            if (gate != null) {
              gate.entered.countDown();
              await(gate.release);
              if (gate.failAfter) throw new IllegalStateException("synthetic failure after controller, before transaction commit");
            }
          }
          return result;
        });
        advisor.setOrder(Ordered.LOWEST_PRECEDENCE);
        return advisor;
      }, definition -> definition.setRole(org.springframework.beans.factory.config.BeanDefinition.ROLE_INFRASTRUCTURE));
      context.register(HttpConfig.class);
      context.refresh();
      for (Class<?> type : List.of(OrderController.class, OrderChangeRequestController.class, LotteryController.class)) {
        assertThat(AopUtils.isAopProxy(context.getBean(type))).as(type.getSimpleName()).isTrue();
      }
    }
    Gate hold(String key) { var gate = new Gate(); gates.put(key, gate); return gate; }
    public void close() { gates.values().forEach(gate -> gate.release.countDown()); context.close(); }
  }

  @Configuration(proxyBeanMethods=false)
  @EnableWebMvc
  @EnableTransactionManagement(proxyTargetClass=true)
  @Import({ActivityWriteConfiguration.class, ActivityAccessPolicy.class, OrderController.class,
      OrderChangeRequestController.class, LotteryController.class, GlobalExceptionHandler.class})
  static class HttpConfig {
    @Bean ServletWebServerFactory webServerFactory() throws Exception {
      var factory = new TomcatServletWebServerFactory(0);
      factory.setAddress(InetAddress.getLoopbackAddress());
      factory.setContextPath("/api/v1");
      return factory;
    }
    @Bean DispatcherServlet dispatcherServlet() { return new DispatcherServlet(); }
    @Bean ServletRegistrationBean<DispatcherServlet> dispatcherRegistration(DispatcherServlet servlet) { return new ServletRegistrationBean<>(servlet, "/"); }
    @Bean(destroyMethod="close") HikariDataSource dataSource() {
      var config = new HikariConfig();
      config.setJdbcUrl(OrderReviewConcurrencyIntegrationTest.URL);
      config.setUsername("root"); config.setPassword("lottery_only_root");
      config.setMaximumPoolSize(4); config.setMinimumIdle(1); config.setConnectionTimeout(3000);
      config.setConnectionInitSql("SET time_zone='+00:00'");
      return new HikariDataSource(config);
    }
    @Bean JdbcTemplate jdbc(HikariDataSource source) { return new JdbcTemplate(source); }
    @Bean PlatformTransactionManager transactionManager(HikariDataSource source) { return new DataSourceTransactionManager(source); }
    @Bean ObjectMapper mapper() { return JSON; }
    @Bean DashboardSummaryStore summaries(JdbcTemplate jdbc) { return new DashboardSummaryStore(jdbc, true, ""); }
    @Bean OrderRepository orders(JdbcTemplate jdbc, DashboardSummaryStore summaries) { return new OrderRepository(jdbc, JSON, summaries); }
    @Bean OrderChangeRequestRepository changes(JdbcTemplate jdbc) { return new OrderChangeRequestRepository(jdbc); }
    @Bean OrderService service(OrderRepository orders, ActivityService activities, OrderChangeRequestRepository changes) {
      return new OrderService(orders, activities, mock(DashboardService.class), JSON, mock(OrderQueryService.class), changes);
    }
    @Bean LotteryService lottery(JdbcTemplate jdbc, ActivityService activities) {
      return new LotteryService(jdbc, mock(StringRedisTemplate.class), JSON, activities, mock(StorageService.class));
    }
    @Bean DepartmentAccessService access(JdbcTemplate jdbc) { return new DepartmentAccessService(jdbc); }
    @Bean OrderDraftService drafts() { return mock(OrderDraftService.class); }
    @Bean H5CustomerWriteGuard guard() { return mock(H5CustomerWriteGuard.class); }
  }
}
