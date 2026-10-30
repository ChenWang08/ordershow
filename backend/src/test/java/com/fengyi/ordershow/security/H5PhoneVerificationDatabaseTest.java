package com.fengyi.ordershow.security;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.config.OrderShowProperties;
import com.fengyi.ordershow.h5.H5AuthController;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import jakarta.servlet.http.Cookie;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.TransactionTemplate;

/** Only the dedicated compose network and synthetic schema are accepted. No host ports. */
@EnabledIfEnvironmentVariable(named = "ORDER_SHOW_PHONE_TEST", matches = "order-show-phone-test")
class H5PhoneVerificationDatabaseTest {
  static HikariDataSource source;
  static JdbcTemplate jdbc;
  static CryptoService crypto;
  static AuthService auth;
  static H5PhoneVerificationService service;
  static DataSourceTransactionManager manager;
  static SimpleMeterRegistry meters;

  @BeforeAll static void createSchema() {
    var config = new HikariConfig();
    config.setJdbcUrl("jdbc:mysql://phone-mysql:3306/order_show_phone_test?allowPublicKeyRetrieval=true&useSSL=false&rewriteBatchedStatements=true");
    config.setUsername("root"); config.setPassword("phone_test_only"); config.setMaximumPoolSize(10);
    config.setConnectionInitSql("SET time_zone = '+00:00'");
    source = new HikariDataSource(config); jdbc = new JdbcTemplate(source);
    assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("order_show_phone_test");
    // Disposable fixtures retain the production token/phone unique keys, binary hashes and session FKs.
    for (String table : List.of("h5_session", "activity_customer", "activity_data_binding", "activity", "department")) jdbc.execute("DROP TABLE IF EXISTS " + table);
    jdbc.execute("CREATE TABLE department(id BIGINT PRIMARY KEY,status VARCHAR(20))");
    jdbc.execute("CREATE TABLE activity(id BIGINT PRIMARY KEY,activity_code VARCHAR(80) UNIQUE,department_id BIGINT,archived_at DATETIME,status VARCHAR(20),starts_at DATETIME,ends_at DATETIME,event_ends_at DATETIME)");
    jdbc.execute("CREATE TABLE activity_data_binding(activity_id BIGINT,data_type VARCHAR(30),current_version_id BIGINT,UNIQUE KEY(activity_id,data_type))");
    jdbc.execute("""
        CREATE TABLE activity_customer(id BIGINT PRIMARY KEY,activity_id BIGINT,data_version_id BIGINT,is_active BOOLEAN,
          customer_type VARCHAR(20),region_code VARCHAR(64),branch_name VARCHAR(200),dealer_short_name VARCHAR(200),dealer_full_name VARCHAR(255),
          phone_masked VARCHAR(32),phone_lookup_hash BINARY(32),
          UNIQUE KEY uk_activity_customer_phone(activity_id,data_version_id,customer_type,phone_lookup_hash),
          KEY idx_activity_customer_filter(activity_id,customer_type,is_active,region_code,branch_name))
        """);
    jdbc.execute("""
        CREATE TABLE h5_session(id BIGINT AUTO_INCREMENT PRIMARY KEY,activity_id BIGINT NOT NULL,activity_customer_id BIGINT NOT NULL,
          token_hash BINARY(32) NOT NULL,csrf_token_hash BINARY(32) NOT NULL,expires_at DATETIME(3),last_seen_at DATETIME(3),
          revoked_at DATETIME(3),ip_address VARBINARY(16),user_agent VARCHAR(512),
          UNIQUE KEY uk_h5_session_token_hash(token_hash),KEY idx_h5_session_customer_expires(activity_customer_id,expires_at),
          FOREIGN KEY(activity_id) REFERENCES activity(id),FOREIGN KEY(activity_customer_id) REFERENCES activity_customer(id))
        """);
    var props = new OrderShowProperties("http://localhost", false, 1, 12, "phone-test-hmac", "phone-test-encrypt", "", "", "", null);
    crypto = new CryptoService(props); auth = new AuthService(jdbc, null, crypto, props, 0);
    manager = new DataSourceTransactionManager(source); meters = new SimpleMeterRegistry();
    service = new H5PhoneVerificationService(jdbc, auth, crypto, manager, meters);
    jdbc.update("INSERT INTO department VALUES(1,'ACTIVE')");
    jdbc.update("INSERT INTO activity VALUES(1,'ENTRY',1,NULL,'ACTIVE',UTC_TIMESTAMP()-INTERVAL 1 DAY,UTC_TIMESTAMP()+INTERVAL 1 DAY,UTC_TIMESTAMP()+INTERVAL 2 DAY)");
    jdbc.update("INSERT INTO activity VALUES(2,'OTHER',1,NULL,'ACTIVE',UTC_TIMESTAMP()-INTERVAL 1 DAY,UTC_TIMESTAMP()+INTERVAL 1 DAY,UTC_TIMESTAMP()+INTERVAL 2 DAY)");
    jdbc.update("INSERT INTO activity_data_binding VALUES(1,'WHITELIST',10),(2,'WHITELIST',10)");
    var args = new ArrayList<Object[]>();
    for (int i = 1; i <= 5000; i++) args.add(new Object[]{i, 1, 10, true, i % 2 == 0 ? "SPECIAL" : "GENERAL", i % 3 == 0 ? null : "EAST", "branch", "short", "dealer", "139****0001", crypto.lookupHash(phone(i))});
    jdbc.batchUpdate("INSERT INTO activity_customer VALUES(?,?,?,?,?,?,?,?,?,?,?)", args);
  }

