package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Fixed disposable network/database only. No caller-supplied URL and no business images or data. */
@EnabledIfEnvironmentVariable(named = "ORDER_SHOW_ACTIVITY_INFO_TEST", matches = "order-show-activity-info-test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.datasource.url=jdbc:mysql://mysql:3306/order_show_activity_info_test?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC",
    "spring.datasource.username=root", "spring.datasource.password=activity_info_test_only",
    "spring.flyway.user=root", "spring.flyway.password=activity_info_test_only",
    "spring.data.redis.host=redis", "spring.data.redis.password=",
    "spring.datasource.hikari.minimum-idle=1", "spring.datasource.hikari.maximum-pool-size=8",
    "order-show.bootstrap-admin-password=ActivityInfoTestOnly123!", "order-show.h5-warmup.enabled=false"
})
class ActivityInfoIntegrationTest {
  @LocalServerPort int port;
  @Autowired JdbcTemplate jdbc;
  @Autowired ActivityService activities;
  @Autowired ActivityInfoSnapshotService snapshots;
  @Autowired ObjectMapper json;
  @Autowired StringRedisTemplate redis;
  @Autowired RedisConnectionFactory redisConnections;
  @Autowired PlatformTransactionManager transactions;
  @Autowired ActivityInfoHttpService httpInfo;

