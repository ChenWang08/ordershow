package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fengyi.ordershow.common.DomainException;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class ActivityInfoStreamServiceTest {
  private final ActivityInfoSnapshotService snapshots = mock(ActivityInfoSnapshotService.class);
  private final Tasks tasks = new Tasks();
  private final List<SseEmitter> emitters = new ArrayList<>();
  private final List<List<String>> sent = new ArrayList<>();
  private final ActivityInfoStreamService service = new ActivityInfoStreamService(snapshots,
      new ObjectMapper().findAndRegisterModules(), 300, 30_000, tasks, this::emitter);

  private SseEmitter emitter() {
    var emitter = mock(SseEmitter.class);
    var messages = new ArrayList<String>(); sent.add(messages); emitters.add(emitter);
    try {
      doAnswer(call -> {
        SseEmitter.SseEventBuilder builder = call.getArgument(0);
        messages.add(builder.build().stream().map(data -> data.getData().toString()).reduce("", String::concat));
        return null;
      }).when(emitter).send(any(SseEmitter.SseEventBuilder.class));
    } catch (IOException error) { throw new AssertionError(error); }
    return emitter;
  }

  @AfterEach void cleanup() { service.destroy(); }

  @Test void concurrentOpeningReadsAreCoalescedAndDoNotBroadcastDuplicatesToExistingClients() {
    when(snapshots.load("A")).thenReturn(snapshot(1, "ACTIVE", 1));
    for (int i = 0; i < 300; i++) service.subscribe("A");
    tasks.runAll();
    verify(snapshots, atMost(2)).load("A");
    assertThat(service.subscriberCount()).isEqualTo(300);
    assertThat(sent).allSatisfy(messages -> {
      assertThat(messages).hasSize(1);
      assertThat(messages.getFirst()).contains("event:activity", "\"heartbeatIntervalMs\":30000", "\"version\":\"1\"");
    });
  }

  @Test void updateBetweenRegisteringAndInitialReadCannotBeLostOrOverwrittenByTheOldRead() {
    when(snapshots.load("A")).thenAnswer(ignored -> {
      service.broadcast(snapshot(2, "CLOSED", 2));
      return snapshot(1, "ACTIVE", 1);
    });
    service.subscribe("A"); tasks.runAll();
    assertThat(sent.getFirst()).hasSize(1);
    assertThat(sent.getFirst().getFirst()).contains("\"version\":\"2\"", "\"status\":\"CLOSED\"");
    service.broadcast(snapshot(1, "ACTIVE", 3)); tasks.runAll();
    assertThat(sent.getFirst()).hasSize(1);
  }

  @Test void newerSnapshotInitializesAJoiningClientEvenWhenItsReadReturnsAnOlderVersion() {
    when(snapshots.load("A")).thenReturn(snapshot(1, "ACTIVE", 1));
    service.subscribe("A"); tasks.runAll();
    service.broadcast(snapshot(3, "CLOSED", 3)); tasks.runAll();
    service.subscribe("A"); tasks.runAll();
    assertThat(sent.get(1)).hasSize(1);
    assertThat(sent.get(1).getFirst()).contains("\"version\":\"3\"");
    assertThat(sent.getFirst()).hasSize(2);
  }

  @Test void timeDerivedStatusAdvancesWithinAVersionButAnOlderSnapshotCannotReverseIt() {
    when(snapshots.load("A")).thenReturn(snapshot(1, "ACTIVE", 1));
    service.subscribe("A"); tasks.runAll();
    service.broadcast(snapshot(1, "CLOSED", 3)); tasks.runAll();
    service.broadcast(snapshot(1, "ACTIVE", 2)); tasks.runAll();
    assertThat(sent.getFirst()).hasSize(2);
    assertThat(sent.getFirst().getLast()).contains("\"status\":\"CLOSED\"");
  }

  @Test void slowClientHasOneLatestSnapshotAndOneHeartbeatRatherThanAnUnboundedQueue() {
    when(snapshots.load("A")).thenReturn(snapshot(1, "ACTIVE", 1));
    service.subscribe("A"); tasks.runNext(); // Initial read queues a writer, which is deliberately held.
    for (int i = 2; i <= 100; i++) service.broadcast(snapshot(i, "ACTIVE", i));
    for (int i = 0; i < 20; i++) service.heartbeat();
    assertThat(tasks.queue).hasSize(1);
    tasks.runAll();
    assertThat(sent.getFirst()).hasSize(2);
    assertThat(sent.getFirst().getFirst()).contains("\"version\":\"100\"");
    assertThat(sent.getFirst().getLast()).contains("event:heartbeat");
  }

  @Test void heartbeatNeverLoadsBusinessDataAndRecoveryResynchronizesOncePerActivity() {
    when(snapshots.load("A")).thenReturn(snapshot(1, "ACTIVE", 1));
    service.subscribe("A"); service.subscribe("A"); tasks.runAll(); clearInvocations(snapshots);
    service.heartbeat(); tasks.runAll(); verifyNoInteractions(snapshots);
    when(snapshots.load("A")).thenReturn(snapshot(2, "ACTIVE", 2));
    service.resynchronize(); tasks.runAll(); verify(snapshots).load("A");
    assertThat(sent).allSatisfy(messages -> assertThat(messages.getLast()).contains("\"version\":\"2\""));
  }

  @Test void unavailableActivityTerminatesCleanlyAndBrokenPeerDoesNotBlockOthers() throws Exception {
    when(snapshots.load("MISSING")).thenThrow(DomainException.notFound("ACTIVITY_NOT_FOUND", "活动不存在"));
    service.subscribe("MISSING"); tasks.runAll();
    assertThat(sent.getFirst().getFirst()).contains("event:unavailable"); assertThat(service.subscriberCount()).isZero();
    when(snapshots.load("A")).thenReturn(snapshot(1, "ACTIVE", 1));
    service.subscribe("A"); service.subscribe("A"); tasks.runAll();
    doThrow(new IOException("broken")).when(emitters.get(1)).send(any(SseEmitter.SseEventBuilder.class));
    service.broadcast(snapshot(2, "CLOSED", 2)); tasks.runAll();
    assertThat(service.subscriberCount()).isEqualTo(1);
    assertThat(sent.get(2).getLast()).contains("\"status\":\"CLOSED\"");
  }

  @Test void connectionLimitAndCompletionReleaseTheirSlotsExactlyOnce() {
    var count = new AtomicInteger();
    var limited = new ActivityInfoStreamService(snapshots, new ObjectMapper().findAndRegisterModules(), 1, 30_000,
        tasks, () -> { count.incrementAndGet(); return emitter(); });
    when(snapshots.load("A")).thenReturn(snapshot(1, "ACTIVE", 1));
    limited.subscribe("A");
    assertThatThrownBy(() -> limited.subscribe("A")).isInstanceOf(DomainException.class);
    assertThat(count.get()).isEqualTo(1); assertThat(limited.subscriberCount()).isEqualTo(1);
    var done = ArgumentCaptor.forClass(Runnable.class); verify(emitters.getFirst()).onCompletion(done.capture());
    done.getValue().run(); done.getValue().run();
    assertThat(limited.subscriberCount()).isZero(); limited.subscribe("A"); tasks.runAll();
    assertThat(limited.subscriberCount()).isEqualTo(1); limited.destroy();
    assertThat(limited.subscriberCount()).isZero();
  }

  static ActivityInfoSnapshotService.Snapshot snapshot(long version, String status, long time) {
    var start = Instant.parse("2026-01-01T00:00:00Z");
    var activity = new ActivityService.ActivityView(1, 1, "D", "A", "活动", "", status, status, "Asia/Shanghai",
        start, start.plusSeconds(3600), start.plusSeconds(7200), "ALL", 90, 30, 3, 1, List.of(), false,
        "TYPED", List.of("GENERAL"), start, start, null, null, null, null, null);
    return new ActivityInfoSnapshotService.Snapshot(1, Long.toString(version), Instant.ofEpochSecond(time), activity);
  }

  static class Tasks extends AbstractExecutorService {
    final ArrayDeque<Runnable> queue = new ArrayDeque<>();
    boolean shutdown;
    void runNext() { if (!queue.isEmpty()) queue.removeFirst().run(); }
    void runAll() { while (!queue.isEmpty()) runNext(); }
    @Override public void execute(Runnable command) { queue.add(command); }
    @Override public void shutdown() { shutdown = true; }
    @Override public List<Runnable> shutdownNow() { shutdown = true; var rest = List.copyOf(queue); queue.clear(); return rest; }
    @Override public boolean isShutdown() { return shutdown; }
    @Override public boolean isTerminated() { return shutdown && queue.isEmpty(); }
    @Override public boolean awaitTermination(long timeout, TimeUnit unit) { return isTerminated(); }
  }
}