  @BeforeEach void reset() {
    jdbc.update("DELETE FROM h5_session"); jdbc.update("DELETE FROM activity_customer WHERE id>5000");
    jdbc.update("UPDATE activity_customer SET is_active=TRUE");
    jdbc.update("UPDATE activity SET archived_at=NULL,status='ACTIVE',starts_at=UTC_TIMESTAMP()-INTERVAL 1 DAY,event_ends_at=UTC_TIMESTAMP()+INTERVAL 2 DAY");
    jdbc.update("UPDATE department SET status='ACTIVE'");
    jdbc.update("DELETE FROM activity_data_binding WHERE activity_id=1");
    jdbc.update("INSERT INTO activity_data_binding VALUES(1,'WHITELIST',10)");
  }
  @AfterAll static void close() { if (source != null) source.close(); }
  static String phone(int n) { return "139" + String.format("%08d", n); }
  static H5PhoneVerificationService.VerificationResult login(String type, int n, MockHttpServletResponse response) {
    return service.verify("ENTRY", type, phone(n), new MockHttpServletRequest(), response);
  }
  static long sessions() { return jdbc.queryForObject("SELECT COUNT(*) FROM h5_session", Long.class); }
  static void extra(long id, long activity, Long version, String type, int number, boolean active) {
    jdbc.update("INSERT INTO activity_customer VALUES(?,?,?,?,?,'NORTH','branch','short','dealer','139****0001',?)", id, activity, version, active, type, crypto.lookupHash(phone(number)));
  }
  static void rejected(String type, int n) {
    long before = sessions(); var response = new MockHttpServletResponse();
    assertThatThrownBy(() -> login(type, n, response)).isInstanceOf(DomainException.class);
    assertThat(sessions()).isEqualTo(before); assertThat(response.getHeaders("Set-Cookie")).isEmpty();
  }

  @Test void uniqueAndDuplicatePhonesCreateSessionsOnlyAfterIdentityIsChosen() throws Exception {
    var response = new MockHttpServletResponse();
    assertThat(login(null, 1, response).customer().regionCode()).isEqualTo("EAST");
    assertThat(response.getHeaders("Set-Cookie")).hasSize(2); assertThat(sessions()).isEqualTo(1);
    extra(6001, 1, 10L, "SPECIAL", 1, true);
    response = new MockHttpServletResponse();
    var choice = login(null, 1, response);
    assertThat(choice.customerTypes()).containsExactly("GENERAL", "SPECIAL");
    assertThat(choice.customer()).isNull(); assertThat(choice.csrfToken()).isNull();
    assertThat(response.getHeaders("Set-Cookie")).isEmpty(); assertThat(sessions()).isEqualTo(1);
    assertThat(login("SPECIAL", 1, new MockHttpServletResponse()).customer().customerId()).isEqualTo(6001);
    assertThat(login("GENERAL", 1, new MockHttpServletResponse()).customer().customerId()).isEqualTo(1);
    assertThat(sessions()).isEqualTo(3);
    // HTTP contract: old regionCode is accepted but cannot override the stored region.
    var mvc = MockMvcBuilders.standaloneSetup(new H5AuthController(service)).build();
    mvc.perform(post("/public/activities/ENTRY/verify-phone").contentType("application/json").content("{\"phone\":\"" + phone(1) + "\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.selectionRequired").value(true))
        .andExpect(jsonPath("$.data.customerTypes[0]").value("GENERAL")).andExpect(header().doesNotExist("Set-Cookie"));
    mvc.perform(post("/public/activities/ENTRY/verify-phone").contentType("application/json").content("{\"phone\":\"" + phone(1) + "\",\"customerType\":\"GENERAL\",\"regionCode\":\"WRONG\"}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.customer.regionCode").value("EAST"))
        .andExpect(header().exists("Set-Cookie"));
  }

