package com.fengyi.ordershow.dashboard;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.AdditionalMatchers.aryEq;
import static org.mockito.Mockito.*;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.LongStream;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class RealtimeEventServiceTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final RealtimeEventService service = spy(new RealtimeEventService(jdbc));

  @Test
  void coalescesWithinEachActivityAndAcknowledgesOnlySelectedIds() {
    when(jdbc.query(anyString(),any(RowMapper.class),any(Object[].class))).thenReturn(List.of(
        row(2,11,"ORDER","7"),row(5,22,"ORDER","7"),row(6,11,"ACTIVITY","7"),row(9,11,"ORDER","7")));
    service.publishOutbox();
    var data = ArgumentCaptor.forClass(Map.class);
    verify(service).publish(eq(11L),eq("invalidate"),data.capture());
    assertThat(data.getValue().get("eventCount")).isEqualTo(3);
    assertThat(data.getValue().get("version")).isEqualTo(9L);
    assertThat(data.getValue().get("scope")).isEqualTo("ACTIVITY");
    assertThat(data.getValue().get("oldestEventAt")).isEqualTo(java.time.Instant.ofEpochMilli(200).toString());
    verify(service).publish(eq(22L),eq("invalidate"),any());
    var order = inOrder(service,jdbc);
    order.verify(service).publish(eq(11L),eq("invalidate"),any());
    order.verify(service).publish(eq(22L),eq("invalidate"),any());
    order.verify(jdbc).update(contains("id IN"),aryEq(new Object[]{2L,5L,6L,9L}));
  }

  @Test
  void lateLowerIdIsPickedUpOnTheNextTick() {
    when(jdbc.query(anyString(),any(RowMapper.class),any(Object[].class)))
        .thenReturn(List.of(row(9,11,"ORDER","7")),List.of(row(3,11,"ORDER","8")));
    service.publishOutbox();service.publishOutbox();
    verify(jdbc,times(2)).query(anyString(),any(RowMapper.class),aryEq(new Object[]{0L}));
    verify(jdbc).update(contains("id IN"),aryEq(new Object[]{9L}));
    verify(jdbc).update(contains("id IN"),aryEq(new Object[]{3L}));
  }

  @Test
  void emptyQueueDoesNotWriteOrNotify() {
    when(jdbc.query(anyString(),any(RowMapper.class),any(Object[].class))).thenReturn(List.of());
    service.publishOutbox();
    verify(jdbc,never()).update(anyString(),any(Object[].class));
    verify(service,never()).publish(anyLong(),anyString(),any());
  }

  @Test
  void failedAcknowledgementIsRetriedWithoutLosingTheNotification() {
    when(jdbc.query(anyString(),any(RowMapper.class),any(Object[].class))).thenReturn(List.of(row(4,11,"ORDER","7")));
    when(jdbc.update(anyString(),any(Object[].class))).thenThrow(new DataAccessResourceFailureException("offline")).thenReturn(1);
    assertThatThrownBy(service::publishOutbox).isInstanceOf(DataAccessResourceFailureException.class);
    service.publishOutbox();
    verify(service,times(2)).publish(eq(11L),eq("invalidate"),any());
    verify(jdbc,times(2)).update(contains("id IN"),aryEq(new Object[]{4L}));
  }

  @Test
  void unexpectedPublicationFailureLeavesAllRowsRetryable() {
    when(jdbc.query(anyString(),any(RowMapper.class),any(Object[].class))).thenReturn(List.of(row(4,11,"ORDER","7")));
    doThrow(new IllegalArgumentException("bad payload")).when(service).publish(anyLong(),anyString(),any());
    assertThatThrownBy(service::publishOutbox).isInstanceOf(IllegalArgumentException.class);
    verify(jdbc,never()).update(anyString(),any(Object[].class));
  }

  @Test
  void backlogIsBoundedAndMergedAcrossPages() {
    when(jdbc.query(anyString(),any(RowMapper.class),any(Object[].class))).thenAnswer(call -> {
      long cursor=((Number)((Object[])call.getRawArguments()[2])[0]).longValue();
      return LongStream.rangeClosed(cursor+1,cursor+1000).mapToObj(id->row(id,11,"ORDER","7")).toList();
    });
    service.publishOutbox();
    verify(jdbc,times(8)).query(anyString(),any(RowMapper.class),any(Object[].class));
    verify(jdbc,times(8)).update(anyString(),any(Object[].class));
    var data=ArgumentCaptor.forClass(Map.class);
    verify(service).publish(eq(11L),eq("invalidate"),data.capture());
    assertThat(data.getValue().get("eventCount")).isEqualTo(8000);
    assertThat(data.getValue().get("version")).isEqualTo(8000L);
  }

  @Test
  void activitySnapshotsAreFilteredBeforeGroupingAndOrdersNeverTriggerThem() {
    var forwarded = new java.util.ArrayList<Long>();
    var stream = new RealtimeEventService(jdbc, () -> mock(SseEmitter.class), forwarded::add);
    var info = new RealtimeEventService.OutboxRow(3,11,"ACTIVITY_INFO_CHANGED","ACTIVITY_INFO","11",java.time.Instant.EPOCH);
    when(jdbc.query(anyString(),any(RowMapper.class),any(Object[].class))).thenReturn(List.of(
        row(2,22,"ORDER","7"), info, row(4,11,"ORDER","8")));
    stream.publishOutbox();
    assertThat(forwarded).containsExactly(11L);
    verify(jdbc).update(contains("id IN"),aryEq(new Object[]{2L,3L,4L}));
  }

  @Test
  void failedActivityDeliveryRemainsPendingWhileOrderEventsAreAcknowledged() {
    var stream = new RealtimeEventService(jdbc, () -> mock(SseEmitter.class), ignored -> { throw new IllegalStateException("Redis offline"); });
    var info = new RealtimeEventService.OutboxRow(3,11,"ACTIVITY_INFO_CHANGED","ACTIVITY_INFO","11",java.time.Instant.EPOCH);
    when(jdbc.query(anyString(),any(RowMapper.class),any(Object[].class))).thenReturn(List.of(info, row(4,11,"ORDER","8")));
    stream.publishOutbox();
    verify(jdbc).update(contains("id IN"),aryEq(new Object[]{4L}));
  }

  @Test
  void disconnectedSubscriberIsRemovedAndDoesNotBlockOthers() throws Exception {
    var dead=mock(SseEmitter.class);var live=mock(SseEmitter.class);var index=new AtomicInteger();
    var events=new RealtimeEventService(jdbc,()->index.getAndIncrement()==0?dead:live);
    doNothing().doThrow(new IOException("disconnected")).when(dead).send(any(SseEmitter.SseEventBuilder.class));
    events.subscribe(11);events.subscribe(11);assertThat(events.subscriberCount(11)).isEqualTo(2);
    events.publish(11,"invalidate",Map.of());
    assertThat(events.subscriberCount(11)).isEqualTo(1);
    verify(live,times(2)).send(any(SseEmitter.SseEventBuilder.class));verify(dead,never()).complete();
    var done=ArgumentCaptor.forClass(Runnable.class);verify(live).onCompletion(done.capture());done.getValue().run();
    assertThat(events.subscriberCount(11)).isZero();
    events.publish(11,"invalidate",Map.of());
  }

  private static RealtimeEventService.OutboxRow row(long id,long activity,String type,String aggregate) {
    return new RealtimeEventService.OutboxRow(id,activity,"CHANGED",type,aggregate,java.time.Instant.ofEpochMilli(id*100));
  }
}
