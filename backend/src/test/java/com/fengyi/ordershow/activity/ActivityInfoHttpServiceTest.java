package com.fengyi.ordershow.activity;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fengyi.ordershow.common.DomainException;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.time.*;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class ActivityInfoHttpServiceTest {
  final ActivityInfoSnapshotService snapshots = mock(ActivityInfoSnapshotService.class);
  final AtomicLong now = new AtomicLong(Instant.parse("2026-11-01T00:00:00Z").toEpochMilli());
  final Clock clock = new Clock() {
    public ZoneId getZone() { return ZoneOffset.UTC; }
    public Clock withZone(ZoneId zone) { return this; }
    public Instant instant() { return Instant.ofEpochMilli(now.get()); }
  };

  ActivityInfoHttpService service(int activities, int loads, int waiters) {
    return new ActivityInfoHttpService(snapshots, new SimpleMeterRegistry(), activities, loads, waiters, 2000, 1000, clock);
  }
  ActivityInfoSnapshotService.Revision revision(long version) {
    return new ActivityInfoSnapshotService.Revision(42, version, "ACTIVE", Instant.EPOCH,
        Instant.parse("2099-01-01T00:00:00Z"), Instant.parse("2099-01-02T00:00:00Z"));
  }
  ActivityInfoSnapshotService.Snapshot snapshot(long version, String name, String status) {
    var r = revision(version);
    var a = new ActivityService.ActivityView(42, 1, "测试部门", "A", name, "", status, "ACTIVE", "Asia/Shanghai",
        r.startsAt(), r.endsAt(), r.eventEndsAt(), "ALL", 90, 30, 3, 1, List.of(), false, "TYPED", List.of("GENERAL"),
        null, null, null, null, null, null, null);
    return new ActivityInfoSnapshotService.Snapshot(42, String.valueOf(version), clock.instant(), a);
  }

  @Test void conditionalReadsSkipFullAssemblyAndShortCacheSkipsRepeatedRevisionQueries() {
    when(snapshots.revision("A")).thenReturn(revision(1));
    when(snapshots.load("A")).thenReturn(snapshot(1, "初始", "ACTIVE"));
    var http = service(4, 2, 128);
    var first = http.read("A", null);
    for (int i = 0; i < 100; i++) assertThat(http.read("A", first.etag()).activity()).isNull();
    now.addAndGet(2000);
    assertThat(http.read("A", first.etag()).activity()).isNull();
    assertThat(http.read("A", null).activity().name()).isEqualTo("初始");
    verify(snapshots, times(2)).revision("A"); verify(snapshots).load("A");
    when(snapshots.revision("A")).thenReturn(revision(2));
    when(snapshots.load("A")).thenReturn(snapshot(2, "更新", "ACTIVE")); now.addAndGet(2000);
    var updated = http.read("A", first.etag());
    assertThat(updated.etag()).isNotEqualTo(first.etag()); assertThat(updated.activity().name()).isEqualTo("更新");
  }

  @Test void concurrentFirstReadsShareOneFullSnapshotWithoutOpeningWaitingTransactions() throws Exception {
    var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
    when(snapshots.revision("A")).thenReturn(revision(1));
    when(snapshots.load("A")).thenAnswer(call -> {
      entered.countDown(); assertThat(release.await(3, TimeUnit.SECONDS)).isTrue(); return snapshot(1, "合并", "ACTIVE");
    });
    var http = service(4, 2, 128);
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
      var first = executor.submit(() -> http.read("A", null));
      assertThat(entered.await(3, TimeUnit.SECONDS)).isTrue();
      var peers = new java.util.ArrayList<Future<ActivityInfoHttpService.Read>>();
      for (int i = 0; i < 50; i++) peers.add(executor.submit(() -> http.read("A", null)));
      release.countDown();
      assertThat(first.get(3, TimeUnit.SECONDS).activity().name()).isEqualTo("合并");
      for (var peer : peers) assertThat(peer.get(3, TimeUnit.SECONDS).activity().name()).isEqualTo("合并");
    } finally { release.countDown(); }
    verify(snapshots).revision("A"); verify(snapshots).load("A");
  }

  @Test void timeDerivedDeadlineChangesValidatorWithoutWaitingForScheduledLifecycleWrites() {
    var end = clock.instant().plusMillis(500);
    when(snapshots.revision("A")).thenReturn(new ActivityInfoSnapshotService.Revision(42, 1, "ACTIVE", Instant.EPOCH, end, end.plusSeconds(10)));
    // No initial full read is needed to validate a representation the browser already owns.
    var http = service(4, 2, 128);
    assertThat(http.read("A", "W/\"activity-42-1-ACTIVE\"").activity()).isNull();
    now.addAndGet(501);
    when(snapshots.load("A")).thenReturn(snapshot(1, "截止", "CLOSED"));
    assertThat(http.read("A", "W/\"activity-42-1-ACTIVE\"").etag()).endsWith("CLOSED\"");
    verify(snapshots).revision("A");
  }

  @Test void actualSnapshotVersionLabelsResponseEvenWhenWriteRacesTheProbe() {
    when(snapshots.revision("A")).thenReturn(revision(1));
    when(snapshots.load("A")).thenReturn(snapshot(2, "并发更新", "ACTIVE"));
    var http = service(4, 2, 128);
    var result = http.read("A", null);
    assertThat(result.etag()).contains("-2-"); assertThat(http.read("A", result.etag()).activity()).isNull();
  }

  @Test void independentReplicasObserveSharedRevisionAfterTtlWithoutRedisNotifications() {
    when(snapshots.revision("A")).thenReturn(revision(1));
    when(snapshots.load("A")).thenReturn(snapshot(1, "初始", "ACTIVE"));
    var first = service(4, 2, 128); var second = service(4, 2, 128);
    var old = first.read("A", null).etag(); second.read("A", null);
    when(snapshots.revision("A")).thenReturn(revision(2));
    when(snapshots.load("A")).thenReturn(snapshot(2, "共享版本", "ACTIVE")); now.addAndGet(2000);
    assertThat(first.read("A", old).activity().name()).isEqualTo("共享版本");
    assertThat(second.read("A", old).activity().name()).isEqualTo("共享版本");
  }

  @Test void boundedActivitiesEvictIdleEntriesAndFailedLoadsReleasePermits() {
    when(snapshots.revision(anyString())).thenReturn(revision(1));
    when(snapshots.load(anyString())).thenReturn(snapshot(1, "缓存", "ACTIVE"));
    var http = service(1, 1, 1);
    http.read("A", null); http.read("B", null); http.read("A", null);
    verify(snapshots, times(2)).revision("A");
    now.addAndGet(2000);
    when(snapshots.revision("A")).thenThrow(DomainException.notFound("ACTIVITY_NOT_FOUND", "不存在"));
    assertThatThrownBy(() -> http.read("A", null)).isInstanceOf(DomainException.class);
    doReturn(revision(2)).when(snapshots).revision("A");
    assertThat(http.read("A", null).activity()).isNotNull();
  }

  @Test void unrelatedLoadsCannotExceedDatabaseBudget() throws Exception {
    var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
    when(snapshots.revision("A")).thenAnswer(call -> { entered.countDown(); release.await(3, TimeUnit.SECONDS); return revision(1); });
    when(snapshots.load("A")).thenReturn(snapshot(1, "A", "ACTIVE"));
    var http = service(4, 1, 8);
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
      var first = executor.submit(() -> http.read("A", null));
      assertThat(entered.await(3, TimeUnit.SECONDS)).isTrue();
      assertThatThrownBy(() -> http.read("B", null)).isInstanceOfSatisfying(DomainException.class,
          error -> assertThat(error.code()).isEqualTo("ACTIVITY_INFO_BUSY"));
      verify(snapshots, never()).revision("B"); release.countDown(); first.get(3, TimeUnit.SECONDS);
    } finally { release.countDown(); }
  }

  @Test void conditionalValidatorsSupportWeakStrongListsAndWildcard() {
    String tag = "W/\"activity-42-1-ACTIVE\"";
    assertThat(ActivityInfoHttpService.matches("\"other\", \"activity-42-1-ACTIVE\"", tag)).isTrue();
    assertThat(ActivityInfoHttpService.matches("*", tag)).isTrue();
    assertThat(ActivityInfoHttpService.matches("W/\"activity-42-1-CLOSED\"", tag)).isFalse();
  }
}