  @Test void historicalInactiveAndOtherActivityIdentitiesDoNotCreateChoices() {
    extra(6001, 1, 11L, "SPECIAL", 1, true); extra(6002, 1, 10L, "SPECIAL", 1, false); extra(6003, 2, 10L, "SPECIAL", 1, true);
    assertThat(login(null, 1, new MockHttpServletResponse()).selectionRequired()).isFalse();
    rejected("SPECIAL", 1); rejected(null, 9000);
    extra(6004, 1, 10L, "ALL", 9000, true);
    assertThat(login(null, 9000, new MockHttpServletResponse()).customer().customerType()).isEqualTo("ALL");
  }

  @Test void confirmationRechecksPublicationAndSameVersionChanges() {
    extra(6001, 1, 10L, "SPECIAL", 1, true); assertThat(login(null, 1, new MockHttpServletResponse()).selectionRequired()).isTrue();
    jdbc.update("UPDATE activity_customer SET is_active=FALSE WHERE id=6001"); rejected("SPECIAL", 1);
    jdbc.update("UPDATE activity_customer SET region_code='SOUTH' WHERE id=1");
    assertThat(login("GENERAL", 1, new MockHttpServletResponse()).customer().regionCode()).isEqualTo("SOUTH");
    extra(6002, 1, 11L, "SPECIAL", 1, true); jdbc.update("UPDATE activity_data_binding SET current_version_id=11 WHERE activity_id=1");
    rejected("GENERAL", 1); assertThat(login(null, 1, new MockHttpServletResponse()).customer().customerId()).isEqualTo(6002);
    jdbc.update("UPDATE activity_customer SET region_code='EAST' WHERE id=1");
  }

  @Test void activityAndDepartmentGuardsRemainEffective() {
    for (String state : List.of("DRAFT", "FINISHED", "ARCHIVED")) { jdbc.update("UPDATE activity SET status=? WHERE id=1", state); rejected(null, 1); }
    jdbc.update("UPDATE activity SET status='SCHEDULED',starts_at=UTC_TIMESTAMP()+INTERVAL 1 DAY WHERE id=1"); rejected(null, 1);
    jdbc.update("UPDATE activity SET status='CLOSED' WHERE id=1"); assertThat(login(null, 1, new MockHttpServletResponse()).selectionRequired()).isFalse();
    jdbc.update("UPDATE activity SET event_ends_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE id=1"); rejected(null, 1);
    jdbc.update("UPDATE activity SET event_ends_at=NULL,archived_at=UTC_TIMESTAMP() WHERE id=1"); rejected(null, 1);
    jdbc.update("UPDATE activity SET archived_at=NULL WHERE id=1"); jdbc.update("UPDATE department SET status='DISABLED'"); rejected(null, 1);
  }

  @Test void legacyMissingBindingAllowsUniqueButRejectsAmbiguousSameType() {
    jdbc.update("DELETE FROM activity_data_binding WHERE activity_id=1");
    assertThat(login(null, 1, new MockHttpServletResponse()).selectionRequired()).isFalse();
    extra(6001, 1, 11L, "GENERAL", 1, true); rejected(null, 1); rejected("GENERAL", 1);
    jdbc.update("INSERT INTO activity_data_binding VALUES(1,'WHITELIST',NULL)"); rejected(null, 1);
  }

  @Test void anotherInstanceCanReadSessionAndRevocationIsObserved() {
    var response = new MockHttpServletResponse(); login(null, 1, response);
    String token = response.getHeaders("Set-Cookie").stream().filter(s -> s.startsWith("ORDER_SHOW_H5_SESSION="))
        .findFirst().orElseThrow().split(";", 2)[0].split("=", 2)[1];
    var props = new OrderShowProperties("http://localhost", false, 1, 12, "phone-test-hmac", "phone-test-encrypt", "", "", "", null);
    var second = new AuthService(jdbc, null, crypto, props, 0);
    var request = new MockHttpServletRequest(); request.setCookies(new Cookie("ORDER_SHOW_H5_SESSION", token));
    assertThat(second.requireH5(request).customerId()).isEqualTo(1);
    jdbc.update("UPDATE h5_session SET revoked_at=UTC_TIMESTAMP()");
    var next = new MockHttpServletRequest(); next.setCookies(new Cookie("ORDER_SHOW_H5_SESSION", token));
    assertThatThrownBy(() -> second.requireH5(next)).isInstanceOf(DomainException.class);
  }