  @Test void finiteHttpChecksObserveDatabaseVersionsAndSeparateReplicaCaches() throws Exception {
    String code = "HTTP-INFO-" + java.util.UUID.randomUUID();
    long admin = jdbc.queryForObject("SELECT id FROM admin_user WHERE role_code='SUPER_ADMIN' ORDER BY id LIMIT 1", Long.class);
    long department = jdbc.queryForObject("SELECT id FROM department WHERE department_code='DEFAULT'", Long.class);
    jdbc.update("""
        INSERT INTO activity(activity_code,name,status,starts_at,ends_at,event_ends_at,created_by,updated_by,department_id)
        VALUES (?,'HTTP资料','ACTIVE','2026-01-01','2099-01-01','2099-01-02',?,?,?)
        """, code, admin, admin, department);
    long id = jdbc.queryForObject("SELECT id FROM activity WHERE activity_code=?", Long.class, code);
    var second = new ActivityInfoHttpService(snapshots, new io.micrometer.core.instrument.simple.SimpleMeterRegistry(), 4, 2, 32, 0, 1000);
    try (var client = HttpClient.newHttpClient()) {
      URI url = URI.create("http://localhost:" + port + "/api/v1/public/activities/" + code);
      var first = client.send(HttpRequest.newBuilder(url).timeout(Duration.ofSeconds(10)).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertThat(first.statusCode()).isEqualTo(200);
      assertThat(json.readTree(first.body()).path("data").path("name").asText()).isEqualTo("HTTP资料");
      String tag = first.headers().firstValue("ETag").orElseThrow();
      assertThat(second.read(code, null).etag()).isEqualTo(tag);
      var unchanged = client.send(HttpRequest.newBuilder(url).header("If-None-Match", tag).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertThat(unchanged.statusCode()).isEqualTo(304); assertThat(unchanged.body()).isEmpty();
      new TransactionTemplate(transactions).executeWithoutResult(status -> {
        jdbc.update("UPDATE activity SET name='HTTP已更新',status='CLOSED' WHERE id=?", id);
        ActivityInfoChanges.record(jdbc, id);
      });
      assertThat(second.read(code, tag).activity().status()).isEqualTo("CLOSED");
      Thread.sleep(2100);
      var changed = client.send(HttpRequest.newBuilder(url).header("If-None-Match", tag).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertThat(changed.statusCode()).isEqualTo(200);
      assertThat(changed.headers().firstValue("ETag").orElseThrow()).isNotEqualTo(tag);
      assertThat(json.readTree(changed.body()).path("data").path("name").asText()).isEqualTo("HTTP已更新");
    }
  }

  @Test void missingHttpActivityUsesDomain404InTheFullHttpStack() throws Exception {
    try (var client = HttpClient.newHttpClient()) {
      var response = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port
          + "/api/v1/public/activities/REMOVED-ENDPOINT")).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertThat(response.statusCode()).isEqualTo(404);
      assertThat(json.readTree(response.body()).path("code").asText()).isEqualTo("ACTIVITY_NOT_FOUND");
    }
  }

  @Test void realHttpRedisAndTransactionsSynchronizeTwoReplicasWithoutPollingOrOrderNoise() throws Exception {
    // Re-runnable in this fixed disposable DB; only our named synthetic fixture is replaced.
    for (Long previousId : jdbc.queryForList("SELECT id FROM activity WHERE activity_code='ACTIVITY-INFO-TEST'", Long.class)) {
      for (String table : java.util.List.of("domain_event_outbox", "activity_dashboard_snapshot", "audit_log")) {
        jdbc.update("DELETE FROM " + table + " WHERE activity_id=?", previousId);
      }
      jdbc.update("DELETE FROM activity WHERE id=?", previousId);
    }
    long adminId = jdbc.queryForObject("SELECT id FROM admin_user WHERE role_code='SUPER_ADMIN' ORDER BY id LIMIT 1", Long.class);
    long departmentId = jdbc.queryForObject("SELECT id FROM department WHERE department_code='DEFAULT'", Long.class);
    jdbc.update("""
        INSERT INTO activity(activity_code,name,status,starts_at,ends_at,event_ends_at,created_by,updated_by,department_id)
        VALUES ('ACTIVITY-INFO-TEST','隔离活动','ACTIVE','2026-01-01','2099-01-01','2099-01-02',?,?,?)
        """, adminId, adminId, departmentId);
    long id = jdbc.queryForObject("SELECT id FROM activity WHERE activity_code='ACTIVITY-INFO-TEST'", Long.class);
    var admin = new AdminPrincipal(adminId, "fixture", "Fixture", "SUPER_ADMIN", null, null, false);
    var executor = Executors.newVirtualThreadPerTaskExecutor();
    var secondEvents = new LinkedBlockingQueue<JsonNode>();
    var peer = mock(SseEmitter.class);
    doAnswer(call -> {
      SseEmitter.SseEventBuilder builder = call.getArgument(0);
      for (var data : builder.build()) {
        String value = data.getData().toString();
        if (value.startsWith("{")) secondEvents.add(json.readTree(value));
      }
      return null;
    }).when(peer).send(any(SseEmitter.SseEventBuilder.class));
    var secondStream = new ActivityInfoStreamService(snapshots, json, 10, 30_000, executor, () -> peer);
    var secondBridge = new ActivityInfoRedisBridge(redis, redisConnections, json, snapshots, secondStream);
    secondBridge.initialize(); secondBridge.start();
    try (var first = new Client(port, json)) {
      secondStream.subscribe("ACTIVITY-INFO-TEST");
      assertThat(first.next().path("activity").path("name").asText()).isEqualTo("隔离活动");
      assertThat(next(secondEvents).path("activity").path("name").asText()).isEqualTo("隔离活动");
      awaitSubscribers(2, id);
      // The public-info revision is a separate column; rollback cancels both revision and event.
      int adminVersion = activities.byId(id).version();
      long initialRevision = revision(id);
      var transaction = new TransactionTemplate(transactions);
      transaction.executeWithoutResult(status -> {
        ActivityInfoChanges.record(jdbc, id);
        status.setRollbackOnly();
      });
      assertThat(revision(id)).isEqualTo(initialRevision);
      assertThat(activities.byId(id).version()).isEqualTo(adminVersion);
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_event_outbox WHERE aggregate_type='ACTIVITY_INFO' AND activity_id=?", Integer.class, id)).isZero();

      activities.updateLiveRoom(id, adminVersion, "https://example.com/live", admin);
      assertThat(first.next().path("activity").path("liveRoomUrl").asText()).isEqualTo("https://example.com/live");
      assertThat(next(secondEvents).path("activity").path("liveRoomUrl").asText()).isEqualTo("https://example.com/live");
      activities.closeNow(id, activities.byId(id).version(), admin);
      assertThat(first.next().path("activity").path("status").asText()).isEqualTo("CLOSED");
      assertThat(next(secondEvents).path("activity").path("status").asText()).isEqualTo("CLOSED");
      // FINISHED still permits a new public subscription, so reopening remains observable.
      activities.finishNow(id, activities.byId(id).version(), admin);
      assertThat(first.next().path("activity").path("status").asText()).isEqualTo("FINISHED");
      assertThat(next(secondEvents).path("activity").path("status").asText()).isEqualTo("FINISHED");
      try (var finished = new Client(port, json)) {
        assertThat(finished.next().path("activity").path("status").asText()).isEqualTo("FINISHED");
        activities.reopen(id, activities.byId(id).version(), java.time.Instant.parse("2099-02-01T00:00:00Z"),
            java.time.Instant.parse("2099-02-02T00:00:00Z"), "隔离验证", "activity-info-test", admin);
        assertThat(first.next().path("activity").path("status").asText()).isEqualTo("ACTIVE");
        assertThat(finished.next().path("activity").path("status").asText()).isEqualTo("ACTIVE");
        assertThat(next(secondEvents).path("activity").path("status").asText()).isEqualTo("ACTIVE");
      }
      first.messages.clear(); secondEvents.clear();
      jdbc.update("""
          INSERT INTO domain_event_outbox(activity_id,aggregate_type,aggregate_id,event_type,payload_json,available_at)
          VALUES (?,'ORDER','123','ORDER_SUBMITTED','{}',UTC_TIMESTAMP(3))
          """, id);
      assertThat(first.messages.poll(1200, TimeUnit.MILLISECONDS)).isNull();
      assertThat(secondEvents.poll()).isNull();
      // A Redis resubscription must resync HTTP peers even though those HTTP connections never failed.
      secondBridge.stop();
      transaction.executeWithoutResult(status -> {
        jdbc.update("UPDATE activity SET name='恢复后的活动' WHERE id=?", id);
        ActivityInfoChanges.record(jdbc, id);
      });
      assertThat(first.next().path("activity").path("name").asText()).isEqualTo("恢复后的活动");
      assertThat(secondEvents.poll(200, TimeUnit.MILLISECONDS)).isNull();
      secondBridge.start();
      assertThat(next(secondEvents).path("activity").path("name").asText()).isEqualTo("恢复后的活动");
      assertThat(secondStream.subscriberCount()).isEqualTo(1);
      assertThatThrownBy(() -> activities.requireWritable(id + 9999)).isInstanceOf(DomainException.class);
    } finally {
      secondBridge.destroy(); secondStream.destroy();
    }
  }

  private long revision(long id) { return jdbc.queryForObject("SELECT public_info_version FROM activity WHERE id=?", Long.class, id); }

  private void awaitSubscribers(long expected, long id) throws Exception {
    String probe = json.writeValueAsString(snapshots.load(id));
    long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    while (System.nanoTime() < end) {
      Long subscribers = redis.convertAndSend(ActivityInfoRedisBridge.CHANNEL, probe);
      if (subscribers != null && subscribers >= expected) return;
      Thread.sleep(50);
    }
    fail("Redis replicas did not subscribe");
  }

  private static JsonNode next(BlockingQueue<JsonNode> queue) throws Exception {
    JsonNode value = queue.poll(10, TimeUnit.SECONDS);
    assertThat(value).as("current activity snapshot arrives").isNotNull();
    return value;
  }

  private static final class Client implements AutoCloseable {
    final BlockingQueue<JsonNode> messages = new LinkedBlockingQueue<>();
    final InputStream body;
    final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    final Thread reader;
    Client(int port, ObjectMapper json) throws Exception {
      var response = client.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port
          + "/api/v1/public/activities/ACTIVITY-INFO-TEST/events")).GET().build(), HttpResponse.BodyHandlers.ofInputStream());
      assertThat(response.statusCode()).isEqualTo(200);
      assertThat(response.headers().firstValue("X-Accel-Buffering")).hasValue("no");
      body = response.body();
      reader = Thread.ofVirtual().start(() -> {
        try (var lines = new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8))) {
          for (String line; (line = lines.readLine()) != null;) {
            if (line.startsWith("data:")) {
              var data = json.readTree(line.substring(5).trim());
              if (data.has("activity")) messages.add(data);
            }
          }
        } catch (Exception ignored) { /* Closing the client deliberately interrupts its stream. */ }
      });
    }
    JsonNode next() throws Exception { return ActivityInfoIntegrationTest.next(messages); }
    @Override public void close() throws Exception { body.close(); reader.interrupt(); client.close(); }
  }
}
