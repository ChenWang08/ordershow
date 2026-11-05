package com.fengyi.ordershow.lottery;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.GlobalExceptionHandler;
import com.fengyi.ordershow.common.TraceFilter;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.security.AuthService;
import com.fengyi.ordershow.storage.StorageService;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.boot.web.servlet.context.AnnotationConfigServletWebServerApplicationContext;
import org.springframework.boot.web.servlet.server.ServletWebServerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.web.servlet.DispatcherServlet;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/** Opt-in HTTP timing against the same fixed disposable database as LotteryIntegrationTest.
 * Real Tomcat/controller/service/transaction/JDBC; unrelated services and admin identity are mocked.
 * No application scanning, scheduled jobs, business service or image build is involved. */
@EnabledIfEnvironmentVariable(named = "ORDER_SHOW_LOTTERY_TEST", matches = "order-show-lottery-test")
class LotteryOrderHttpTest {
  private static final ObjectMapper JSON = LotteryIntegrationTest.JSON;
  private static final AdminPrincipal ADMIN = new AdminPrincipal(1, "test", "test", "SUPER_ADMIN", null, null, false);
  private static final int WARMUP = 10, SAMPLES = 50;

  @Test void sortingLatencyAndFailureBoundariesOverRealHttp() throws Exception {
    LotteryIntegrationTest.migrate();
    var fixture = new LotteryIntegrationTest();
    fixture.fixture();
    var report = new LinkedHashMap<String, Object>();
    report.put("scope", "Real loopback HTTP, production controller/service/transaction, MySQL 8.4; mocked admin identity and unrelated services; sequential requests, no business load");
    report.put("database", "order_show_lottery_test");
    report.put("warmupPerSize", WARMUP);
    report.put("measuredRequestsPerSize", SAMPLES);
    report.put("movement", "Move first round to last; every position changes on each request");
    var measurements = new ArrayList<Object>();
    try (var context = new AnnotationConfigServletWebServerApplicationContext(HttpConfig.class);
         var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build()) {
      var service = context.getBean(LotteryService.class);
      var jdbc = context.getBean(JdbcTemplate.class);
      // Ignore Spring's BeanFactoryAware/InitializingBean setup; observe runtime service calls only.
      clearInvocations(context.getBean(StringRedisTemplate.class), context.getBean(StorageService.class));
      when(context.getBean(ActivityService.class).byId(fixture.activity)).thenReturn(
          JSON.readValue("{\"id\":" + fixture.activity + ",\"status\":\"ACTIVE\",\"regions\":[]}", ActivityService.ActivityView.class));
      int port = context.getWebServer().getPort();
      for (int count : List.of(12, 100)) {
        var config = fixture.round("AMOUNT", "0", null, List.of(), "EQUAL");
        var rule = service.create(fixture.activity, new LotteryService.RuleWrite("HTTP排序" + count, Collections.nCopies(count, config)), ADMIN);
        rule = service.publish(fixture.activity, rule.id(), ADMIN);
        var endpoint = URI.create("http://127.0.0.1:" + port + "/api/v1/admin/activities/" + fixture.activity + "/lottery/rules/" + rule.id() + "/round-order");
        var ids = new ArrayList<>(rule.rounds().stream().map(LotteryService.RoundView::id).toList());
        var originalConfig = configuration(jdbc, rule.id());
        long outboxBefore = jdbc.queryForObject("SELECT COUNT(*) FROM domain_event_outbox", Long.class);
        long revision = rule.revision();
        var timings = new ArrayList<Double>();
        for (int i = 0; i < WARMUP + SAMPLES; i++) {
          Collections.rotate(ids, -1);
          var response = put(client, endpoint, revision, ids);
          assertThat(response.status()).isEqualTo(200);
          var data = response.json().path("data");
          assertThat(data.path("revision").asLong()).isEqualTo(++revision);
          assertThat(returnedIds(data)).containsExactlyElementsOf(ids);
          if (i >= WARMUP) timings.add(response.ms());
        }
        assertThat(configuration(jdbc, rule.id())).isEqualTo(originalConfig);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_event_outbox", Long.class)).isEqualTo(outboxBefore);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM audit_log WHERE action_code='LOTTERY_ROUNDS_REORDERED' AND object_id=?", Long.class, String.valueOf(rule.id()))).isEqualTo(WARMUP + SAMPLES);

        // Stale same-order replay must not attach a new revision to an old configuration.
        var stale = put(client, endpoint, revision - 1, ids);
        assertThat(stale.status()).isEqualTo(409);
        assertThat(stale.json().path("code").asText()).isEqualTo("LOTTERY_RULE_CHANGED");

        var requested = new ArrayList<>(ids);
        Collections.rotate(requested, -1);
        TimedResponse busy;
        try (var connection = context.getBean(HikariDataSource.class).getConnection()) {
          connection.setAutoCommit(false);
          try (var statement = connection.prepareStatement("SELECT revision FROM lottery_rule WHERE id=? FOR UPDATE")) {
            statement.setLong(1, rule.id());
            try (var rows = statement.executeQuery()) { assertThat(rows.next()).isTrue(); }
          }
          try {
            busy = put(client, endpoint, revision, requested);
            assertThat(busy.status()).isEqualTo(409);
            assertThat(busy.json().path("code").asText()).isEqualTo("LOTTERY_RULE_BUSY");
            assertThat(busy.ms()).isLessThan(1000);
          } finally { connection.rollback(); }
        }

        // Fail after round updates and revision increment, inside the actual service transaction.
        TimedResponse rollback;
        jdbc.execute("CREATE TRIGGER fail_http_order_audit BEFORE INSERT ON audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic HTTP order audit failure'");
        try {
          rollback = put(client, endpoint, revision, requested);
          assertThat(rollback.status()).isEqualTo(500);
        } finally { jdbc.execute("DROP TRIGGER fail_http_order_audit"); }
        var after = service.roundOrder(fixture.activity, rule.id());
        assertThat(after.revision()).isEqualTo(revision);
        assertThat(after.rounds()).extracting(LotteryService.RoundPosition::id).containsExactlyElementsOf(ids);
        assertThat(configuration(jdbc, rule.id())).isEqualTo(originalConfig);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM audit_log WHERE action_code='LOTTERY_ROUNDS_REORDERED' AND object_id=?", Long.class, String.valueOf(rule.id()))).isEqualTo(WARMUP + SAMPLES);

        var measurement = new LinkedHashMap<String, Object>();
        measurement.put("rounds", count);
        measurement.put("samplesMs", timings);
        var sorted = timings.stream().sorted().toList();
        measurement.put("medianMs", (sorted.get(sorted.size() / 2 - 1) + sorted.get(sorted.size() / 2)) / 2);
        measurement.put("p95Ms", sorted.get((int) Math.ceil(sorted.size() * .95) - 1));
        measurement.put("maxMs", sorted.getLast());
        measurement.put("successfulMeasuredRequests", timings.size());
        measurement.put("unexpectedErrors", 0);
        measurement.put("staleRevision", Map.of("status", stale.status(), "ms", stale.ms()));
        measurement.put("heldRuleLock", Map.of("status", busy.status(), "ms", busy.ms(), "code", "LOTTERY_RULE_BUSY"));
        measurement.put("auditFailureRollback", Map.of("status", rollback.status(), "ms", rollback.ms(), "orderAndRevisionUnchanged", true));
        measurements.add(measurement);
      }
      for (String table : List.of("lottery_candidate_snapshot", "lottery_draw_attempt", "lottery_winner")) {
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE activity_id=?", Long.class, fixture.activity)).isZero();
      }
      verifyNoInteractions(context.getBean(StringRedisTemplate.class), context.getBean(StorageService.class));
    }
    report.put("measurements", measurements);
    Path directory = Path.of("../outputs/lottery-order-mysql");
    Files.createDirectories(directory);
    JSON.writerWithDefaultPrettyPrinter().writeValue(directory.resolve("http-latency.json").toFile(), report);
    System.out.println("LOTTERY_ORDER_HTTP_REPORT " + JSON.writeValueAsString(measurements));
  }

  private static List<Map<String, Object>> configuration(JdbcTemplate jdbc, long ruleId) {
    return jdbc.queryForList("SELECT id,name,prize_name,winner_count,candidate_scope,customer_type,minimum_order_amount,qualification_metric,probability_mode,minimum_order_box_count,minimum_order_tons,product_line,product_line_unassigned,CAST(varieties_json AS CHAR) AS varieties,include_unspecified_variety,qualification_cutoff_at,prize_image_file_id,exclude_previous_winners,display_name_type,status,current_attempt_no FROM lottery_round WHERE lottery_rule_id=? ORDER BY id", ruleId);
  }

  private static List<Long> returnedIds(JsonNode data) {
    var ids = new ArrayList<Long>();
    data.path("rounds").forEach(round -> ids.add(round.path("id").asLong()));
    return ids;
  }

  private static TimedResponse put(HttpClient client, URI endpoint, long revision, List<Long> ids) throws Exception {
    var request = HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(5)).header("Content-Type", "application/json")
        .PUT(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(new LotteryService.RoundOrderWrite(revision, ids)))).build();
    long start = System.nanoTime();
    var response = client.send(request, HttpResponse.BodyHandlers.ofString());
    double ms = (System.nanoTime() - start) / 1_000_000.0;
    return new TimedResponse(response.statusCode(), JSON.readTree(response.body()), ms);
  }

  private record TimedResponse(int status, JsonNode json, double ms) {}

  @Configuration(proxyBeanMethods = false)
  @EnableWebMvc
  @EnableTransactionManagement(proxyTargetClass = true)
  @Import({LotteryController.class, GlobalExceptionHandler.class})
  static class HttpConfig {
    @Bean ServletWebServerFactory webServerFactory() throws Exception {
      var factory = new TomcatServletWebServerFactory(0);
      factory.setAddress(InetAddress.getLoopbackAddress());
      factory.setContextPath("/api/v1");
      return factory;
    }
    @Bean DispatcherServlet dispatcherServlet() { return new DispatcherServlet(); }
    @Bean ServletRegistrationBean<DispatcherServlet> dispatcherRegistration(DispatcherServlet servlet) {
      return new ServletRegistrationBean<>(servlet, "/");
    }
    @Bean FilterRegistrationBean<TraceFilter> traceFilter() { return new FilterRegistrationBean<>(new TraceFilter()); }
    @Bean(destroyMethod = "close") HikariDataSource dataSource() {
      var config = new HikariConfig();
      config.setJdbcUrl(LotteryIntegrationTest.URL);
      config.setUsername("root");
      config.setPassword("lottery_only_root");
      config.setMaximumPoolSize(4);
      config.setMinimumIdle(1);
      config.setConnectionTimeout(3000);
      return new HikariDataSource(config);
    }
    @Bean JdbcTemplate jdbc(HikariDataSource source) { return new JdbcTemplate(source); }
    @Bean PlatformTransactionManager transactionManager(HikariDataSource source) { return new DataSourceTransactionManager(source); }
    @Bean ObjectMapper objectMapper() { return JSON; }
    @Bean ActivityService activities() { return mock(ActivityService.class); }
    @Bean StorageService storage() { return mock(StorageService.class); }
    @Bean StringRedisTemplate redis() { return mock(StringRedisTemplate.class); }
    @Bean AuthService auth() {
      var auth = mock(AuthService.class);
      when(auth.requireAdmin(any())).thenReturn(ADMIN);
      return auth;
    }
    @Bean LotteryService lottery(JdbcTemplate jdbc, StringRedisTemplate redis, ObjectMapper json, ActivityService activities, StorageService storage) {
      return new LotteryService(jdbc, redis, json, activities, storage);
    }
  }
}