  @Test void transactionRollbackLeaksNeitherSessionNorCookies() {
    var response = new MockHttpServletResponse();
    new TransactionTemplate(manager).execute(status -> {
      auth.createH5Session(new H5Principal(0,1,1,"ENTRY","GENERAL","EAST","branch","short","dealer","139****0001"), new MockHttpServletRequest(), response);
      status.setRollbackOnly(); return null;
    });
    assertThat(sessions()).isZero(); assertThat(response.getHeaders("Set-Cookie")).isEmpty();
  }

  @Test void thirtyConcurrentLoginsProduceExactlyThirtyCommittedSessions() throws Exception {
    try (var executor = Executors.newFixedThreadPool(30)) {
      var tasks = new ArrayList<Callable<Long>>();
      for (int i = 1; i <= 30; i++) { final int n = i; tasks.add(() -> login(null, n, new MockHttpServletResponse()).customer().customerId()); }
      for (var result : executor.invokeAll(tasks)) assertThat(result.get()).isPositive();
    }
    assertThat(sessions()).isEqualTo(30);
    assertThat(jdbc.queryForObject("SELECT COUNT(DISTINCT token_hash) FROM h5_session", Long.class)).isEqualTo(30);
  }

  @Test @EnabledIfEnvironmentVariable(named = "ORDER_SHOW_PHONE_BENCHMARK", matches = "true")
  void compareFrozenBaselineAndPhoneFirstWithIndexExperiment() throws Exception {
    // Benchmark only: all 5000 customers have a region, matching the old mixed-type entry.
    jdbc.update("UPDATE activity_customer SET region_code='EAST'");
    var old = new LegacyH5VerificationBaseline(jdbc, crypto, auth);
    var tx = new TransactionTemplate(manager);
    java.util.function.IntConsumer baseline = n -> tx.execute(status -> old.verifyH5("ENTRY", n % 2 == 0 ? "SPECIAL" : "GENERAL", "EAST", phone(n), new MockHttpServletRequest(), new MockHttpServletResponse()));
    java.util.function.IntConsumer current = n -> login(null, n, new MockHttpServletResponse());
    for (int i = 1; i <= 100; i++) { baseline.accept(i); current.accept(i); }
    for (int round = 0; round < 2; round++) {
      benchmark(round == 0 ? "old-no-index" : "new-no-index", round == 0 ? baseline : current);
      benchmark(round == 0 ? "new-no-index" : "old-no-index", round == 0 ? current : baseline);
    }
    for (int concurrency : new int[]{1, 10, 60}) benchmark("new-concurrency-" + concurrency, current, concurrency);
    // Equality prefix also supports the deliberately retained missing-version compatibility path.
    jdbc.execute("CREATE INDEX idx_activity_customer_phone_entry ON activity_customer(activity_id,phone_lookup_hash,data_version_id)");
    try {
      benchmark("new-index-warm", current);
      benchmark("old-with-index", baseline);
      benchmark("new-with-index", current);
      System.out.println("PHONE_INDEX_PLAN " + jdbc.queryForList("EXPLAIN ANALYZE SELECT id FROM activity_customer WHERE activity_id=1 AND data_version_id=10 AND phone_lookup_hash=?", crypto.lookupHash(phone(1))));
    } finally { jdbc.execute("DROP INDEX idx_activity_customer_phone_entry ON activity_customer"); }
    System.out.println("PHONE_STAGE_TIMERS " + meters.getMeters().stream().filter(m -> m.getId().getName().startsWith("order_show.h5.verify")).map(m -> m.getId() + " " + m.measure()).toList());
  }

  private void benchmark(String name, java.util.function.IntConsumer action) throws Exception {
    benchmark(name, action, 30);
  }

  private void benchmark(String name, java.util.function.IntConsumer action, int concurrency) throws Exception {
    jdbc.update("DELETE FROM h5_session");
    var durations = new java.util.concurrent.ConcurrentLinkedQueue<Double>();
    long started = System.nanoTime();
    try (var executor = Executors.newFixedThreadPool(concurrency)) {
      var tasks = new ArrayList<Callable<Void>>();
      for (int i = 1; i <= 600; i++) {
        final int n = i;
        tasks.add(() -> { long t = System.nanoTime(); action.accept(n); durations.add((System.nanoTime()-t)/1e6); return null; });
      }
      for (var future : executor.invokeAll(tasks)) future.get();
    }
    var sorted = durations.stream().sorted().toList();
    assertThat(sorted).hasSize(600); assertThat(sessions()).isEqualTo(600);
    System.out.printf(java.util.Locale.ROOT,"PHONE_BENCH %s count=600 p50=%.2f p95=%.2f p99=%.2f totalMs=%.2f%n", name,
        sorted.get(299), sorted.get(569), sorted.get(593), (System.nanoTime()-started)/1e6);
  }
}
