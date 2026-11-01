package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Fixed disposable ACK database; never accepts a business URL. */
@EnabledIfEnvironmentVariable(named = "ORDER_SHOW_RANKING_TEST", matches = "order-show-ack-smoke")
class RealtimeOutboxDatabaseIntegrationTest {
  private static final String DATABASE = "order_show_realtime_test";
  private static final String HOST = "jdbc:mysql://host.docker.internal:18306/";
  private static final String OPTIONS = "?allowPublicKeyRetrieval=true&useSSL=false&serverTimezone=UTC";
  private static DriverManagerDataSource source;
  private static JdbcTemplate jdbc;

  @BeforeAll static void schema() {
    var root = new JdbcTemplate(new DriverManagerDataSource(HOST+"ack_smoke"+OPTIONS,"root","isolated_smoke_root"));
    root.execute("CREATE DATABASE IF NOT EXISTS "+DATABASE);
    source = new DriverManagerDataSource(HOST+DATABASE+OPTIONS,"root","isolated_smoke_root");
    jdbc = new JdbcTemplate(source);
    jdbc.execute("""
        CREATE TABLE IF NOT EXISTS domain_event_outbox (
          id BIGINT PRIMARY KEY, activity_id BIGINT, event_type VARCHAR(64), aggregate_type VARCHAR(64),
          aggregate_id VARCHAR(64), created_at DATETIME(3), available_at DATETIME(3),
          payload_json JSON, status VARCHAR(16) DEFAULT 'PENDING', published_at DATETIME(3),
          KEY idx_pending(status,available_at,id))
        """);
  }

  @BeforeEach void reset() { jdbc.update("DELETE FROM domain_event_outbox"); }

  private void insert(long id) {
    jdbc.update("""
        INSERT INTO domain_event_outbox(id,activity_id,event_type,aggregate_type,aggregate_id,created_at,available_at)
        VALUES (?,1,'CHANGED','ORDER','test',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))
        """,id);
  }

  private RealtimeEventService publisher(JdbcTemplate connection, StringRedisTemplate redis) {
    var service = new RealtimeEventService(connection,new DataSourceTransactionManager(source));
    service.configureFanout(redis,new ObjectMapper(),"ack:test:outbox");
    return service;
  }

  private String status(long id) {
    return jdbc.queryForObject("SELECT status FROM domain_event_outbox WHERE id=?",String.class,id);
  }

  @Test void twoPublishersDoNotPublishTheSameLockedRows() throws Exception {
    insert(9);
    var redis=mock(StringRedisTemplate.class);
    var entered=new CountDownLatch(1);
    var release=new CountDownLatch(1);
    when(redis.convertAndSend(anyString(),anyString())).thenAnswer(call->{
      assertThat(jdbc.queryForObject("SELECT @@transaction_isolation",String.class)).isEqualTo("READ-COMMITTED");
      entered.countDown();
      assertThat(release.await(5,TimeUnit.SECONDS)).isTrue();
      return 2L;
    });
    var first=publisher(jdbc,redis);
    var second=publisher(new JdbcTemplate(source),redis);
    var a=CompletableFuture.runAsync(first::publishOutbox);
    try {
      assertThat(entered.await(5,TimeUnit.SECONDS)).isTrue();
      var b=CompletableFuture.runAsync(second::publishOutbox);
      b.get(3,TimeUnit.SECONDS);
      verify(redis,times(1)).convertAndSend(anyString(),anyString());
      assertThat(status(9)).isEqualTo("PENDING");
    } finally { release.countDown(); }
    a.get(5,TimeUnit.SECONDS);
    assertThat(status(9)).isEqualTo("PUBLISHED");
  }

  @Test void failedRedisPublicationRollsBackAndAnotherPublisherCanRetry() {
    insert(7);
    var redis=mock(StringRedisTemplate.class);
    when(redis.convertAndSend(anyString(),anyString())).thenThrow(new IllegalStateException("redis offline")).thenReturn(2L);
    assertThatThrownBy(publisher(jdbc,redis)::publishOutbox).hasMessage("redis offline");
    assertThat(status(7)).isEqualTo("PENDING");
    publisher(new JdbcTemplate(source),redis).publishOutbox();
    assertThat(status(7)).isEqualTo("PUBLISHED");
  }

  @Test void noRedisSubscribersLeavesTheEventRetryable() {
    insert(7);
    var redis=mock(StringRedisTemplate.class);
    when(redis.convertAndSend(anyString(),anyString())).thenReturn(0L,2L);
    var service=publisher(jdbc,redis);
    assertThatThrownBy(service::publishOutbox).hasMessageContaining("No realtime subscribers");
    assertThat(status(7)).isEqualTo("PENDING");
    service.publishOutbox();
    assertThat(status(7)).isEqualTo("PUBLISHED");
  }

  @Test void failedAcknowledgementRollsBackWithoutLosingAnAlreadySentEvent() {
    insert(7);
    var redis=mock(StringRedisTemplate.class);
    when(redis.convertAndSend(anyString(),anyString())).thenReturn(2L);
    var failing=spy(new JdbcTemplate(source));
    doThrow(new DataAccessResourceFailureException("ack offline")).when(failing).update(startsWith("UPDATE domain_event_outbox"),any(Object[].class));
    assertThatThrownBy(publisher(failing,redis)::publishOutbox).hasMessage("ack offline");
    assertThat(status(7)).isEqualTo("PENDING");
    publisher(jdbc,redis).publishOutbox();
    assertThat(status(7)).isEqualTo("PUBLISHED");
    verify(redis,times(2)).convertAndSend(anyString(),anyString());
  }

  @Test void aLaterCommittedLowerIdIsStillPublished() {
    var redis=mock(StringRedisTemplate.class);
    when(redis.convertAndSend(anyString(),anyString())).thenReturn(2L);
    var service=publisher(jdbc,redis);
    insert(9);service.publishOutbox();
    insert(3);service.publishOutbox();
    assertThat(status(9)).isEqualTo("PUBLISHED");
    assertThat(status(3)).isEqualTo("PUBLISHED");
    verify(redis,times(2)).convertAndSend(anyString(),anyString());
  }
}
