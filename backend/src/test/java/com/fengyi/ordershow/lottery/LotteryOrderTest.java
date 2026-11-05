package com.fengyi.ordershow.lottery;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.activity.ActivityService;
import com.fengyi.ordershow.common.DomainException;
import com.fengyi.ordershow.security.AdminPrincipal;
import com.fengyi.ordershow.storage.StorageService;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.UncategorizedSQLException;

class LotteryOrderTest {
  final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  final ActivityService activities = mock(ActivityService.class);
  final AdminPrincipal admin = new AdminPrincipal(1,"test","test","SUPER_ADMIN",null,null,false);
  final List<LotteryService.RoundPosition> positions = new ArrayList<>();
  final List<String> queries = new ArrayList<>();
  long revision = 4;
  LotteryService service;

  @SuppressWarnings("unchecked")
  @BeforeEach void setup() throws Exception {
    var activity = mock(ActivityService.ActivityView.class);
    when(activity.status()).thenReturn("ACTIVE"); when(activities.byId(1)).thenReturn(activity);
    when(jdbc.queryForObject(contains("SELECT status FROM activity"),eq(String.class),eq(1L))).thenReturn("ACTIVE");
    positions.add(new LotteryService.RoundPosition(1,1,"COMPLETED",1));
    positions.add(new LotteryService.RoundPosition(2,2,"READY",0));
    positions.add(new LotteryService.RoundPosition(3,3,"READY",0));
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenAnswer(call -> {
      String sql = call.getArgument(0); queries.add(sql);
      RowMapper<?> mapper = call.getArgument(1);
      var result = new ArrayList<>();
      if (sql.contains("FROM lottery_rule")) {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getLong(1)).thenReturn(20L); when(rs.getString(2)).thenReturn("PUBLISHED"); when(rs.getLong(3)).thenReturn(revision);
        result.add(mapper.mapRow(rs,0));
      } else if (sql.contains("FROM lottery_round")) {
        for (var position : positions.stream().sorted(Comparator.comparingInt(LotteryService.RoundPosition::roundNo)).toList()) {
          ResultSet rs = mock(ResultSet.class);
          when(rs.getLong(1)).thenReturn(position.id()); when(rs.getInt(2)).thenReturn(position.roundNo());
          when(rs.getString(3)).thenReturn(position.status()); when(rs.getInt(4)).thenReturn(position.currentAttemptNo());
          result.add(mapper.mapRow(rs,result.size()));
        }
      } else throw new AssertionError("Unexpected query: " + sql);
      return result;
    });
    when(jdbc.batchUpdate(anyString(), anyList())).thenAnswer(call -> {
      List<Object[]> rows = call.getArgument(1);
      for (Object[] values : rows) {
        int no = ((Number) values[0]).intValue(); long id = ((Number) values[1]).longValue();
        assertThat(positions.stream().noneMatch(p -> p.roundNo() == no && p.id() != id)).as("unique round number during each update").isTrue();
        positions.replaceAll(p -> p.id() == id ? new LotteryService.RoundPosition(id,no,p.status(),p.currentAttemptNo()) : p);
      }
      return new int[rows.size()];
    });
    when(jdbc.update(anyString(), any(Object[].class))).thenAnswer(call -> {
      if (call.<String>getArgument(0).startsWith("UPDATE lottery_rule")) revision++;
      return 1;
    });
    service = new LotteryService(jdbc,mock(StringRedisTemplate.class),new ObjectMapper(),activities,mock(StorageService.class));
  }

  @Test void swapsOnlyFutureIdentitiesWithTwoSafeBatchesAndNoHeavyReadsOrActivityEvent() {
    var result = service.reorder(1,20,new LotteryService.RoundOrderWrite(4L,List.of(1L,3L,2L)),admin,"order-test");
    assertThat(result.rounds()).extracting(LotteryService.RoundPosition::id).containsExactly(1L,3L,2L);
    assertThat(result.revision()).isEqualTo(5);
    verify(jdbc,times(2)).batchUpdate(anyString(),argThat((List<Object[]> rows) -> rows.size() == 2));
    verify(jdbc,times(1)).update(contains("INSERT INTO audit_log"),any(Object[].class));
    verify(jdbc,never()).update(contains("domain_event_outbox"),any(Object[].class));
    assertThat(queries).allMatch(sql -> !sql.contains("customer_order") && !sql.contains("order_item") && !sql.contains("lottery_winner") && !sql.contains("candidate"));
    assertThat(queries).anyMatch(sql -> sql.contains("FOR UPDATE NOWAIT"));
  }

  @Test void identicalOrderNeverWritesAndStaleReplayMustReloadConfiguration() {
    service.reorder(1,20,new LotteryService.RoundOrderWrite(4L,List.of(1L,3L,2L)),admin,"order-test");
    clearInvocations(jdbc);
    assertThatThrownBy(() -> service.reorder(1,20,new LotteryService.RoundOrderWrite(4L,List.of(1L,3L,2L)),admin,"order-test"))
        .isInstanceOfSatisfying(DomainException.class,e -> assertThat(e.code()).isEqualTo("LOTTERY_RULE_CHANGED"));
    assertThat(service.reorder(1,20,new LotteryService.RoundOrderWrite(5L,List.of(1L,3L,2L)),admin,"order-test").revision()).isEqualTo(5);
    verify(jdbc,never()).batchUpdate(anyString(),anyList());
    verify(jdbc,never()).update(anyString(),any(Object[].class));
  }

  @Test void staleOrMissingVersionsNeverWrite() {
    for (Long expected : new Long[] { null, 3L }) {
      assertThatThrownBy(() -> service.reorder(1,20,new LotteryService.RoundOrderWrite(expected,List.of(1L,3L,2L)),admin,"test"))
          .isInstanceOfSatisfying(DomainException.class,e -> assertThat(e.code()).isEqualTo("LOTTERY_RULE_CHANGED"));
    }
    verify(jdbc,never()).batchUpdate(anyString(),anyList());
    verify(jdbc,never()).update(anyString(),any(Object[].class));
  }

  @Test void invalidIdsAndMovingTheLockedPrefixAreRejected() {
    for (var ids : List.of(List.of(1L,2L),List.of(1L,2L,2L),List.of(1L,2L,99L),List.of(2L,1L,3L))) {
      assertThatThrownBy(() -> service.reorder(1,20,new LotteryService.RoundOrderWrite(4L,ids),admin,"test")).isInstanceOf(DomainException.class);
    }
    verify(jdbc,never()).batchUpdate(anyString(),anyList());
    assertThatThrownBy(() -> LotteryService.validateOrder(positions,java.util.Arrays.asList(1L,null,3L))).isInstanceOf(DomainException.class);
  }

  @Test void aHundredRoundsStillOnlyWriteTheTwoMovedRowsAndUseThreeRuleQueries() {
    for (int i=4;i<=100;i++) positions.add(new LotteryService.RoundPosition(i,i,"READY",0));
    var ids = new ArrayList<>(positions.stream().map(LotteryService.RoundPosition::id).toList());
    java.util.Collections.swap(ids,98,99);
    var result = service.reorder(1,20,new LotteryService.RoundOrderWrite(4L,ids),admin,"test");
    assertThat(result.rounds()).hasSize(100);
    assertThat(queries).hasSize(3);
    verify(jdbc,times(2)).batchUpdate(anyString(),argThat((List<Object[]> rows) -> rows.size()==2));
    verifyNoInteractions(activities);
  }

  @Test void resetAndPreviouslyDrawnReadyRoundsLockTheirEntirePrefix() {
    for (String status : List.of("DRAWING","DRAWN","COMPLETED","RESET","READY")) {
      var current = List.of(new LotteryService.RoundPosition(1,1,"READY",0),new LotteryService.RoundPosition(2,2,status,1),new LotteryService.RoundPosition(3,3,"READY",0));
      assertThatThrownBy(() -> LotteryService.validateOrder(current,List.of(2L,1L,3L))).isInstanceOf(DomainException.class);
    }
  }

  @Test void lockContentionFailsImmediatelyAndFinishedActivitiesCannotReorder() {
    when(jdbc.query(contains("FOR UPDATE NOWAIT"),any(RowMapper.class),any(Object[].class))).thenThrow(new CannotAcquireLockException("busy"));
    assertThatThrownBy(() -> service.reorder(1,20,new LotteryService.RoundOrderWrite(4L,List.of(1L,3L,2L)),admin,"test"))
        .isInstanceOfSatisfying(DomainException.class,e -> assertThat(e.code()).isEqualTo("LOTTERY_RULE_BUSY"));
    when(jdbc.queryForObject(contains("SELECT status FROM activity"),eq(String.class),eq(1L))).thenReturn("FINISHED");
    assertThatThrownBy(() -> service.reorder(1,20,new LotteryService.RoundOrderWrite(4L,List.of(1L,3L,2L)),admin,"test"))
        .isInstanceOfSatisfying(DomainException.class,e -> assertThat(e.code()).isEqualTo("LOTTERY_ACTIVITY_FINISHED"));
  }

  @Test void mysqlNowaitVendorErrorIsBusyButOtherSqlErrorsArePreserved() {
    var busy = new UncategorizedSQLException("query", "FOR UPDATE NOWAIT", new java.sql.SQLException("NOWAIT", "HY000", 3572));
    var unrelated = new UncategorizedSQLException("query", "FOR UPDATE NOWAIT", new java.sql.SQLException("syntax", "42000", 1064));
    when(jdbc.query(contains("FOR UPDATE NOWAIT"),any(RowMapper.class),any(Object[].class))).thenThrow(busy, unrelated);
    assertThatThrownBy(() -> service.reorder(1,20,new LotteryService.RoundOrderWrite(4L,List.of(1L,3L,2L)),admin,"test"))
        .isInstanceOfSatisfying(DomainException.class,e -> assertThat(e.code()).isEqualTo("LOTTERY_RULE_BUSY"));
    assertThatThrownBy(() -> service.reorder(1,20,new LotteryService.RoundOrderWrite(4L,List.of(1L,3L,2L)),admin,"test"))
        .isSameAs(unrelated);
    verify(jdbc,never()).batchUpdate(anyString(),anyList());
  }
}
